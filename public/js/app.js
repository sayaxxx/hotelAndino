/* ============================================================
   App principal — sesión, roles, navegación y utilidades
   ============================================================ */

const App = (() => {
  const TITULOS = {
    inicio: 'Inicio',
    moduloA: 'Módulo A — Validación de Huéspedes y Reservas',
    moduloB: 'Módulo B — Comandas e Inventario',
    moduloC: 'Módulo C — Financiero y Reportes',
  };

  let sesion = null;

  function init() {
    // Navegación por botones con data-view
    document.querySelectorAll('[data-view]').forEach((el) => {
      el.addEventListener('click', () => {
        const view = el.getAttribute('data-view');
        mostrarVista(view);
      });
    });

    // Login
    document.getElementById('form-login').addEventListener('submit', iniciarSesion);

    // Logout
    document.getElementById('btn-logout').addEventListener('click', cerrarSesion);

    // Modal nueva reserva (admin)
    const btnNueva = document.getElementById('btn-nueva-reserva');
    btnNueva.addEventListener('click', () => abrirModal('modal-reserva', true));
    document.querySelectorAll('[data-cerrar-modal]').forEach((el) => {
      el.addEventListener('click', () => abrirModal('modal-reserva', false));
    });
    document.getElementById('form-reserva').addEventListener('submit', crearReserva);

    // Registro facial en el modal de nueva reserva
    document.getElementById('btn-cam').addEventListener('click', activarCamara);
    document.getElementById('btn-capturar').addEventListener('click', capturarRostro);
    document.getElementById('btn-descartar').addEventListener('click', descartarRostro);
    document.getElementById('res-foto').addEventListener('change', cargarFoto);

    // Si la sesión expira, volver al login
    document.addEventListener('andino:noauth', () => mostrarLogin());

    actualizarReloj();
    setInterval(actualizarReloj, 1000 * 30);

    verificarSesion();
  }

  /* ---------- Sesión ---------- */

  async function verificarSesion() {
    try {
      const datos = await Api.me();
      if (datos.autenticado) {
        sesion = datos;
        mostrarApp();
      } else {
        mostrarLogin();
      }
    } catch {
      mostrarLogin();
    }
  }

  async function iniciarSesion(e) {
    e.preventDefault();
    const usuario = document.getElementById('login-usuario').value.trim();
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('btn-login');
    const errEl = document.getElementById('login-error');

    errEl.classList.add('hidden');
    if (!usuario || !password) {
      errEl.textContent = 'Ingrese usuario y contraseña.';
      errEl.classList.remove('hidden');
      return;
    }

    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Ingresando...';
    try {
      const datos = await Api.login(usuario, password);
      Api.setToken(datos.token);
      sesion = datos;
      mostrarApp();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  async function cerrarSesion() {
    try { await Api.logout(); } catch { /* sin importar */ }
    Api.setToken('');
    sesion = null;
    mostrarLogin();
  }

  function mostrarApp() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');

    // Info del usuario
    document.getElementById('user-nombre').textContent = sesion.nombre;
    document.getElementById('user-rol').textContent = sesion.rol === 'admin' ? 'Administrador' : 'Mesero';
    document.getElementById('user-avatar').textContent = (sesion.nombre || '?').charAt(0).toUpperCase();

    aplicarRol(sesion.rol);
    mostrarVista('inicio');
  }

  function mostrarLogin() {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('app-shell').classList.add('hidden');
    document.getElementById('login-password').value = '';
  }

  function aplicarRol(rol) {
    const esAdmin = rol === 'admin';
    document.querySelectorAll('.solo-admin').forEach((el) => {
      el.classList.toggle('hidden', !esAdmin);
    });
    if (!esAdmin) {
      abrirModal('modal-reserva', false);
    }
  }

  /* ---------- Navegación ---------- */

  function mostrarVista(nombre) {
    // Módulos B y C son solo para administradores
    if (sesion && sesion.rol !== 'admin' && (nombre === 'moduloB' || nombre === 'moduloC')) {
      nombre = 'inicio';
    }

    document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
    const seccion = document.getElementById('view-' + nombre);
    if (seccion) seccion.classList.remove('hidden');

    document.querySelectorAll('.nav-item').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-view') === nombre);
    });

    const titulo = document.getElementById('page-title');
    if (titulo && TITULOS[nombre]) titulo.textContent = TITULOS[nombre];

    if (nombre === 'moduloA') ModuloA.refrescarVista();
    if (nombre === 'moduloB') ModuloB.refrescar();
    if (nombre === 'moduloC') ModuloC.refrescar();
  }

  /* ---------- Reloj ---------- */

  function actualizarReloj() {
    const ahora = new Date();
    const fecha = ahora.toLocaleDateString('es-CO', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
    const hora = ahora.toLocaleTimeString('es-CO', {
      hour: '2-digit', minute: '2-digit',
    });

    const elFecha = document.getElementById('today-date');
    const elReloj = document.getElementById('sidebar-clock');
    if (elFecha) {
      const primeraLetra = fecha.charAt(0).toUpperCase();
      elFecha.textContent = primeraLetra + fecha.slice(1);
    }
    if (elReloj) elReloj.textContent = hora;
  }

  /* ---------- Modal ---------- */

  function abrirModal(id, abrir) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.toggle('hidden', !abrir);
    if (abrir) {
      document.getElementById('res-fecha-in').value = hoyISO();
      document.getElementById('res-fecha-out').value = hoyISO();
    } else {
      descartarRostro();
    }
  }

  /* ---------- Captura de rostro (webcam / foto) ---------- */

  let stream = null;
  let rostroBase64 = null;

  function detenerCamara() {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    document.getElementById('res-video').srcObject = null;
  }

  function setEstadoRostro(texto) {
    document.getElementById('res-rostro-msg').textContent = texto;
  }

  async function activarCamara() {
    const video = document.getElementById('res-video');
    const ph = document.getElementById('res-ph');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      App.mostrarToast('La cámara no está disponible en este navegador (requiere HTTPS o localhost).', 'error');
      setEstadoRostro('Cámara no disponible. Use "Subir foto".');
      return;
    }
    try {
      detenerCamara();
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      video.srcObject = stream;
      video.classList.remove('hidden');
      document.getElementById('res-preview').classList.add('hidden');
      ph.classList.add('hidden');
      document.getElementById('btn-cam').textContent = 'Reiniciar cámara';
      document.getElementById('btn-capturar').disabled = false;
      setEstadoRostro('Mire a la cámara y presione "Capturar rostro".');
    } catch (err) {
      App.mostrarToast('No se pudo acceder a la cámara: ' + err.message, 'error');
      setEstadoRostro('No se pudo acceder a la cámara. Use "Subir foto".');
    }
  }

  function capturarRostro() {
    const video = document.getElementById('res-video');
    if (!stream || !video.videoWidth) {
      App.mostrarToast('Active primero la cámara.', 'error');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    rostroBase64 = canvas.toDataURL('image/jpeg', 0.9).split(',')[1];

    document.getElementById('res-preview').src = 'data:image/jpeg;base64,' + rostroBase64;
    document.getElementById('res-preview').classList.remove('hidden');
    video.classList.add('hidden');
    document.getElementById('res-ph').classList.add('hidden');
    detenerCamara();
    document.getElementById('btn-cam').textContent = 'Activar cámara';
    document.getElementById('btn-capturar').disabled = true;
    document.getElementById('btn-descartar').classList.remove('hidden');
    setEstadoRostro('Rostro capturado. Se guardará con la reserva.');
  }

  function cargarFoto(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      App.mostrarToast('El archivo debe ser una imagen.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      rostroBase64 = String(reader.result).split(',')[1];
      document.getElementById('res-preview').src = reader.result;
      document.getElementById('res-preview').classList.remove('hidden');
      document.getElementById('res-video').classList.add('hidden');
      document.getElementById('res-ph').classList.add('hidden');
      document.getElementById('btn-capturar').disabled = true;
      document.getElementById('btn-descartar').classList.remove('hidden');
      detenerCamara();
      document.getElementById('btn-cam').textContent = 'Activar cámara';
      setEstadoRostro('Foto cargada. Se guardará con la reserva.');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function descartarRostro() {
    rostroBase64 = null;
    detenerCamara();
    const video = document.getElementById('res-video');
    video.classList.add('hidden');
    video.srcObject = null;
    document.getElementById('res-preview').classList.add('hidden');
    document.getElementById('res-preview').removeAttribute('src');
    document.getElementById('res-ph').classList.remove('hidden');
    document.getElementById('btn-cam').textContent = 'Activar cámara';
    document.getElementById('btn-capturar').disabled = true;
    document.getElementById('btn-descartar').classList.add('hidden');
    setEstadoRostro('No se ha capturado ningún rostro.');
  }

  /* ---------- Nueva reserva (admin) ---------- */

  async function crearReserva(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-crear-reserva');
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Creando...';

    const comidas = Array.from(
      document.querySelectorAll('#form-reserva input[type="checkbox"]:checked')
    ).map((c) => c.value);

    const datos = {
      nombre: document.getElementById('res-nombre').value.trim(),
      documento: document.getElementById('res-documento').value.trim(),
      tipo_documento: document.getElementById('res-tipo-doc').value,
      telefono: document.getElementById('res-telefono').value.trim(),
      email: document.getElementById('res-email').value.trim(),
      habitacion: document.getElementById('res-habitacion').value.trim(),
      fecha_checkin: document.getElementById('res-fecha-in').value,
      fecha_checkout: document.getElementById('res-fecha-out').value,
      comidas,
    };

    if (rostroBase64) datos.rostro_base64 = rostroBase64;

    try {
      const resp = await Api.crearReserva(datos);
      App.mostrarToast(resp.message, 'success');
      abrirModal('modal-reserva', false);
      document.getElementById('form-reserva').reset();

      // Ir al Módulo A y mostrar la reserva recién creada
      mostrarVista('moduloA');
      ModuloA.buscarExterno('reserva', resp.reserva.id_reserva);
    } catch (err) {
      App.mostrarToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }

  function hoyISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function mostrarToast(mensaje, tipo = 'info') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = mensaje;
    toast.className = 'toast ' + tipo;
    toast.classList.remove('hidden');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.add('hidden'), 3200);
  }

  return { init, mostrarVista, mostrarToast };
})();

document.addEventListener('DOMContentLoaded', App.init);
