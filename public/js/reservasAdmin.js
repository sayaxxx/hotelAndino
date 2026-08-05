/* ============================================================
   Reservas y Usuarios — Administración (solo admin)
   - Lista todas las reservas con su huésped
   - Filtro por rango de fechas (estadías en el rango)
   - Eliminar reservas y/o huéspedes (con sus datos asociados)
   ============================================================ */

const ReservasAdmin = (() => {
  let filtro = { desde: '', hasta: '' };

  function init() {
    document.getElementById('form-filtro-reservas').addEventListener('submit', (e) => {
      e.preventDefault();
      filtro.desde = document.getElementById('filtro-desde').value;
      filtro.hasta = document.getElementById('filtro-hasta').value;
      refrescar();
    });

    document.getElementById('btn-limpiar-filtro').addEventListener('click', () => {
      filtro = { desde: '', hasta: '' };
      document.getElementById('filtro-desde').value = '';
      document.getElementById('filtro-hasta').value = '';
      refrescar();
    });

    // Delegación de acciones de la tabla
    document.getElementById('tabla-reservas').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-accion]');
      if (!btn) return;
      if (btn.dataset.accion === 'del-reserva') eliminarReserva(btn.dataset.id, btn.dataset.nombre);
      if (btn.dataset.accion === 'del-huesped') eliminarHuesped(btn.dataset.id, btn.dataset.nombre);
    });
  }

  async function refrescar() {
    const cont = document.getElementById('tabla-reservas');
    cont.innerHTML = '<div class="sin-acciones">Cargando...</div>';
    const resumen = document.getElementById('filtro-resumen');
    try {
      const datos = await Api.listarReservas(filtro.desde, filtro.hasta);
      resumen.textContent = (datos.desde || datos.hasta)
        ? `Mostrando ${datos.total} reserva(s) en el rango ${datos.desde || 'inicio'} → ${datos.hasta || 'hoy'}.`
        : `Mostrando todas las reservas (${datos.total}).`;
      renderTabla(cont, datos.reservas);
    } catch (err) {
      cont.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    }
  }

  function renderTabla(cont, reservas) {
    if (reservas.length === 0) {
      cont.innerHTML = '<div class="sin-acciones">No hay reservas para los criterios indicados.</div>';
      return;
    }

    const filas = reservas.map((r) => {
      const comidas = [
        r.incluye_desayuno ? 'Desayuno' : null,
        r.incluye_almuerzo ? 'Almuerzo' : null,
        r.incluye_cena ? 'Cena' : null,
      ].filter(Boolean).join(', ') || 'Ninguna';

      const estado = r.estado === 'Activa'
        ? '<span class="badge badge-ok">Activa</span>'
        : '<span class="badge badge-no">' + esc(r.estado) + '</span>';

      return `
        <tr>
          <td><strong>${esc(r.id_reserva)}</strong></td>
          <td>${esc(r.huesped)}<br>
            <span class="sin-acciones">${esc(r.tipo_documento)} ${esc(r.documento)}</span></td>
          <td>${esc(r.habitacion)}</td>
          <td>${esc(r.fecha_checkin)}</td>
          <td>${esc(r.fecha_checkout)}</td>
          <td>${estado}</td>
          <td>${esc(comidas)}</td>
          <td>${esc(r.consumos)}</td>
          <td>
            <button class="btn btn-sm btn-danger" data-accion="del-reserva"
              data-id="${esc(r.id_reserva)}" data-nombre="${esc(r.huesped)}">Borrar reserva</button>
            <button class="btn btn-sm btn-danger" data-accion="del-huesped"
              data-id="${esc(r.id_huesped)}" data-nombre="${esc(r.huesped)}">Borrar usuario</button>
          </td>
        </tr>
      `;
    }).join('');

    cont.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Reserva</th><th>Huésped</th><th>Hab.</th>
              <th>Check-in</th><th>Check-out</th><th>Estado</th>
              <th>Plan</th><th>Consumos</th><th>Acciones</th>
            </tr>
          </thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
    `;
  }

  async function eliminarReserva(id, nombre) {
    if (!confirm(
      `¿Eliminar la reserva ${id} (${nombre})?\n\nSe borrarán también sus consumos y registros del turnero. Esta acción no se puede deshacer.`
    )) return;
    try {
      const datos = await Api.eliminarReserva(id);
      App.mostrarToast(datos.message, 'success');
      refrescar();
    } catch (err) {
      App.mostrarToast(err.message, 'error');
    }
  }

  async function eliminarHuesped(id, nombre) {
    if (!confirm(
      `¿Eliminar el usuario ${nombre}?\n\nSe borrarán también sus reservas, consumos, registros del turnero y su foto de reconocimiento facial. Esta acción no se puede deshacer.`
    )) return;
    try {
      const datos = await Api.eliminarHuesped(id);
      App.mostrarToast(datos.message, 'success');
      refrescar();
    } catch (err) {
      App.mostrarToast(err.message, 'error');
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

  return { init, refrescar };
})();

document.addEventListener('DOMContentLoaded', ReservasAdmin.init);
