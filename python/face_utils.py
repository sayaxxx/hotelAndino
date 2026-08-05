"""Utilidades de reconocimiento facial con OpenCV para Hotel Andino S.A.S.

Flujo:
  1) El servidor guarda los rostros en data/rostros/{id_huesped}.jpg
     (se capturan al registrar una reserva).
  2) El kiosco de la cafetería descarga esos rostros (GET /api/rostros),
     entrena un modelo LBPH y reconoce a los huéspedes en tiempo real.
"""

import base64
import glob
import json
import os

import cv2
import numpy as np

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROYECTO_DIR = os.path.dirname(BASE_DIR)
ROSTROS_DIR = os.path.join(PROYECTO_DIR, 'data', 'rostros')
LOCAL_ROSTROS_DIR = os.path.join(BASE_DIR, 'rostros_local')
MODELO_DIR = os.path.join(BASE_DIR, 'modelo')
CASCADA_PATH = os.path.join(BASE_DIR, 'recursos', 'haarcascade_frontalface_default.xml')

FACE_W = 200
FACE_H = 200


def hay_soporte_lbph():
    """True si cv2.face (LBPH) está disponible (requiere opencv-contrib-python)."""
    return hasattr(cv2, 'face') and hasattr(cv2.face, 'LBPHFaceRecognizer_create')


def cargar_cascada():
    if not os.path.exists(CASCADA_PATH):
        raise FileNotFoundError(
            'No se encontró la cascada Haar. Colóquela en:\n'
            + CASCADA_PATH
            + '\n(descargar de github.com/opencv/opencv/blob/master/data/'
            + 'haarcascades/haarcascade_frontalface_default.xml)'
        )
    return cv2.CascadeClassifier(CASCADA_PATH)


def leer_rostros_local(carpeta=LOCAL_ROSTROS_DIR):
    """Lista las imágenes locales de rostros. Nombre: {id_huesped}__{nombre}.jpg."""
    rostros = []
    if not os.path.isdir(carpeta):
        return rostros
    patrones = ('*.jpg', '*.jpeg', '*.png')
    archivos = sorted(
        f for p in patrones for f in glob.glob(os.path.join(carpeta, p))
    )
    for ruta in archivos:
        nombre_archivo = os.path.basename(ruta)
        base = nombre_archivo.rsplit('.', 1)[0]
        partes = base.split('__', 1)
        id_huesped = partes[0]
        nombre = partes[1] if len(partes) > 1 else ''
        rostros.append({'id_huesped': id_huesped, 'nombre': nombre, 'ruta': ruta})
    return rostros


def extraer_rostro(cascada, ruta):
    """Recorta y normaliza la cara más grande de una imagen a gris FACE_WxFACE_H."""
    img = cv2.imread(ruta)
    if img is None:
        return None
    gris = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    caras = cascada.detectMultiScale(gris, scaleFactor=1.1, minNeighbors=5, minSize=(60, 60))
    if len(caras) == 0:
        return None
    x, y, w, h = max(caras, key=lambda c: c[2] * c[3])
    roi = gris[y:y + h, x:x + w]
    return cv2.resize(roi, (FACE_W, FACE_H))


def entrenar(carpeta=LOCAL_ROSTROS_DIR):
    """Entrena el modelo LBPH con las imágenes de la carpeta y lo guarda en modelo/."""
    if not hay_soporte_lbph():
        raise RuntimeError('Falta cv2.face. Instale: py -m pip install opencv-contrib-python')
    cascada = cargar_cascada()
    rostros = leer_rostros_local(carpeta)
    if not rostros:
        raise ValueError('No hay imágenes de rostros para entrenar en: ' + carpeta)

    imagenes, etiquetas = [], []
    mapa = {}
    omitidos = []
    for r in rostros:
        roi = extraer_rostro(cascada, r['ruta'])
        if roi is None:
            omitidos.append(r['id_huesped'])
            continue
        if r['id_huesped'] not in mapa:
            mapa[r['id_huesped']] = len(mapa)
        imagenes.append(roi)
        etiquetas.append(mapa[r['id_huesped']])

    if not imagenes:
        raise ValueError(
            'No se detectaron rostros en las imágenes (use fotos frontales, bien iluminadas).'
            + (f' Omitidas: {", ".join(omitidos)}' if omitidos else '')
        )

    recognizer = cv2.face.LBPHFaceRecognizer_create()
    recognizer.train(imagenes, np.array(etiquetas, dtype=np.int32))

    os.makedirs(MODELO_DIR, exist_ok=True)
    recognizer.write(os.path.join(MODELO_DIR, 'modelo_lbph.yml'))
    with open(os.path.join(MODELO_DIR, 'labels.json'), 'w', encoding='utf-8') as f:
        json.dump({str(v): k for k, v in mapa.items()}, f, ensure_ascii=False, indent=2)

    return {
        'rostros': len(rostros),
        'entrenados': len(imagenes),
        'personas': list(mapa.keys()),
        'omitidos': omitidos,
    }


def cargar_modelo():
    """Devuelve (recognizer, labels) o (None, None) si no hay modelo entrenado."""
    modelo_path = os.path.join(MODELO_DIR, 'modelo_lbph.yml')
    labels_path = os.path.join(MODELO_DIR, 'labels.json')
    if not os.path.exists(modelo_path) or not os.path.exists(labels_path):
        return None, None
    recognizer = cv2.face.LBPHFaceRecognizer_create()
    recognizer.read(modelo_path)
    with open(labels_path, encoding='utf-8') as f:
        labels = json.load(f)
    return recognizer, labels


def sincronizar_rostros(server_url, token, carpeta=LOCAL_ROSTROS_DIR):
    """Descarga los rostros del servidor y los guarda localmente para entrenar."""
    import requests
    os.makedirs(carpeta, exist_ok=True)
    resp = requests.get(
        server_url.rstrip('/') + '/api/rostros',
        headers={'Authorization': 'Bearer ' + token},
        timeout=15,
    )
    resp.raise_for_status()
    datos = resp.json().get('rostros', [])

    for archivo in os.listdir(carpeta):
        os.remove(os.path.join(carpeta, archivo))

    guardados = []
    for rostro in datos:
        id_huesped = str(rostro['id_huesped'])
        nombre = str(rostro.get('nombre') or id_huesped)
        if not rostro.get('imagen'):
            continue
        try:
            contenido = base64.b64decode(rostro['imagen'])
        except Exception:
            continue
        nombre_archivo = ''.join(c for c in (id_huesped + '__' + nombre) if c.isalnum() or c in '-_.').replace(' ', '_') + '.jpg'
        with open(os.path.join(carpeta, nombre_archivo), 'wb') as f:
            f.write(contenido)
        guardados.append(id_huesped)
    return guardados


def predecir_rostro(frame_bgr, cascada, recognizer, labels, umbral=85):
    """Detecta el rostro más grande y predice el id_huesped.

    Devuelve:
      - (id_huesped, confianza, (x, y, w, h)) si fue identificado
      - (None, confianza, (x, y, w, h)) si hay un rostro pero NO se reconoce
      - (None, None, None) si no hay ningún rostro en el frame
    """
    if recognizer is None or labels is None:
        return None, None, None
    gris = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    caras = cascada.detectMultiScale(gris, scaleFactor=1.1, minNeighbors=5, minSize=(80, 80))
    if len(caras) == 0:
        return None, None, None
    x, y, w, h = max(caras, key=lambda c: c[2] * c[3])
    roi = cv2.resize(gris[y:y + h, x:x + w], (FACE_W, FACE_H))
    etiqueta, confianza = recognizer.predict(roi)
    id_huesped = labels.get(str(etiqueta))
    if id_huesped and confianza <= umbral:
        return id_huesped, confianza, (x, y, w, h)
    return None, confianza, (x, y, w, h)


def mapa_nombres_rostros(carpeta=LOCAL_ROSTROS_DIR):
    """id_huesped -> nombre, a partir de los archivos locales {id}__{nombre}.jpg."""
    return {r['id_huesped']: r['nombre'] for r in leer_rostros_local(carpeta)}


def dibujar_etiqueta(frame, texto, color):
    """Dibuja una franja de estado en la parte superior del frame."""
    alto = 42
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, 0), (frame.shape[1], alto), color, -1)
    cv2.addWeighted(overlay, 0.75, frame, 0.25, 0, frame)
    cv2.putText(frame, texto, (14, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2, cv2.LINE_AA)


def ventana_actual(hhmm):
    """Ventana de servicio vigente según hora HH:MM (info visual del kiosco).

    Nota: la ventana de Cena termina a las 23:59 temporalmente mientras se hacen
    pruebas; luego se ajustará a su horario definitivo.
    """
    ventanas = [
        {'servicio': 'Desayuno', 'inicio': '05:00', 'fin': '08:30'},
        {'servicio': 'Almuerzo', 'inicio': '12:00', 'fin': '15:00'},
        {'servicio': 'Cena', 'inicio': '17:30', 'fin': '23:59'},
    ]
    for v in ventanas:
        if v['inicio'] <= hhmm <= v['fin']:
            return v
    return None
