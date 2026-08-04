/* ============================================================
   App principal — navegación, reloj y utilidades comunes
   ============================================================ */

const App = (() => {
  const TITULOS = {
    inicio: 'Inicio',
    moduloA: 'Módulo A — Validación de Huéspedes y Reservas',
    moduloB: 'Módulo B — Comandas e Inventario',
    moduloC: 'Módulo C — Financiero y Reportes',
  };

  function init() {
    // Navegación por botones con data-view
    document.querySelectorAll('[data-view]').forEach((el) => {
      el.addEventListener('click', () => {
        const view = el.getAttribute('data-view');
        mostrarVista(view);
      });
    });

    actualizarReloj();
    setInterval(actualizarReloj, 1000 * 30);
    mostrarVista('inicio');
  }

  function mostrarVista(nombre) {
    document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
    const seccion = document.getElementById('view-' + nombre);
    if (seccion) seccion.classList.remove('hidden');

    document.querySelectorAll('.nav-item').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-view') === nombre);
    });

    const titulo = document.getElementById('page-title');
    if (titulo && TITULOS[nombre]) titulo.textContent = TITULOS[nombre];

    if (nombre === 'moduloA') ModuloA.refrescarVista();
  }

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
