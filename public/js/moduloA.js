/* ============================================================
   Módulo A — Validación de Huéspedes y Reservas
   - Búsqueda por documento o N° de reserva
   - Validación del plan de comidas
   - Control de consumo (marcar / evitar duplicados)
   ============================================================ */

const ModuloA = (() => {
  const ICONOS = { Desayuno: '\u2615', Almuerzo: '\u{1F372}', Cena: '\u{1F35D}' };
  const COMIDAS = ['Desayuno', 'Almuerzo', 'Cena'];

  let estadoActual = null; // resultado de la última búsqueda

  function init() {
    const form = document.getElementById('form-busqueda');
    form.addEventListener('submit', buscar);

    // Enter y tecla sin necesidad de recargar
    form.querySelectorAll('input').forEach((i) => {
      i.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') e.preventDefault();
      });
    });
  }

  async function buscar(e) {
    e.preventDefault();
    const tipo = document.getElementById('buscar-tipo').value;
    const valor = document.getElementById('buscar-valor').value.trim();

    if (!valor) {
      App.mostrarToast('Ingrese un documento o número de reserva.', 'error');
      return;
    }

    const btn = document.getElementById('btn-buscar');
    const label = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Buscando...';

    try {
      const datos = await Api.buscar(tipo, valor);
      estadoActual = datos;
      renderizar(datos);
    } catch (err) {
      renderError(err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = label;
    }
  }

  /* ---------- Renderizado ---------- */

  function renderizar(datos) {
    const cont = document.getElementById('resultado');
    cont.classList.remove('hidden');

    if (!datos.found) {
      cont.innerHTML = `<div class="alert alert-error">${esc(datos.message)}</div>`;
      return;
    }

    const h = datos.huesped;
    const r = datos.reserva;
    const plan = r.plan;

    cont.innerHTML = `
      <div class="alert alert-info">
        <strong>Huésped encontrado:</strong> ${esc(h.nombre)} — Habitación
        <strong>${esc(r.habitacion)}</strong>. Plan con
        <strong>${plan.total}</strong> de 3 comidas autorizadas.
      </div>

      <div class="result-grid">
        <!-- Datos del huésped -->
        <article class="card result-card">
          <h3>Datos del huésped</h3>
          <div class="data-row">
            <span class="data-label">Nombre</span>
            <span class="data-value">${esc(h.nombre)}</span>
          </div>
          <div class="data-row">
            <span class="data-label">Documento</span>
            <span class="data-value">${esc(h.tipo_documento)} ${esc(h.documento)}</span>
          </div>
          <div class="data-row">
            <span class="data-label">Teléfono</span>
            <span class="data-value">${esc(h.telefono || '—')}</span>
          </div>
          <div class="data-row">
            <span class="data-label">Email</span>
            <span class="data-value">${esc(h.email || '—')}</span>
          </div>
        </article>

        <!-- Datos de la reserva -->
        <article class="card result-card">
          <h3>Reserva ${esc(r.id_reserva)}</h3>
          <div class="data-row">
            <span class="data-label">Habitación</span>
            <span class="data-value">${esc(r.habitacion)}</span>
          </div>
          <div class="data-row">
            <span class="data-label">Check-in</span>
            <span class="data-value">${esc(r.fecha_checkin)}</span>
          </div>
          <div class="data-row">
            <span class="data-label">Check-out</span>
            <span class="data-value">${esc(r.fecha_checkout)}</span>
          </div>
          <div class="data-row">
            <span class="data-label">Estado</span>
            <span class="data-value">${r.estado === 'Activa'
              ? '<span class="badge badge-ok">Activa</span>'
              : '<span class="badge badge-no">' + esc(r.estado) + '</span>'}</span>
          </div>
        </article>
      </div>

      <!-- Validación del plan de comidas -->
      <article class="card">
        <h2 class="card-title">Validación del plan de comidas
          <span class="badge badge-ok">${plan.total}/3 comidas</span>
        </h2>
        <div class="plan-grid">
          ${plan.comidas.map((m) => tarjetaComida(m, r.id_reserva)).join('')}
        </div>
      </article>

      <!-- Consumos del día -->
      <article class="card">
        <h2 class="card-title">Consumos del día (${esc(r.id_reserva)})</h2>
        ${tablaConsumos(datos.consumos)}
      </article>
    `;

    // Delegación de eventos para "Marcar reclamado"
    cont.querySelectorAll('.btn-claim').forEach((btn) => {
      btn.addEventListener('click', () => reclamar(btn.dataset.reserva, btn.dataset.servicio));
    });
  }

  function tarjetaComida(comida, idReserva) {
    const clase = comida.incluida ? 'incluida' : 'no-incluida';
    const estado = comida.incluida ? 'Incluida' : 'No incluida';

    let accion = '';
    if (!comida.incluida) {
      accion = '<div class="meal-claim-info">No autorizada</div>';
    } else if (comida.reclamada) {
      accion = `<div class="meal-claim-info">Reclamado a las ${esc(comida.horaReclamo)}</div>`;
    } else {
      accion = `<button class="btn btn-claim" data-reserva="${esc(idReserva)}" data-servicio="${esc(comida.nombre)}">
                  Marcar como reclamado
                </button>`;
    }

    const claseCard = comida.reclamada ? 'meal-card claimed' : 'meal-card';
    return `
      <div class="${claseCard}">
        <div class="meal-icon">${ICONOS[comida.nombre] || ''}</div>
        <div class="meal-name">${comida.nombre}</div>
        <div class="meal-status ${clase}">${estado}</div>
        ${accion}
      </div>
    `;
  }

  function tablaConsumos(consumos) {
    if (!consumos || consumos.length === 0) {
      return '<p style="color:var(--texto-suave)">Aún no hay consumos registrados hoy para esta reserva.</p>';
    }
    const filas = consumos
      .map((c) => `
        <tr>
          <td>${esc(c.servicio)}</td>
          <td>${esc(c.fecha)}</td>
          <td>${esc(c.hora)}</td>
          <td><span class="badge badge-ok">Reclamado</span></td>
        </tr>
      `)
      .join('');
    return `
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Servicio</th><th>Fecha</th><th>Hora</th><th>Estado</th></tr>
          </thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
    `;
  }

  function renderError(mensaje) {
    const cont = document.getElementById('resultado');
    cont.classList.remove('hidden');
    cont.innerHTML = `<div class="alert alert-error">${esc(mensaje)}</div>`;
  }

  /* ---------- Acciones ---------- */

  async function reclamar(idReserva, servicio) {
    try {
      const datos = await Api.registrarConsumo(idReserva, servicio);
      App.mostrarToast(datos.message, 'success');

      // Actualizar el estado local para re-render sin re-buscar
      if (estadoActual && estadoActual.reserva) {
        estadoActual.consumos = datos.consumos;
        const comida = estadoActual.reserva.plan.comidas.find((m) => m.nombre === servicio);
        if (comida) {
          comida.reclamada = true;
          comida.horaReclamo = datos.consumo.hora;
        }
        renderizar(estadoActual);
      }
    } catch (err) {
      App.mostrarToast(err.message, 'error');
    }
  }

  function refrescarVista() {
    // Si ya hay un resultado visible, refrescarlo desde el servidor
    if (estadoActual && estadoActual.found) {
      const r = estadoActual.reserva;
      const tipo = r.id_reserva ? 'reserva' : 'documento';
      Api.buscar(tipo, r.id_reserva)
        .then((datos) => {
          estadoActual = datos;
          renderizar(datos);
        })
        .catch(() => {});
    }
  }

  /* ---------- Utilidades ---------- */

  function esc(valor) {
    return String(valor == null ? '' : valor)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  return { init, refrescarVista };
})();

document.addEventListener('DOMContentLoaded', ModuloA.init);
