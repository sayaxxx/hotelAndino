/* ============================================================
   Módulo A — Validación de Huéspedes y Reservas
   - Autobúsqueda mientras se escribe (documento / N° de reserva / nombre)
   - Validación del plan de comidas
   - Control de consumo (marcar / evitar duplicados)
   ============================================================ */

const ModuloA = (() => {
  const ICONOS = { Desayuno: '\u2615', Almuerzo: '\u{1F372}', Cena: '\u{1F35D}' };
  const COMIDAS = ['Desayuno', 'Almuerzo', 'Cena'];

  let estadoActual = null; // resultado de la última búsqueda
  let debounceTimer = null;

  function init() {
    const input = document.getElementById('buscar-valor');
    input.addEventListener('input', () => programarBusqueda());

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') e.preventDefault();
    });
  }

  /* ---------- Autobúsqueda ---------- */

  function programarBusqueda() {
    const valor = document.getElementById('buscar-valor').value.trim();
    const cont = document.getElementById('resultado');
    const estado = document.getElementById('buscar-estado');

    clearTimeout(debounceTimer);

    if (!valor) {
      estado.textContent = '';
      estado.classList.remove('spinning');
      estadoActual = null;
      cont.classList.add('hidden');
      cont.innerHTML = '';
      return;
    }

    estado.textContent = '…';
    estado.classList.add('spinning');
    debounceTimer = setTimeout(() => buscarAuto(valor), 350);
  }

  async function buscarAuto(valor) {
    const estado = document.getElementById('buscar-estado');
    try {
      const datos = await Api.buscar('auto', valor);
      estado.textContent = '';
      estado.classList.remove('spinning');
      if (datos.found) {
        estadoActual = datos;
        renderizar(datos);
        return;
      }
      renderSugerencias(datos.sugerencias || [], datos.message, valor);
    } catch (err) {
      estado.textContent = '';
      estado.classList.remove('spinning');
      renderError(err.message);
    }
  }

  function seleccionarSugerencia(idReserva) {
    const input = document.getElementById('buscar-valor');
    input.value = idReserva;
    clearTimeout(debounceTimer);
    buscarAuto(idReserva);
  }

  /* ---------- Renderizado ---------- */

  function renderSugerencias(lista, mensaje, valor) {
    const cont = document.getElementById('resultado');
    cont.classList.remove('hidden');

    if (!lista.length) {
      cont.innerHTML = `<div class="alert alert-info">${esc(mensaje || 'Sin coincidencias.')}</div>`;
      return;
    }

    cont.innerHTML = `
      <div class="card">
        <h2 class="card-title">Seleccione una coincidencia</h2>
        <div class="sugerencia-list">
          ${lista.map((s) => `
            <button type="button" class="sugerencia-card" data-reserva="${esc(s.id_reserva)}">
              <div class="sugerencia-txt">
                <strong>${esc(s.huesped)}</strong>
                <span class="sugerencia-sub">
                  Res. ${esc(s.id_reserva)} · Hab. ${esc(s.habitacion)} · ${esc(s.documento)}
                </span>
              </div>
              <span class="sugerencia-flecha">&rsaquo;</span>
            </button>
          `).join('')}
        </div>
      </div>`;

    cont.querySelectorAll('.sugerencia-card').forEach((btn) => {
      btn.addEventListener('click', () => seleccionarSugerencia(btn.dataset.reserva));
    });
  }

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
      return '<p class="sin-datos">Aún no hay consumos registrados hoy para esta reserva.</p>';
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
      Api.buscar('auto', r.id_reserva)
        .then((datos) => {
          if (datos.found) {
            estadoActual = datos;
            renderizar(datos);
          }
        })
        .catch(() => {});
    }
  }

  // Búsqueda programática (usada por App al crear una reserva)
  function buscarExterno(idReserva) {
    const input = document.getElementById('buscar-valor');
    input.value = idReserva;
    clearTimeout(debounceTimer);
    buscarAuto(idReserva);
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

  return { init, refrescarVista, buscarExterno };
})();

document.addEventListener('DOMContentLoaded', ModuloA.init);
