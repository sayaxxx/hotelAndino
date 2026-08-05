/* ============================================================
   Turnero — Pantalla de TV para la cafetería (Hotel Andino)
   ============================================================ */

const Turnero = (() => {
  let timerPoll = null;
  let timerReloj = null;
  const idsVistos = new Set(); // tickets que ya estaban en pantalla (para sonar al llegar nuevos)

  // Ventanas de comida (mismas que el servidor; Cena temporal hasta 23:59)
  const VENTANAS = [
    { servicio: 'Desayuno', inicio: '05:00', fin: '08:30' },
    { servicio: 'Almuerzo', inicio: '12:00', fin: '15:00' },
    { servicio: 'Cena', inicio: '17:30', fin: '23:59' },
  ];

  function init() {
    document.getElementById('form-turnero-login').addEventListener('submit', iniciarSesion);

    verificarSesion();
    actualizarReloj();
    timerReloj = setInterval(actualizarReloj, 1000);

    document.addEventListener('andino:noauth', mostrarLogin);
  }

  /* ---------- Sesión ---------- */

  async function verificarSesion() {
    try {
      const datos = await Api.me();
      if (datos.autenticado) iniciarApp();
      else mostrarLogin();
    } catch {
      mostrarLogin();
    }
  }

  function mostrarLogin() {
    detenerPolling();
    document.getElementById('turnero-login').classList.remove('hidden');
    document.getElementById('turnero-app').classList.add('hidden');
  }

  async function iniciarSesion(e) {
    e.preventDefault();
    const btn = document.querySelector('#form-turnero-login button');
    const errEl = document.getElementById('tl-error');
    errEl.textContent = '';
    const usuario = document.getElementById('tl-usuario').value.trim();
    const password = document.getElementById('tl-password').value;
    btn.disabled = true;
    btn.textContent = 'Conectando...';
    try {
      const datos = await Api.login(usuario, password);
      Api.setToken(datos.token);
      iniciarApp();
    } catch (err) {
      errEl.textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Conectar pantalla';
    }
  }

  function iniciarApp() {
    document.getElementById('turnero-login').classList.add('hidden');
    document.getElementById('turnero-app').classList.remove('hidden');
    document.getElementById('tl-conexion').textContent = 'Pantalla conectada';
    refrescar();
    detenerPolling();
    timerPoll = setInterval(refrescar, 3000);
  }

  function detenerPolling() {
    if (timerPoll) { clearInterval(timerPoll); timerPoll = null; }
  }

  /* ---------- Carga y render ---------- */

  async function refrescar() {
    try {
      const datos = await Api.listarTurnero();
      const pedidos = datos.turnero || [];
      const conexion = document.getElementById('tl-conexion');

      // Sonido cuando llega un pedido nuevo
      pedidos.forEach((p) => {
        if (p.estado === 'EN_PREPARACION' && !idsVistos.has(p.id)) {
          sonarNuevoPedido();
        }
        idsVistos.add(p.id);
      });

      // Limpiar los que ya no están activos
      const activos = new Set(pedidos.map((p) => p.id));
      idsVistos.forEach((id) => { if (!activos.has(id)) idsVistos.delete(id); });

      renderLista('lista-preparacion', pedidos.filter((p) => p.estado === 'EN_PREPARACION'), 'preparacion');
      renderLista('lista-listo', pedidos.filter((p) => p.estado === 'LISTO_PARA_RECOGER'), 'listo');
      renderUltimoEntregado(datos.ultimo_entregado);
      conexion.textContent = 'Actualizado ' + new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (err) {
      document.getElementById('tl-conexion').textContent = err.message || 'Sin conexión';
    }
  }

  function renderUltimoEntregado(t) {
    const el = document.getElementById('tl-ultimo');
    el.textContent = t
      ? `📢 Último entregado: ${t.huesped} - Plato Entregado Correctamente`
      : '📢 Último entregado: —';
  }

  function renderLista(contenedorId, pedidos, tipo) {
    const cont = document.getElementById(contenedorId);
    if (pedidos.length === 0) {
      cont.innerHTML = '<div class="sin-pedidos">Sin pedidos</div>';
      return;
    }
    cont.innerHTML = '';
    pedidos.forEach((p) => {
      const fila = document.createElement('div');
      fila.className = 'ticket-fila ' + (tipo === 'listo' ? 'fila-listo' : 'fila-preparacion');

      const num = String(p.id).padStart(3, '0');
      const hab = `<span class="hab">(Hab. ${escapeHtml(p.habitacion)})</span>`;

      fila.innerHTML = `
        <span class="fila-nombre">• ${escapeHtml(p.huesped)} ${hab}</span>
        <span class="fila-numero">${tipo === 'listo' ? `<strong class="num-ticket">[#${num}]</strong>` : ''}</span>
        <div class="fila-acciones">
          ${tipo === 'preparacion'
            ? `<button class="btn-accion btn-listo" data-accion="lista" data-id="${p.id}">✓ LISTO</button>`
            : `<button class="btn-accion btn-recogido" data-accion="recogido" data-id="${p.id}">RECOGIDO</button>`}
        </div>
      `;
      cont.appendChild(fila);
    });
  }

  async function accion(ticketId, tipo) {
    try {
      if (tipo === 'lista') await Api.turneroListo(ticketId);
      else if (tipo === 'recogido') await Api.turneroRecogido(ticketId);
      refrescar();
    } catch (err) {
      document.getElementById('tl-conexion').textContent = err.message || 'Error';
      refrescar();
    }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  /* ---------- Reloj y sonido ---------- */

  function actualizarReloj() {
    const ahora = new Date();

    const h = ahora.getHours();
    const h12 = h % 12 || 12;
    const mm = String(ahora.getMinutes()).padStart(2, '0');
    const ampm = h < 12 ? 'AM' : 'PM';
    document.getElementById('tl-hora').textContent = `${h12}:${mm} ${ampm}`;
    document.getElementById('tl-fecha').textContent = ahora.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const turnoEl = document.getElementById('tl-turno');
    const hhmm = `${String(h).padStart(2, '0')}:${mm}`;
    const ventana = VENTANAS.find((v) => hhmm >= v.inicio && hhmm <= v.fin);
    turnoEl.textContent = ventana
      ? `Turno Actual: ${ventana.servicio}`
      : 'Turno Actual: —';
  }

  function sonarNuevoPedido() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } catch { /* sin audio */ }
  }

  /* ---------- Delegación de clics ---------- */

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-accion');
    if (!btn) return;
    accion(btn.dataset.id, btn.dataset.accion);
  });

  return { init };
})();

document.addEventListener('DOMContentLoaded', Turnero.init);
