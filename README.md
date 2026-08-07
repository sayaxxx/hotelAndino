# 🏨 Hotel Andino S.A.S. — Sistema de Gestión Hotelera

Sistema integral para la operación diaria del Hotel Andino: validación de huéspedes y reservas,
plan de comidas con **reconocimiento facial** en cafetería, **turnero** en pantalla de TV,
**comandas e inventario** del restaurante y **flujo de caja / reportes** financieros con gráficos y
descarga en PDF.

> Incluye dos interfaces: la **app web** (Node.js + Express + JavaScript vanilla) y el **panel de
> reportes** (Streamlit + Python) con descarga de reportes en PDF.

---

## ✨ Características

- **Módulo de huéspedes y reservas** — búsqueda automática por documento, número de reserva o
  nombre (con sugerencias en tiempo real), creación de reservas con plan de comidas
  (Desayuno / Almuerzo / Cena) y registro de consumos.
- **Reconocimiento facial (cafetería)** — kiosco en Python (OpenCV, LBPH) que identifica al huésped
  por su rostro, valida su plan y la ventana horaria, y genera el pedido/turno.
- **Turnero (pantalla TV)** — muestra en tiempo real los pedidos en preparación y listos para
  recoger, con sonido al llegar un pedido nuevo y marcado de **LISTO** / **RECOGIDO**.
- **Comandas e inventario** — comandas de mesa o de huésped con descuento automático de stock,
  control de inventario (alta, baja y stock mínimo).
- **Flujo de caja y reportes** — movimientos de caja (ingresos/egresos), balance del día y reporte
  operativo; panel Streamlit con gráficos y **descarga en PDF**.
- **Roles** — `admin` (todo) y `kiosco` (panel, reservas, comandas y turnero).
- **Sesiones simultáneas** — cada dispositivo/navegador mantiene su propia sesión (admin y kiosco
  pueden estar conectados a la vez).

---

## 🛠️ Tecnologías utilizadas

| Capa | Tecnología |
|------|------------|
| Backend | Node.js, Express |
| Frontend | HTML5, CSS3, JavaScript (vanilla), tema Navy/Emerald/Amber + fuente Inter |
| Persistencia | Archivos CSV (`data/`) + imágenes de rostros (`data/rostros/`) |
| Reconocimiento facial | Python, OpenCV (`cv2`), modelo LBPH, `requests` |
| Reportes | Python, Streamlit, pandas, matplotlib, fpdf2 |

---

## 📁 Estructura del proyecto

```
.
├── server/
│   └── server.js              # API Express (autenticación, módulos, CSV como base de datos)
├── public/                    # Frontend (app web)
│   ├── index.html             # Login + dashboard + vistas (admin/kiosco)
│   ├── turnero.html           # Pantalla de TV del turnero
│   ├── css/styles.css         # Tema y estilos
│   ├── css/turnero.css
│   └── js/
│       ├── api.js             # Capa de API (token Bearer)
│       ├── app.js             # Sesión, roles y navegación
│       ├── moduloA.js         # Huéspedes y reservas (búsqueda automática)
│       ├── comandas.js        # Comandas del restaurante
│       ├── inventario.js      # Inventario (alta/baja/stock)
│       ├── moduloC.js         # Flujo de caja y reporte operativo
│       ├── dashboard.js       # Estadísticas del día + asistente IA
│       ├── reservasAdmin.js   # Administración de reservas
│       └── turnero.js         # Lógica del turnero TV
├── python/                    # Kiosco de cafetería (reconocimiento facial)
│   ├── cafeteria.py           # App del kiosco (identifica, genera turno, reclama comida)
│   ├── entrenar.py            # Entrenamiento del modelo LBPH
│   ├── analisis.py
│   ├── face_utils.py
│   └── cafeteria_config.json  # Configuración (servidor, credenciales, cámara)
├── reportes/                  # Panel de reportes Streamlit
│   ├── reportes.py            # Balance, gráficos y PDF (descarga)
│   └── run_reportes.bat       # Lanzador en Windows
├── data/                      # Base de datos (CSV) — ver sección Datos
└── package.json
```

---

## ✅ Requisitos previos

- **Node.js** 18+ (para el servidor web)
- **Python** 3.10+ (para el kiosco facial y el panel de reportes)
- Dependencias de Node: solo `express`

---

## 📥 Clonación y descarga

### Opción A — Clonar con Git

```bash
git clone https://github.com/TU-USUARIO/hotel-andino.git
cd hotel-andino
```

### Opción B — Descargar como ZIP

1. Entra al repositorio en GitHub.
2. Botón verde **Code ▾ → Download ZIP**.
3. Extrae el ZIP en una carpeta y ábrela en la terminal.

---

## ⚙️ Instalación

```bash
# 1) Dependencias de Node (servidor web)
npm install

# 2) Dependencias de Python (kiosco facial + panel de reportes)
pip install -r requirements.txt
```

> `requirements.txt` incluye: `opencv-contrib-python`, `numpy`, `requests`, `streamlit`, `pandas`,
> `matplotlib` y `fpdf2`. El reconocimiento facial (LBPH) requiere `opencv-contrib-python`
> (**no** `opencv-python`, que no trae el módulo `cv2.face`).

---

## 🚀 Guía rápida: correr el sistema en otra PC

Pasos para descargar y levantar el sistema en **cualquier computador** (Windows, macOS o Linux)
sin configuración adicional:

1. **Instala los requisitos** (una sola vez): [Node.js 18+](https://nodejs.org) y Python 3.10+
   (el panel de reportes y el kiosco facial son opcionales; la app web solo necesita Node).
2. **Descarga el proyecto** — clona con Git o descarga el ZIP (ver [Clonación y descarga](#-clonación-y-descarga))
   y extrae la carpeta en cualquier ubicación.
3. **Abre una terminal** en la carpeta del proyecto.
4. **Instala las dependencias de Node**:
   ```bash
   npm install
   ```
5. **Instala las dependencias de Python** (solo si usarás reportes o el kiosco facial):
   ```bash
   pip install -r requirements.txt
   ```
6. **Arranca el servidor web**:
   ```bash
   npm start
   ```
   Debe imprimir `[Hotel Andino] Servidor listo en http://localhost:3000`.
7. **Abre el navegador** en `http://localhost:3000` e inicia sesión con
   `admin` / `admin123` (o `kiosco` / `kiosco123`).
8. **Verifica que todo funcione**:
   - El login carga y la app entra al Panel de Control.
   - Reservas, Comandas, Inventario y Caja responden sin errores.
   - En Windows, el panel de reportes abre con doble clic en `reportes\run_reportes.bat`
     (o con `python -m streamlit run reportes/reportes.py`).

> El sistema **no necesita configuración previa**: no hay base de datos externa ni claves, los
> datos viven en `data/*.csv` y todas las rutas son relativas al proyecto, por lo que corre en
> cualquier carpeta o máquina.

---

## 🚀 Uso / Arranque

### 1. Servidor web (API + frontend)

```bash
npm start
```

Se sirve en **http://localhost:3000** (o en la IP de la máquina para usarlo desde otros
dispositivos de la red). En Windows también puedes doble clic en el `.bat` que prefieras usar.

### 2. Panel de reportes Streamlit (opcional)

```bash
python reportes/reportes.py
```

Se abre en **http://localhost:8501**. En Windows: doble clic en `reportes\run_reportes.bat`.

### 3. Kiosco de cafetería (reconocimiento facial)

```bash
python python/cafeteria.py --server http://localhost:3000
```

La configuración está en `python/cafeteria_config.json`:

```json
{
  "servidor": "http://localhost:3000",
  "usuario": "kiosco",
  "password": "kiosco123",
  "camera": 0,
  "umbral_confianza": 85,
  "cooldown_seg": 60,
  "refresh_seg": 300
}
```

---

## 🔑 Credenciales de demostración

| Rol | Usuario | Contraseña |
|-----|---------|------------|
| Administrador | `admin` | `admin123` |
| Kiosco | `kiosco` | `kiosco123` |

> **Importante:** cambia estas contraseñas antes de usar el sistema en producción. Las
> credenciales se guardan en texto plano en `data/usuarios.csv`.

---

## 🖥️ Despliegue en varios dispositivos (red local)

El servidor soporta **sesiones simultáneas** (un token por login). Cada pantalla usa su propio
navegador con su propia sesión:

| Dispositivo | URL | Sesión |
|-------------|-----|--------|
| Recepción | `http://<IP-servidor>:3000` | `admin` |
| Kiosco (marcar LISTO / RECOGIDO) | `http://<IP-servidor>:3000` | `kiosco` |
| Turnero TV | `http://<IP-servidor>:3000/turnero.html` | `kiosco` (login una vez) |
| Escáner facial | `python/cafeteria.py` | automática (`kiosco`) |

- Averigua la IP del servidor con `ipconfig` (Windows) o `ip addr` (Linux).
- Cambia `"servidor"` en `cafeteria_config.json` a la IP de la red si el kiosco no corre en la
  misma máquina.
- No inicies sesión con dos roles distintos en el mismo navegador (la segunda sesión reemplaza a la
  primera en `localStorage`).

---

## 🔌 Endpoints de la API

Todas las rutas devuelven JSON. Las rutas protegidas requieren la cabecera:

```
Authorization: Bearer <token>
```

El token se obtiene con `POST /api/login`.

| Método | Ruta | Acceso | Descripción |
|--------|------|--------|-------------|
| `POST` | `/api/login` | público | Inicia sesión y devuelve `token`, `nombre` y `rol`. Body: `{ usuario, password }` |
| `POST` | `/api/logout` | 🔒 | Cierra la sesión del token actual |
| `GET` | `/api/me` | 🔒 | Información de la sesión actual (`{ autenticado, usuario, nombre, rol }`) |
| `GET` | `/api/search?tipo=&valor=` | 🔒 | Búsqueda de huésped. `tipo`: `auto` (documento/reserva/nombre con sugerencias), `documento`, `reserva` |
| `GET` | `/api/reservas/:id/consumos` | 🔒 | Consumos del día de una reserva |
| `POST` | `/api/consumos` | 🔒 | Registra un consumo del plan. Body: `{ id_reserva, servicio }` (`Desayuno`/`Almuerzo`/`Cena`) |
| `POST` | `/api/reservas` | 🔒 admin | Crea reserva (+ huésped si no existe). Body: `{ nombre, documento, habitacion, fecha_checkin, fecha_checkout, comidas[], rostro_base64? }` |
| `GET` | `/api/reservas?desde=&hasta=` | 🔒 admin | Lista reservas con su huésped |
| `DELETE` | `/api/reservas/:id` | 🔒 admin | Elimina una reserva |
| `DELETE` | `/api/huespedes/:id` | 🔒 admin | Elimina un huésped |
| `GET` | `/api/rostros` | 🔒 | Lista los rostros registrados (base64) y su firma |
| `GET` | `/api/rostros/firma` | 🔒 | Firma del conjunto de rostros (para sincronización del kiosco) |
| `POST` | `/api/consumo-facial` | 🔒 | Reclamo de comida por rostro. Body: `{ id_huesped, hora? }`. Valida plan y ventana |
| `GET` | `/api/turnero?fecha=` | 🔒 | Pedidos activos del turnero + último entregado |
| `GET` | `/api/turnero/historial?fecha=` | 🔒 | Historial del día (recogidos) |
| `GET` | `/api/turnero/estado?id_huesped=&hora=` | 🔒 | ¿El huésped ya recibió la comida de la ventana vigente? |
| `POST` | `/api/turnero/:id/lista` | 🔒 | Marca un pedido como listo para recoger |
| `POST` | `/api/turnero/:id/recogido` | 🔒 | Marca un pedido como recogido |
| `GET` | `/api/meseros` | 🔒 | Lista de meseros |
| `GET` | `/api/mesas` | 🔒 | Lista de mesas |
| `GET` | `/api/platos` | 🔒 | Lista de platos con sus recetas |
| `GET` | `/api/inventario` | 🔒 | Inventario con stock y alertas |
| `PUT` | `/api/inventario/:id` | 🔒 admin | Ajusta el stock. Body: `{ stock }` |
| `POST` | `/api/inventario` | 🔒 admin | Crea producto. Body: `{ nombre, unidad, stock, stock_minimo }` |
| `DELETE` | `/api/inventario/:id` | 🔒 admin | Elimina un producto |
| `POST` | `/api/comandas` | 🔒 | Crea comanda y descuenta stock. Body: `{ id_mesero, tipo_servicio: 'mesa'\|'huesped', id_mesa?, id_reserva?, platos: [{ id_plato, cantidad }] }` |
| `GET` | `/api/comandas?fecha=` | 🔒 | Comandas del día con cliente y ítems |
| `POST` | `/api/comandas/:id/entregar` | 🔒 | Marca entregada. Si es de huésped suma al balance como *consumo de huésped*; si es de mesa, como *venta de comanda* |
| `POST` | `/api/comandas/:id/cancelar` | 🔒 | Cancela y restaura el stock |
| `GET` | `/api/caja?fecha=` | 🔒 admin | Movimientos y totales del día (externos, huéspedes, comandas, ingresos, egresos, neto) |
| `POST` | `/api/caja` | 🔒 admin | Registra movimiento. Body: `{ tipo: 'ingreso'\|'egreso', origen: 'externo'\|'huesped'\|'gasto', id_reserva?, concepto, valor }` |
| `GET` | `/api/reporte-operativo?fecha=` | 🔒 admin | Comidas entregadas del día y detalle |
| `GET` | `/api/dashboard?fecha=` | 🔒 | Estadísticas del día (reservas activas, comidas pendientes/entregadas, stock bajo) |
| `GET` | `/` | público | Sirve la app web (`index.html`) |

🔒 = requiere token Bearer. `admin` = además exige rol administrador.

---

## 🗃️ Datos (archivos CSV)

Todo se persiste como CSV en `data/`:

| Archivo | Contenido |
|---------|-----------|
| `usuarios.csv` | Usuarios y contraseñas |
| `huespedes.csv` | Huéspedes (documento, contacto) |
| `reservas.csv` | Reservas y plan de comidas |
| `consumos.csv` | Comidas reclamadas por día |
| `turnero.csv` | Tickets del turnero (estado: `EN_PREPARACION` → `LISTO_PARA_RECOGER` → `RECOGIDO`) |
| `caja.csv` | Movimientos de caja (fecha, hora, origen, concepto, valor) |
| `comandas.csv` | Comandas registradas |
| `comanda_platos.csv` | ítems de cada comanda |
| `platos.csv` | Catálogo de platos |
| `plato_ingredientes.csv` | Receta: consumo de producto por plato |
| `productos.csv` | Inventario (stock, stock mínimo) |
| `mesas.csv` | Mesas del restaurante |
| `rostros/` | Fotografías de los huéspedes (reconocimiento facial) |

---

## 📊 Reportes (Streamlit)

`reportes/reportes.py` genera:

- **Balance del día** — ingresos por origen (externos, huéspedes, comandas), egresos y neto.
- **Gráficos** — ingresos por origen, composición, evolución de 14 días y comidas entregadas.
- **Comandas del día** y **detalle de consumos**.
- **Alertas de inventario** (agotados / stock bajo).
- **Descarga en PDF** del reporte completo con gráficos.

---

## 🩺 Solución de problemas

| Problema | Solución |
|----------|----------|
| `npm` no se reconoce | Instala Node.js 18+ y reinicia la terminal |
| `python` no se reconoce en Windows | Usa `py` en vez de `python`, o marca **Add to PATH** al instalar Python |
| `EADDRINUSE` al arrancar | El puerto 3000 está ocupado: usa otro con `set PORT=3001` (Windows) o `PORT=3001` (Linux/macOS) y ejecuta `npm start` |
| `cv2.face` no existe | Instala `opencv-contrib-python` (no `opencv-python`) |
| El panel de reportes no abre | Ejecuta `streamlit run reportes/reportes.py` (o el `.bat`); requiere `pip install -r requirements.txt` |
| El botón "Abrir panel de reportes" no carga | Ese botón usa `localhost:8501`: abre el reporte en la máquina donde corre Streamlit, o usa `http://<IP-del-servidor>:8501` |
| Otros dispositivos no cargan la página | El servidor debe escuchar en la red: entra con `http://<IP-del-servidor>:3000` y permite el puerto en el firewall/antivirus |
| No hay rostros en el kiosco facial | Las fotos viven en `data/rostros/` y **no se comparten por privacidad**; se generan al registrar huéspedes con foto |

---

## ⚠️ Consideraciones y seguridad

- **Sesiones en memoria**: las sesiones se guardan en un `Map` de Node; al reiniciar el servidor
  todos los dispositivos deben volver a iniciar sesión.
- **Contraseñas en texto plano** en `data/usuarios.csv`: cámbialas para producción.
- **Horarios de comida** configurados en `server/server.js` (`VENTANAS_COMIDA`):
  Desayuno 05:00–08:30, Almuerzo 12:00–15:00, Cena 18:00–21:00.

---

## 📝 Licencia

Fines Academicos

## Autor:

Arlhey Fabian Abadia Jaimes
