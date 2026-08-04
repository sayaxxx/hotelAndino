/* ============================================================
   Módulo B — Comandas e Inventario
   - Registro de pedidos (mesero + mesa/huésped + platos)
   - Descuento automático de stock
   - Gestión de inventario y comandas del día
   ============================================================ */

const ModuloB = (() => {
  const state = {
    platos: [],
    meseros: [],
    mesas: [],
    inventario: [],
    comandas: [],
    seleccion: {}, // id_plato -> cantidad
    catActiva: 'Todas',
  };

  function init() {
    // Pestañas
    document.getElementById('moduloB-tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('.tab');
      if (!btn) return;
      activarTab(btn.dataset.tab);
    });

    // Filtro de categorías
    document.getElementById('filtro-categorias').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      state.catActiva = chip.dataset.cat;
      document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.cat === state.catActiva));
      renderPlatos();
    });

    // Tipo de servicio
    document.querySelectorAll('input[name="com-tipo"]').forEach((r) => {
      r.addEventListener('change', toggleTipoServicio);
    });

    // Steppers y cantidad en la lista de platos (delegación)
    document.getElementById('lista-platos').addEventListener('click', (e) => {
      const btn = e.target.closest('.stepper-btn');
      if (!btn) return;
      cambiarCantidad(btn.dataset.plato, parseInt(btn.dataset.delta, 10));
    });
    document.getElementById('lista-platos').addEventListener('input', (e) => {
      if (!e.target.classList.contains('stepper-input')) return;
      setearCantidad(e.target.dataset.plato, parseInt(e.target.value, 10));
    });

    // Quitar plato del resumen
    document.getElementById('resumen-platos').addEventListener('click', (e) => {
      const btn = e.target.closest('.resumen-item-del');
      if (!btn) return;
      setearCantidad(btn.dataset.quitar, 0);
    });

    // Registrar comanda
    document.getElementById('btn-registrar-comanda').addEventListener('click', registrarComanda);

    // Inventario (delegación)
    document.getElementById('tabla-inventario').addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-actualizar-stock');
      if (!btn) return;
      const input = document.getElementById('stock-input-' + btn.dataset.id);
      ajustarStock(btn.dataset.id, input.value);
    });

    // Comandas (delegación)
    document.getElementById('tabla-comandas').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-accion]');
      if (!btn) return;
      if (btn.dataset.accion === 'entregar') entregarComanda(btn.dataset.id);
      if (btn.dataset.accion === 'cancelar') cancelarComanda(btn.dataset.id);
    });

    document.getElementById('com-reserva').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') e.preventDefault();
    });
  }

  /* ---------- Carga de datos ---------- */

  async function refrescar() {
    try {
      const [meseros, mesas, platos, inventario, comandas] = await Promise.all([
        Api.listarMeseros(),
        Api.listarMesas(),
        Api.listarPlatos(),
        Api.listarInventario(),
        Api.listarComandas(''),
      ]);
      state.meseros = meseros.meseros;
      state.mesas = mesas.mesas;
      state.platos = platos.platos;
      state.inventario = inventario.inventario;
      state.comandas = comandas.comandas;

      llenarMeseroSelect();
      llenarMesaSelect();
      renderFiltros();
      renderPlatos();
      renderResumen();
      renderInventario();
      renderComandas();
    } catch (err) {
      App.mostrarToast(err.message, 'error');
    }
  }

  function activarTab(tab) {
    document.querySelectorAll('#moduloB-tabs .tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });
    document.querySelectorAll('#view-moduloB .tab-pane').forEach((p) => {
      p.classList.toggle('hidden', p.id !== tab);
    });
  }

  /* ---------- Selects ---------- */

  function llenarMeseroSelect() {
    const sel = document.getElementById('com-mesero');
    const actual = sel.value;
    sel.innerHTML = '<option value="">Seleccionar...</option>' +
      state.meseros.map((m) => `<option value="${esc(m.id)}">${esc(m.nombre)}</option>`).join('');
    if (state.meseros.some((m) => m.id === actual)) sel.value = actual;
  }

  function llenarMesaSelect() {
    const sel = document.getElementById('com-mesa');
    const actual = sel.value;
    sel.innerHTML = '<option value="">Seleccionar...</option>' +
      state.mesas.map((m) => `<option value="${esc(m.id)}">${esc(m.nombre)}</option>`).join('');
    if (state.mesas.some((m) => m.id === actual)) sel.value = actual;
  }

  /* ---------- Platos y selección ---------- */

  function renderFiltros() {
    const cats = ['Todas', ...new Set(state.platos.map((p) => p.categoria))];
    document.getElementById('filtro-categorias').innerHTML = cats.map((c) =>
      `<button class="chip ${c === state.catActiva ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`
    ).join('');
  }

  function renderPlatos() {
    const cont = document.getElementById('lista-platos');
    const filtrados = state.platos.filter(
      (p) => state.catActiva === 'Todas' || p.categoria === state.catActiva
    );
    if (!filtrados.length) {
      cont.innerHTML = '<p class="sin-datos">No hay platos en esta categoría.</p>';
      return;
    }
    cont.innerHTML = filtrados.map((p) => {
      const cant = state.seleccion[p.id] || 0;
      const badge = p.porcionesDisponibles <= 0
        ? '<span class="badge badge-no">Agotado</span>'
        : p.stockBajo
          ? '<span class="badge badge-warn">Stock bajo</span>'
          : '<span class="badge badge-ok">Disponible</span>';
      return `
        <div class="plato-card ${cant > 0 ? 'selected' : ''}">
          <div class="plato-top">
            <span class="plato-cat">${esc(p.categoria)}</span>${badge}
          </div>
          <div class="plato-nombre">${esc(p.nombre)}</div>
          <div class="plato-precio">${fmtPesos(p.precio)}</div>
          <div class="stepper">
            <button type="button" class="stepper-btn" data-plato="${esc(p.id)}" data-delta="-1">&minus;</button>
            <input type="number" class="stepper-input" data-plato="${esc(p.id)}" value="${cant}" min="0" max="${esc(p.porcionesDisponibles)}" />
            <button type="button" class="stepper-btn" data-plato="${esc(p.id)}" data-delta="1">+</button>
          </div>
        </div>`;
    }).join('');
  }

  function cambiarCantidad(id, delta) {
    const actual = state.seleccion[id] || 0;
    setearCantidad(id, actual + delta);
  }

  function setearCantidad(id, cantidad) {
    const nueva = Math.max(0, cantidad || 0);
    if (nueva === 0) {
      delete state.seleccion[id];
    } else {
      const plato = state.platos.find((p) => p.id === id);
      if (plato && nueva > plato.porcionesDisponibles) {
        App.mostrarToast(
          `Solo se pueden preparar ${plato.porcionesDisponibles} porciones de ${plato.nombre} con el stock actual.`,
          'error'
        );
        return;
      }
      state.seleccion[id] = nueva;
    }
    renderPlatos();
    renderResumen();
  }

  function renderResumen() {
    const ids = Object.keys(state.seleccion).filter((id) => state.seleccion[id] > 0);
    const cont = document.getElementById('resumen-platos');
    let total = 0;

    const filas = ids.map((id) => {
      const plato = state.platos.find((p) => p.id === id);
      const cant = state.seleccion[id];
      const sub = plato.precio * cant;
      total += sub;
      return `
        <div class="resumen-item">
          <span class="resumen-item-nombre">${esc(plato.nombre)} &times; ${cant}</span>
          <span class="resumen-item-sub">${fmtPesos(sub)}</span>
          <button type="button" class="resumen-item-del" data-quitar="${esc(id)}">&times;</button>
        </div>`;
    }).join('');

    cont.innerHTML = filas || '<p class="sin-datos">Aún no hay platos seleccionados.</p>';
    document.getElementById('resumen-total').textContent = fmtPesos(total);
    document.getElementById('btn-registrar-comanda').disabled = ids.length === 0;
    limpiarError();
  }

  function toggleTipoServicio() {
    const tipo = document.querySelector('input[name="com-tipo"]:checked').value;
    document.getElementById('campo-mesa').classList.toggle('hidden', tipo !== 'mesa');
    document.getElementById('campo-reserva').classList.toggle('hidden', tipo !== 'huesped');
  }

  /* ---------- Registrar comanda ---------- */

  async function registrarComanda() {
    const ids = Object.keys(state.seleccion).filter((id) => state.seleccion[id] > 0);
    if (!ids.length) {
      App.mostrarToast('Seleccione al menos un plato.', 'error');
      return;
    }
    const id_mesero = document.getElementById('com-mesero').value;
    if (!id_mesero) {
      App.mostrarToast('Seleccione el mesero responsable.', 'error');
      return;
    }
    const tipo = document.querySelector('input[name="com-tipo"]:checked').value;
    let id_mesa = '';
    let id_reserva = '';
    if (tipo === 'mesa') {
      id_mesa = document.getElementById('com-mesa').value;
      if (!id_mesa) {
        App.mostrarToast('Seleccione la mesa.', 'error');
        return;
      }
    } else {
      id_reserva = document.getElementById('com-reserva').value.trim();
      if (!id_reserva) {
        App.mostrarToast('Ingrese el número de reserva del huésped.', 'error');
        return;
      }
    }

    const platos = ids.map((id) => ({ id_plato: id, cantidad: state.seleccion[id] }));
    const btn = document.getElementById('btn-registrar-comanda');
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Registrando...';

    try {
      const resp = await Api.crearComanda({ id_mesero, tipo_servicio: tipo, id_mesa, id_reserva, platos });
      App.mostrarToast(resp.message, 'success');
      state.seleccion = {};
      limpiarError();
      await refrescar();
    } catch (err) {
      if (err.faltantes) {
        mostrarFaltantes(err.faltantes);
      } else {
        App.mostrarToast(err.message, 'error');
      }
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  function mostrarFaltantes(faltantes) {
    const div = document.getElementById('comanda-error');
    div.innerHTML = `<strong>Stock insuficiente para registrar la comanda:</strong><ul>
      ${faltantes.map((f) => `<li>${esc(f)}</li>`).join('')}
    </ul>`;
    div.classList.remove('hidden');
  }

  function limpiarError() {
    const div = document.getElementById('comanda-error');
    div.classList.add('hidden');
    div.innerHTML = '';
  }

  /* ---------- Inventario ---------- */

  function renderInventario() {
    const cont = document.getElementById('tabla-inventario');
    if (!state.inventario.length) {
      cont.innerHTML = '<p class="sin-datos">No hay productos registrados.</p>';
      return;
    }
    const filas = state.inventario.map((p) => {
      const cls = p.estado === 'Agotado' ? 'badge-no' : p.estado === 'Bajo' ? 'badge-warn' : 'badge-ok';
      return `
        <tr>
          <td><strong>${esc(p.nombre)}</strong></td>
          <td>${esc(p.unidad)}</td>
          <td>
            <input type="number" id="stock-input-${esc(p.id)}" class="stock-input" value="${esc(p.stock)}" min="0" step="0.01" />
          </td>
          <td>${esc(p.stock_minimo)}</td>
          <td><span class="badge ${cls}">${p.estado}</span></td>
          <td><button type="button" class="btn btn-secondary btn-sm btn-actualizar-stock" data-id="${esc(p.id)}">Actualizar</button></td>
        </tr>`;
    }).join('');
    cont.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Producto</th><th>Unidad</th><th>Stock</th><th>Stock mínimo</th><th>Estado</th><th></th></tr></thead>
      <tbody>${filas}</tbody>
    </table></div>`;
  }

  async function ajustarStock(id, valor) {
    const v = parseFloat(valor);
    if (isNaN(v) || v < 0) {
      App.mostrarToast('Ingrese un stock válido.', 'error');
      return;
    }
    try {
      const resp = await Api.ajustarStock(id, v);
      App.mostrarToast(resp.message, 'success');
      await refrescar();
    } catch (err) {
      App.mostrarToast(err.message, 'error');
    }
  }

  /* ---------- Comandas del día ---------- */

  function renderComandas() {
    const cont = document.getElementById('tabla-comandas');
    if (!state.comandas.length) {
      cont.innerHTML = '<p class="sin-datos">No hay comandas registradas hoy.</p>';
      return;
    }
    const filas = state.comandas.map((c) => {
      const platosStr = c.items.map((i) => `${esc(i.nombre)} &times;${i.cantidad}`).join(', ');
      const cls = c.estado === 'Entregada' ? 'badge-ok' : c.estado === 'Cancelada' ? 'badge-no' : 'badge-warn';
      let acciones = '<span class="sin-acciones">&mdash;</span>';
      if (c.estado === 'Registrada') {
        acciones = `
          <button class="btn btn-primary btn-sm" data-id="${esc(c.id_comanda)}" data-accion="entregar">Entregar</button>
          <button class="btn btn-danger btn-sm" data-id="${esc(c.id_comanda)}" data-accion="cancelar">Cancelar</button>`;
      }
      return `
        <tr>
          <td><strong>#${esc(c.id_comanda)}</strong></td>
          <td>${esc(c.mesero)}</td>
          <td>${esc(c.cliente)}</td>
          <td>${platosStr}</td>
          <td>${esc(c.hora)}</td>
          <td><strong>${fmtPesos(c.total)}</strong></td>
          <td><span class="badge ${cls}">${c.estado}</span></td>
          <td>${acciones}</td>
        </tr>`;
    }).join('');
    cont.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Comanda</th><th>Mesero</th><th>Cliente</th><th>Platos</th><th>Hora</th><th>Total</th><th>Estado</th><th>Acciones</th></tr></thead>
      <tbody>${filas}</tbody>
    </table></div>`;
  }

  async function entregarComanda(id) {
    try {
      const resp = await Api.entregarComanda(id);
      App.mostrarToast(resp.message, 'success');
      await refrescar();
    } catch (err) {
      App.mostrarToast(err.message, 'error');
    }
  }

  async function cancelarComanda(id) {
    try {
      const resp = await Api.cancelarComanda(id);
      App.mostrarToast(resp.message, 'success');
      await refrescar();
    } catch (err) {
      App.mostrarToast(err.message, 'error');
    }
  }

  /* ---------- Utilidades ---------- */

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

document.addEventListener('DOMContentLoaded', ModuloB.init);
