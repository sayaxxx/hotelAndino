"""Kiosco de cafetería — Reconocimiento facial con OpenCV (Hotel Andino S.A.S.)

Cámara siempre encendida en la PC de la cafetería. Detecta el rostro del
huésped y lo identifica con el modelo LBPH. Cuando se reconoce un rostro, se
habilita el botón de la comida correspondiente según la hora del sistema:

    RECIBIR DESAYUNO  -> 05:00 - 08:30
    RECIBIR ALMUERZO  -> 12:00 - 15:00
    RECIBIR CENA      -> 17:30 - 23:59 (temporal para pruebas)

El operador pulsa el botón habilitado para registrar la comida en el servidor.

Uso:
    py python/cafeteria.py            -> kiosco en tiempo real (cámara)
    py python/cafeteria.py --check    -> diagnóstico sin cámara
    py python/cafeteria.py --foto x   -> probar reconocimiento en una imagen
    py python/cafeteria.py --server URL --usuario U --password P
"""

import argparse
import os
import sys
import time

sys.stdout.reconfigure(encoding='utf-8')

import cv2
import requests

from face_utils import (
    MODELO_DIR,
    cargar_cascada,
    cargar_modelo,
    dibujar_etiqueta,
    entrenar,
    hay_soporte_lbph,
    mapa_nombres_rostros,
    predecir_rostro,
    sincronizar_rostros,
    ventana_actual,
)

CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cafeteria_config.json')

COLOR_NEUTRO = (70, 70, 70)
COLOR_VERDE = (40, 160, 60)
COLOR_ROJO = (40, 40, 210)
COLOR_AMARILLO = (20, 180, 210)
COLOR_GRIS = (90, 90, 90)
COLOR_BOTON_INACTIVO = (85, 85, 85)

SERVICIOS = ['Desayuno', 'Almuerzo', 'Cena']

ESTADO_COLOR = {
    'recibido': COLOR_VERDE,
    'ya_reclamado': COLOR_AMARILLO,
    'fuera_de_horario': COLOR_GRIS,
    'no_incluida': COLOR_ROJO,
    'sin_reserva_activa': COLOR_ROJO,
    'no_encontrado': COLOR_ROJO,
    'error': COLOR_ROJO,
}


def cargar_config(args):
    config = {}
    if os.path.exists(CONFIG_PATH):
        import json
        with open(CONFIG_PATH, encoding='utf-8') as f:
            config = json.load(f)
    config.setdefault('servidor', 'http://localhost:3000')
    config.setdefault('usuario', 'cafeteria1')
    config.setdefault('password', 'cafeteria123')
    config.setdefault('camera', 0)
    config.setdefault('umbral_confianza', 85)
    config.setdefault('cooldown_seg', 60)
    config.setdefault('refresh_seg', 300)
    config.setdefault('firma_check_seg', 10)
    if args.server:
        config['servidor'] = args.server
    if args.usuario:
        config['usuario'] = args.usuario
    if args.password:
        config['password'] = args.password
    return config


def login(server, usuario, password):
    resp = requests.post(server.rstrip('/') + '/api/login',
                         json={'usuario': usuario, 'password': password}, timeout=10)
    resp.raise_for_status()
    return resp.json()['token']


def reclamo_facial(server, token, id_huesped, hora):
    try:
        resp = requests.post(server.rstrip('/') + '/api/consumo-facial',
                             json={'id_huesped': id_huesped, 'hora': hora},
                             headers={'Authorization': 'Bearer ' + token}, timeout=10)
        if resp.status_code == 404:
            return {'ok': False, 'estado': 'no_encontrado', 'message': 'Huésped no registrado'}
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as e:
        return {'ok': False, 'estado': 'error', 'message': 'Error al contactar el servidor: ' + str(e)}


def consultar_estado(server, token, id_huesped, hora):
    """Consulta si el huésped ya recibió la comida de la ventana vigente (lectura)."""
    try:
        resp = requests.get(
            server.rstrip('/') + '/api/turnero/estado',
            params={'id_huesped': id_huesped, 'hora': hora},
            headers={'Authorization': 'Bearer ' + token}, timeout=10,
        )
        if resp.status_code == 404:
            return {'ok': False, 'estado': 'no_encontrado', 'message': 'Huésped no registrado'}
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as e:
        return {'ok': False, 'estado': 'error', 'message': 'Error al contactar el servidor: ' + str(e)}


def sonido_aprobacion():
    """Tonada de aprobación cuando se registra una comida."""
    try:
        import winsound
        winsound.Beep(880, 130)
        winsound.Beep(1318, 260)
    except Exception:
        print('\a', end='', flush=True)


def sonido_error():
    """Sonido cuando el reclamo es rechazado."""
    try:
        import winsound
        winsound.Beep(220, 320)
    except Exception:
        print('\a', end='', flush=True)


def firma_rostros(server, token):
    """Firma del conjunto de rostros del servidor (para detectar altas/bajas).

    Devuelve None si el servidor no responde; el kiosco entonces no re-entrena.
    """
    try:
        resp = requests.get(
            server.rstrip('/') + '/api/rostros/firma',
            headers={'Authorization': 'Bearer ' + token}, timeout=10,
        )
        resp.raise_for_status()
        return resp.json().get('firma')
    except requests.RequestException:
        return None


def borrar_modelo():
    """Elimina el modelo entrenado para que se re-genere desde cero."""
    for f in ('modelo_lbph.yml', 'labels.json'):
        ruta = os.path.join(MODELO_DIR, f)
        if os.path.exists(ruta):
            os.remove(ruta)


def preparar_modelo(server, token, config):
    """Descarga los rostros del servidor y reentrena el modelo LBPH."""
    ids = sincronizar_rostros(server, token)
    if not ids:
        # Sin rostros: limpiar el modelo para que no reconozca a nadie.
        try:
            borrar_modelo()
        except Exception:
            pass
        return False, 'El servidor no tiene rostros registrados todavia.'
    resultado = entrenar()
    return True, (
        f'Modelo actualizado: {resultado["entrenados"]} caras de '
        f'{len(resultado["personas"])} huespedes.'
    )


def modo_check(config):
    """Diagnóstico sin cámara: verifica dependencias y recursos."""
    print('=== Kiosco de cafetería — diagnóstico ===')
    print(f'Servidor: {config["servidor"]}')
    print(f'OpenCV : {cv2.__version__}')
    print(f'LBPH   : {"OK" if hay_soporte_lbph() else "NO (instale opencv-contrib-python)"}')
    print(f'Cascada: {"OK" if os.path.exists(os.path.join(os.path.dirname(os.path.abspath(__file__)), "recursos", "haarcascade_frontalface_default.xml")) else "FALTANTE"}')
    recognizer, labels = cargar_modelo()
    print(f'Modelo : {"OK" if recognizer else "no entrenado (ejecute entrenar.py)"}')
    print(f'Umbral : {config["umbral_confianza"]} (menor = más estricto; en cafeteria_config.json)')

    hoy = time.strftime('%H:%M')
    v = ventana_actual(hoy)
    print(f'Hora   : {hoy} -> {"ventana " + v["servicio"] + " " + v["inicio"] + "-" + v["fin"] if v else "sin servicio en este momento"}')
    print('=== Fin del diagnóstico ===')


def modo_foto(ruta, config):
    """Prueba el reconocimiento sobre una imagen estática."""
    cascada = cargar_cascada()
    recognizer, labels = cargar_modelo()
    if recognizer is None:
        print('No hay modelo entrenado. Ejecute primero: py python/entrenar.py')
        sys.exit(1)
    frame = cv2.imread(ruta)
    if frame is None:
        print(f'No se pudo leer la imagen: {ruta}')
        sys.exit(1)
    id_h, conf, box = predecir_rostro(frame, cascada, recognizer, labels, umbral=int(config['umbral_confianza']))
    nombres = mapa_nombres_rostros()
    if id_h:
        x, y, w, h = box
        cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 200, 0), 2)
        nombre = nombres.get(id_h) or f'Huesped {id_h}'
        cv2.putText(frame, nombre, (x, y - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 200, 0), 2, cv2.LINE_AA)
        print(f'Huesped reconocido: {nombre} (id_huesped={id_h}, confianza={conf:.0f})')
    elif box:
        x, y, w, h = box
        cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 0, 210), 2)
        cv2.putText(frame, 'NO SE RECONOCE ROSTRO', (x, y - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 210), 2, cv2.LINE_AA)
        print('Rostro detectado pero no reconocido (confianza por encima del umbral).')
    else:
        print('No se detectó ningún rostro en la imagen.')
    cv2.imshow('Reconocimiento (prueba)', frame)
    cv2.waitKey(0)
    cv2.destroyAllWindows()


def construir_botones(ancho, alto_frame):
    """Crea los botones RECIBIR DESAYUNO/ALMUERZO/CENA en la parte inferior."""
    botones = []
    margen = 20
    n = len(SERVICIOS)
    w = (ancho - margen * (n + 1)) // n
    h = 64
    y = alto_frame - h - 18
    for i, s in enumerate(SERVICIOS):
        x = margen + i * (w + margen)
        botones.append({
            'servicio': s,
            'etiqueta': f'RECIBIR {s.upper()}',
            'rect': (x, y, w, h),
            'activo': False,
        })
    return botones


def dibujar_botones(frame, botones):
    for b in botones:
        x, y, w, h = b['rect']
        color = COLOR_VERDE if b['activo'] else COLOR_BOTON_INACTIVO
        cv2.rectangle(frame, (x, y), (x + w, y + h), color, -1)
        cv2.rectangle(frame, (x, y), (x + w, y + h), (220, 220, 220), 1)
        texto = b['etiqueta']
        tam = cv2.getTextSize(texto, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 2)[0]
        tx = x + (w - tam[0]) // 2
        ty = y + (h + tam[1]) // 2
        cv2.putText(frame, texto, (tx, ty), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 2, cv2.LINE_AA)
        if b['activo']:
            cv2.putText(frame, 'PULSAR PARA REGISTRAR', (x + 6, y - 6),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, COLOR_VERDE, 1, cv2.LINE_AA)


def on_mouse(event, x, y, flags, param):
    if event == cv2.EVENT_LBUTTONDOWN:
        for b in param['botones']:
            rx, ry, rw, rh = b['rect']
            if b['activo'] and rx <= x <= rx + rw and ry <= y <= ry + rh:
                param['click'] = b['servicio']
                return


def modo_kiosco(config):
    cascada = cargar_cascada()
    recognizer, labels = cargar_modelo()

    if not hay_soporte_lbph():
        print('ERROR: Falta cv2.face (instale opencv-contrib-python).')
        sys.exit(1)

    umbral = int(config['umbral_confianza'])

    server = config['servidor'].rstrip('/')
    token = None

    while token is None:
        try:
            token = login(server, config['usuario'], config['password'])
            print(f'Sesión iniciada como {config["usuario"]}.')
        except requests.RequestException as e:
            print(f'Servidor no disponible ({e}). Reintentando en 10 s...')
            time.sleep(10)

    ok, mensaje_modelo = preparar_modelo(server, token, config)
    if ok:
        recognizer, labels = cargar_modelo()
        print(mensaje_modelo)
    else:
        recognizer, labels = None, None
        print('AVISO: ' + mensaje_modelo)
    nombres = mapa_nombres_rostros()

    cap = cv2.VideoCapture(config['camera'])
    if not cap.isOpened():
        print(f'ERROR: No se pudo abrir la cámara índice {config["camera"]}.')
        sys.exit(1)

    ventana_nombre = 'Kiosco Cafeteria - Hotel Andino'
    cv2.namedWindow(ventana_nombre, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(ventana_nombre, 960, 640)

    ui = {'botones': [], 'click': None}
    cv2.setMouseCallback(ventana_nombre, on_mouse, ui)
    ultimo_estado = 'Esperando rostro...'
    ultimo_color = COLOR_NEUTRO
    ultimo_refresh = time.time()
    ultimo_firma_check = time.time()
    ultimo_click = 0.0
    cooldown = int(config['cooldown_seg'])
    refresh = int(config['refresh_seg'])
    firma_check = int(config['firma_check_seg'])
    firma_actual = firma_rostros(server, token)
    estados = {}          # id_huesped -> {'tiempo': t, 'datos': info}
    cooldown_estado = 3   # segundos entre consultas de estado por huésped

    print('Cámara activa. Presione Q para salir.')
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                print('No se pudo leer el frame de la cámara.')
                break

            alto, ancho = frame.shape[:2]
            if not ui['botones']:
                ui['botones'] = construir_botones(ancho, alto)

            hhmm = time.strftime('%H:%M')
            ventana = ventana_actual(hhmm)
            banner = (
                f'RECIBIR {ventana["servicio"].upper()}  ({ventana["inicio"]} - {ventana["fin"]})'
                if ventana else 'SIN SERVICIO AHORA'
            )

            id_h, conf, box = predecir_rostro(frame, cascada, recognizer, labels, umbral=umbral)

            # --- Rostro detectado: dibujar recuadro y nombre ---
            if box:
                x, y, w, h = box
                if id_h:
                    nombre = nombres.get(id_h) or f'Huesped {id_h}'
                    cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 210, 0), 2)
                    cv2.putText(frame, nombre, (x, y - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 210, 0), 2, cv2.LINE_AA)
                else:
                    cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 0, 210), 2)
                    cv2.putText(frame, 'NO SE RECONOCE ROSTRO', (x, y - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 210), 2, cv2.LINE_AA)

            # --- Estado del huésped: ¿ya recibió la comida del día? ---
            info = None
            if id_h and ventana:
                ahora = time.time()
                prev = estados.get(id_h)
                if prev and ahora - prev['tiempo'] < cooldown_estado:
                    info = prev['datos']
                else:
                    info = consultar_estado(server, token, id_h, hhmm)
                    estados[id_h] = {'tiempo': ahora, 'datos': info}

            # --- Botones: solo el de la ventana vigente, y solo si el huésped NO ha recibido la comida ---
            disponible = bool(info) and info.get('estado') == 'disponible'
            for b in ui['botones']:
                b['activo'] = disponible and b['servicio'] == (ventana or {}).get('servicio')

            # --- Mensaje de estado principal ---
            nombre = nombres.get(id_h) if id_h else None
            if not box:
                ultimo_estado = 'Esperando rostro...'
                ultimo_color = COLOR_NEUTRO
            elif not id_h:
                ultimo_estado = 'NO SE RECONOCE ROSTRO'
                ultimo_color = COLOR_ROJO
            elif not ventana:
                ultimo_estado = f'Huesped: {nombre}  ·  Fuera del horario de servicio'
                ultimo_color = COLOR_GRIS
            elif not info:
                ultimo_estado = f'Huesped: {nombre}  ·  Verificando la comida del día...'
                ultimo_color = COLOR_GRIS
            elif info.get('estado') == 'disponible':
                ultimo_estado = f'{nombre}  ·  Pulse "{ventana["servicio"].upper()}" para registrar'
                ultimo_color = COLOR_VERDE
            elif info.get('estado') == 'ya_reclamado':
                ultimo_estado = info.get('message', f'{nombre} ya recibió el {ventana["servicio"].lower()} hoy.')
                ultimo_color = COLOR_AMARILLO
            else:
                ultimo_estado = info.get('message', 'No se pudo verificar el estado.')
                ultimo_color = ESTADO_COLOR.get(info.get('estado'), COLOR_ROJO)

            # --- Procesar clic en el botón habilitado ---
            if ui['click']:
                click_servicio = ui['click']
                ui['click'] = None
                if disponible and click_servicio == ventana['servicio']:
                    ahora = time.time()
                    if ahora - ultimo_click < 3:
                        ultimo_estado = 'Procesando... espere un momento.'
                    else:
                        ultimo_click = ahora
                        res = reclamo_facial(server, token, id_h, hhmm)
                        if res.get('ok'):
                            sonido_aprobacion()
                            ultimo_estado = res.get('message', 'Comida registrada.')
                            ultimo_color = ESTADO_COLOR.get(res['estado'], COLOR_VERDE)
                            estados.pop(id_h, None)  # al volver a consultar será "ya recibió"
                        else:
                            sonido_error()
                            ultimo_estado = res.get('message', 'No se pudo registrar.')
                            ultimo_color = ESTADO_COLOR.get(res['estado'], COLOR_ROJO)

            # --- Recarga del modelo cada N minutos (nuevos huéspedes) ---
            if time.time() - ultimo_refresh > refresh:
                ultimo_refresh = time.time()
                try:
                    ok2, msg = preparar_modelo(server, token, config)
                    if ok2:
                        recognizer, labels = cargar_modelo()
                        nombres = mapa_nombres_rostros()
                        print('[' + time.strftime('%H:%M:%S') + '] ' + msg)
                except Exception as e:
                    print('Error al refrescar el modelo:', e)

            # --- Detección rápida de cambios en los rostros (altas/bajas) ---
            if time.time() - ultimo_firma_check > firma_check:
                ultimo_firma_check = time.time()
                f = firma_rostros(server, token)
                if f is not None and f != firma_actual:
                    firma_actual = f
                    print('[' + time.strftime('%H:%M:%S') + '] Cambio en los rostros, re-entrenando modelo...')
                    try:
                        ok2, msg = preparar_modelo(server, token, config)
                        if ok2:
                            recognizer, labels = cargar_modelo()
                            nombres = mapa_nombres_rostros()
                        else:
                            recognizer, labels = None, None
                            nombres = {}
                        estados.clear()
                        print('[' + time.strftime('%H:%M:%S') + '] ' + msg)
                    except Exception as e:
                        print('Error al re-entrenar el modelo:', e)

            dibujar_etiqueta(frame, f'{banner}   |   {hhmm}', (40, 40, 40))
            dibujar_botones(frame, ui['botones'])
            y_mensaje = ui['botones'][0]['rect'][1] - 14
            cv2.putText(frame, ultimo_estado, (14, y_mensaje), cv2.FONT_HERSHEY_SIMPLEX, 0.6, ultimo_color, 2, cv2.LINE_AA)

            cv2.imshow(ventana_nombre, frame)
            tecla = cv2.waitKey(30) & 0xFF
            if tecla in (ord('q'), ord('Q'), 27):
                break
    finally:
        cap.release()
        cv2.destroyAllWindows()
        print('Kiosco detenido.')


def main():
    parser = argparse.ArgumentParser(description='Kiosco de cafetería con reconocimiento facial.')
    parser.add_argument('--check', action='store_true', help='Diagnóstico sin cámara')
    parser.add_argument('--foto', metavar='RUTA', help='Probar reconocimiento en una imagen')
    parser.add_argument('--server', help='URL del servidor (ej: http://192.168.1.20:3000)')
    parser.add_argument('--usuario', help='Usuario del kiosco')
    parser.add_argument('--password', help='Contraseña del kiosco')
    args = parser.parse_args()

    config = cargar_config(args)

    if args.check:
        modo_check(config)
        return
    if args.foto:
        modo_foto(args.foto, config)
        return
    modo_kiosco(config)


if __name__ == '__main__':
    main()
