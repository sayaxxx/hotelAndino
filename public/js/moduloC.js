/* ============================================================
   Módulo C — Financiero y Reportes
   - Flujo de caja diario (cobros externos y consumos de huéspedes)
   - Reporte operativo (comidas entregadas del día)
   ============================================================ */

const ModuloC = (() => {
  const state = {
    caja: null,
    reporte: null,
  };

  const ORIGEN_LABEL = { externo: 'Cliente externo', huesped: 'Huésped', gasto: 'Gasto' };

  function init() {
    // Pestañas
    document.getElementById('moduloC-tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('.tab');
      if (!btn) return;
      activarTab(btn.dataset.tab);
    });

    // Origen -> mostrar campo de reserva
    document.getElementById('caja-origen').addEventListener('change', toggleCampoReserva);

    // Registrar movimiento
    document.getElementById('form-caja').addEventListener('submit', registrarMovimiento);
    document.getElementById('caja-reserva').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') e.preventDefault();
    });
  }

  /* ---------- Carga de datos ---------- */

  async function refrescar() {
    try {
      const [caja, reporte] = await Promise.all([
        Api.listarCaja(''),
        Api.reporteOperativo(''),
      ]);
      state.caja = caja;
      state.reporte = reporte;
      renderCajaResumen();
      renderTablaCaja();
      renderReporteResumen();
      renderGrafico();
      renderTablaConsumos();
    } catch (err) {
      App.mostrarToast(err.message, 'error');
    }
  }

  function activarTab(tab) {
    document.querySelectorAll('#moduloC-tabs .tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });
    document.querySelectorAll('#view-moduloC .tab-pane').forEach((p) => {
      p.classList.toggle('hidden', p.id !== tab);
    });
  }

  function toggleCampoReserva() {
    const origen = document.getElementById('caja-origen').value;
    document.getElementById('campo-caja-reserva').classList.toggle('hidden', origen !== 'huesped');
  }

  /* ---------- Flujo de caja ---------- */

  function renderCajaResumen() {
    const t = state.caja.totales;
    document.getElementById('caja-resumen').innerHTML = `
      ${statCard('Cobros externos', fmtPesos(t.externos), 'positivo')}
      ${statCard('Consumos de huéspedes', fmtPesos(t.huespedes), 'positivo')}
      ${statCard('Total ingresos', fmtPesos(t.ingresos), 'positivo')}
      ${statCard('Egresos', fmtPesos(t.egresos), 'negativo')}
      ${statCard('Neto del día', fmtPesos(t.neto), t.neto < 0 ? 'negativo' : 'neutro')}
    `;
  }

  function renderTablaCaja() {
    const cont = document.getElementById('tabla-caja');
    if (!state.caja.movimientos.length) {
      cont.innerHTML = '<p class="sin-datos">No hay movimientos registrados hoy.</p>';
      return;
    }
    const filas = state.caja.movimientos.map((m) => {
      const signo = m.tipo === 'ingreso' ? '+' : '-';
      const tipoBadge = m.tipo === 'ingreso' ? 'badge-ok' : 'badge-no';
      return `
        <tr>
          <td>${esc(m.hora)}</td>
          <td><span class="badge ${tipoBadge}">${m.tipo === 'ingreso' ? 'Ingreso' : 'Egreso'}</span></td>
          <td>${esc(ORIGEN_LABEL[m.origen] || m.origen)}${m.id_reserva ? ' <small>Res. ' + esc(m.id_reserva) + '</small>' : ''}</td>
          <td>${esc(m.concepto)}</td>
          <td class="valor-mov ${m.tipo}">${signo} ${fmtPesos(m.valor)}</td>
          <td>${esc(m.registrado_por || '—')}</td>
        </tr>`;
    }).join('');
    cont.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Hora</th><th>Tipo</th><th>Origen</th><th>Concepto</th><th>Valor</th><th>Registrado por</th></tr></thead>
      <tbody>${filas}</tbody>
    </table></div>`;
  }

  async function registrarMovimiento(e) {
    e.preventDefault();
    const tipo = document.getElementById('caja-tipo').value;
    const origen = document.getElementById('caja-origen').value;
    const concepto = document.getElementById('caja-concepto').value.trim();
    const valor = document.getElementById('caja-valor').value;
    const id_reserva = document.getElementById('caja-reserva').value.trim();

    if (!concepto) {
      App.mostrarToast('Indique el concepto del movimiento.', 'error');
      return;
    }
    if (!valor || parseFloat(valor) <= 0) {
      App.mostrarToast('Ingrese un valor mayor a cero.', 'error');
      return;
    }

    const btn = e.target.querySelector('button[type="submit"]');
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Registrando...';

    try {
      const resp = await Api.registrarCaja({
        tipo, origen, concepto, valor: parseFloat(valor),
        id_reserva: origen === 'huesped' ? id_reserva : '',
      });
      App.mostrarToast(resp.message, 'success');
      e.target.reset();
      toggleCampoReserva();
      await refrescar();
    } catch (err) {
      App.mostrarToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  /* ---------- Reporte operativo ---------- */

  function renderReporteResumen() {
    const c = state.reporte.comidas;
    const sub = state.reporte.comandas
      ? `${state.reporte.comandas.cantidad} comandas · ${fmtPesos(state.reporte.comandas.ventas)} en ventas`
      : '';
    document.getElementById('reporte-resumen').innerHTML = `
      ${statCard('Desayunos', c.Desayuno, 'neutro')}
      ${statCard('Almuerzos', c.Almuerzo, 'neutro')}
      ${statCard('Cenas', c.Cena, 'neutro')}
      ${statCard('Total comidas', state.reporte.totalComidas, 'neutro', sub)}
    `;
  }

  function renderGrafico() {
    const c = state.reporte.comidas;
    const max = Math.max(1, c.Desayuno, c.Almuerzo, c.Cena);
    const barras = [
      { nombre: 'Desayuno', valor: c.Desayuno, cls: 'desayuno' },
      { nombre: 'Almuerzo', valor: c.Almuerzo, cls: 'almuerzo' },
      { nombre: 'Cena', valor: c.Cena, cls: 'cena' },
    ].map((b) => `
      <div class="chart-col">
        <span class="chart-value">${b.valor}</span>
        <div class="chart-bar ${b.cls}" style="height: ${Math.round((b.valor / max) * 100)}%"></div>
        <span class="chart-label">${b.nombre}</span>
      </div>
    `).join('');
    document.getElementById('grafico-comidas').innerHTML = `<div class="chart">${barras}</div>`;
  }

  function renderTablaConsumos() {
    const cont = document.getElementById('tabla-consumos');
    if (!state.reporte.detalle.length) {
      cont.innerHTML = '<p class="sin-datos">Aún no hay comidas entregadas registradas hoy.</p>';
      return;
    }
    const filas = state.reporte.detalle.map((c) => `
      <tr>
        <td>${esc(c.hora)}</td>
        <td>${esc(c.huesped)}</td>
        <td>${esc(c.habitacion)}</td>
        <td>${esc(c.servicio)}</td>
        <td><span class="badge badge-ok">Entregado</span></td>
      </tr>
    `).join('');
    cont.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Hora</th><th>Huésped</th><th>Habitación</th><th>Servicio</th><th>Estado</th></tr></thead>
      <tbody>${filas}</tbody>
    </table></div>`;
  }

  /* ---------- Utilidades ---------- */

  function statCard(label, valor, clase, sub) {
    return `
      <div class="stat-card">
        <div class="stat-label">${esc(label)}</div>
        <div class="stat-value ${clase || ''}">${valor}</div>
        ${sub ? `<div class="stat-sub">${esc(sub)}</div>` : ''}
      </div>`;
  }

  function fmtPesos(n) {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(n || 0);
  }

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

document.addEventListener('DOMContentLoaded', ModuloC.init);
