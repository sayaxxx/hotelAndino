/* ============================================================
   Panel de Control — dashboard con resumen y asistente IA
   - Estadísticas del día (huéspedes, reservas, comidas)
   - Asistente de texto con recomendaciones (solo admin)
   ============================================================ */

const Dashboard = (() => {
  const ICONO = { Desayuno: '\u2615', Almuerzo: '\u{1F372}', Cena: '\u{1F35D}' };

  function fmtPesos(n) {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency', currency: 'COP', maximumFractionDigits: 0,
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

  async function refrescar() {
    try {
      const datos = await Api.listarDashboard();
      renderStats(datos);
      renderAsistente(datos);
      renderBienvenida(datos);
    } catch (err) {
      App.mostrarToast(err.message, 'error');
    }
  }

  function renderStats(d) {
    const pendientes = (d.pendientes.Desayuno || 0) + (d.pendientes.Almuerzo || 0) + (d.pendientes.Cena || 0);
    document.getElementById('dashboard-stats').innerHTML = [
      statCard('Huéspedes alojados', d.total_huespedes, 'neutro'),
      statCard('Reservas activas', d.reservas.activas, 'positivo'),
      statCard('Check-ins hoy', d.reservas.checkins_hoy, 'positivo'),
      statCard('Check-outs hoy', d.reservas.checkouts_hoy, 'neutro'),
      statCard('Comidas pendientes', pendientes, d.reservas.activas ? 'positivo' : 'neutro'),
      statCard('Comidas entregadas', d.total_entregados_hoy, 'neutro'),
    ].join('');
  }

  function renderAsistente(d) {
    const cont = document.getElementById('asistente');
    if (!cont) return;

    const pendientes = (d.pendientes.Desayuno || 0) + (d.pendientes.Almuerzo || 0) + (d.pendientes.Cena || 0);

    const lineas = [];
    lineas.push(`Hoy ${d.fecha} hay <strong>${d.total_huespedes} huéspedes</strong> alojados con <strong>${d.reservas.activas} reservas activas</strong> (${d.reservas.checkins_hoy} check-in y ${d.reservas.checkouts_hoy} check-out).`);

    if (pendientes > 0) {
      lineas.push(`Quedan <strong>${pendientes} comidas por entregar</strong>: ${formatPendientes(d.pendientes)}.`);
      const recomendada = ['Desayuno', 'Almuerzo', 'Cena'].sort((a, b) => (d.pendientes[b] || 0) - (d.pendientes[a] || 0))[0];
      lineas.push(`Consejo: prepare el <strong>${recomendada}</strong> primero, es el servicio con más demanda pendiente.`);
    } else {
      lineas.push('No hay comidas pendientes en este momento.');
    }

    lineas.push(`Se han entregado <strong>${d.total_entregados_hoy} comidas</strong> durante el día.`);

    if (d.stock_bajo && d.stock_bajo.length) {
      const nombres = d.stock_bajo.slice(0, 5).map((p) => `${esc(p.nombre)} (${esc(p.stock)}${p.unidad ? ' ' + esc(p.unidad) : ''})`).join(', ');
      lineas.push(`<strong class="asistente-warn">Alerta de stock bajo:</strong> ${nombres}${d.stock_bajo.length > 5 ? ' y otros.' : ' Revise el módulo Inventario.'}`);
    }
    if (d.agotados && d.agotados.length) {
      const nombres = d.agotados.slice(0, 5).map((p) => esc(p.nombre)).join(', ');
      lineas.push(`<strong class="asistente-warn">Productos agotados:</strong> ${nombres}${d.agotados.length > 5 ? ' y otros.' : ' Pueden afectar la preparación de platos.'}`);
    }
    if (!d.agotados || !d.agotados.length) {
      lineas.push('El inventario de productos disponibles está en orden.');
    }

    cont.innerHTML = `<ul class="asistente-list">
      ${lineas.map((l) => `<li>${l}</li>`).join('')}
    </ul>`;
  }

  function formatPendientes(p) {
    return ['Desayuno', 'Almuerzo', 'Cena']
      .filter((m) => (p[m] || 0) > 0)
      .map((m) => `${ICONO[m]} ${m}: <strong>${p[m]}</strong>`)
      .join(' · ') || 'ninguna';
  }

  function renderBienvenida(d) {
    const titulo = document.getElementById('bienvenida-titulo');
    const texto = document.getElementById('bienvenida-texto');
    if (!titulo || !texto) return;
    titulo.textContent = 'Bienvenido al sistema';
    texto.innerHTML = `Use el menú lateral para validar huéspedes y reservas, registrar comandas, gestionar el inventario y revisar los reportes del día. Hoy es <strong>${esc(d.fecha)}</strong>.`;
  }

  function statCard(label, valor, clase) {
    return `
      <div class="stat-card">
        <div class="stat-label">${esc(label)}</div>
        <div class="stat-value ${clase || ''}">${valor}</div>
      </div>`;
  }

  return { refrescar };
})();
