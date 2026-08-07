/* ============================================================
   Comandas — registro de pedidos y comandas del día
   - Registro de pedidos (responsable + mesa/huésped + platos)
   - Descuento automático de stock
   - Listado y acciones (entregar / cancelar)
   ============================================================ */

const Comandas = (() => {
  const state = {
    platos: [],
    meseros: [],
    mesas: [],
    comandas: [],
    productos: [], // para la receta del nuevo plato
    seleccion: {}, // id_plato -> cantidad
    catActiva: 'Todas',
  };

  function init() {
    // Pestañas
    document.getElementById('comanda-tabs').addEventListener('click', (e) => {
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
      if (btn) cambiarCantidad(btn.dataset.plato, parseInt(btn.dataset.delta, 10));
      const del = e.target.closest('.plato-del');
      if (del) eliminarPlato(del.dataset.id, del.dataset.nombre);
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

    // Gestión de platos (solo admin): modal de nuevo plato y receta
    document.getElementById('btn-nuevo-plato').addEventListener('click', abrirModalPlato);
    document.querySelectorAll('[data-cerrar-modal-plato]').forEach((el) => {
      el.addEventListener('click', () => abrirModalPlato(false));
    });
    document.getElementById('form-plato').addEventListener('submit', crearPlato);
    document.getElementById('btn-agregar-ingrediente').addEventListener('click', () => agregarFilaIngrediente());
    document.getElementById('plato-ingredientes').addEventListener('click', (e) => {
      const btn = e.target.closest('.ing-red');
      if (!btn) return;
      const fila = btn.closest('.ing-row');
      if (fila) fila.remove();
    });
  }

  /* ---------- Carga de datos ---------- */

  async function refrescar() {
    try {
      const [meseros, mesas, platos, comandas] = await Promise.all([
        Api.listarMeseros(),
        Api.listarMesas(),
        Api.listarPlatos(),
        Api.listarComandas(''),
      ]);
      state.meseros = meseros.meseros;
      state.mesas = mesas.mesas;
      state.platos = platos.platos;
      state.comandas = comandas.comandas;

      llenarMeseroSelect();
      llenarMesaSelect();
      renderFiltros();
      renderPlatos();
      renderResumen();
      renderComandas();
    } catch (err) {
      App.mostrarToast(err.message, 'error');
    }
  }

  function activarTab(tab) {
    document.querySelectorAll('#comanda-tabs .tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });
    document.querySelectorAll('#view-comandas .tab-pane').forEach((p) => {
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
            <span class="plato-cat">${esc(p.categoria)}</span>
            <div class="plato-top-right">
              ${badge}
              ${App.esAdmin() ? `<button type="button" class="plato-del" data-id="${esc(p.id)}" data-nombre="${esc(p.nombre)}" title="Eliminar plato" aria-label="Eliminar ${esc(p.nombre)}">&times;</button>` : ''}
            </div>
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

  /* ---------- Gestión de platos (solo admin) ---------- */

  async function abrirModalPlato(abrir = true) {
    const modal = document.getElementById('modal-plato');
    if (!abrir) {
      modal.classList.add('hidden');
      return;
    }
    try {
      const datos = await Api.listarInventario();
      state.productos = datos.inventario;
    } catch (err) {
      App.mostrarToast(err.message, 'error');
      return;
    }
    // Categorías existentes como sugerencia
    const cats = [...new Set(state.platos.map((p) => p.categoria))];
    document.getElementById('dlist-categorias').innerHTML = cats
      .map((c) => `<option value="${esc(c)}">`).join('');
    document.getElementById('form-plato').reset();
    document.getElementById('plato-ingredientes').innerHTML = '';
    agregarFilaIngrediente();
    modal.classList.remove('hidden');
  }

  function plantillaIngrediente() {
    const opciones = '<option value="">Producto...</option>' +
      state.productos.map((p) =>
        `<option value="${esc(p.id)}">${esc(p.nombre)} (${esc(p.unidad || 'u')})</option>`
      ).join('');
    return `
      <div class="ing-row">
        <select class="ing-select" required>${opciones}</select>
        <input type="number" class="ing-cant" min="0" step="0.01" placeholder="Cant." required />
        <button type="button" class="ing-red" title="Quitar ingrediente" aria-label="Quitar ingrediente">&times;</button>
      </div>`;
  }

  function agregarFilaIngrediente() {
    const cont = document.getElementById('plato-ingredientes');
    if (!state.productos.length) {
      App.mostrarToast('Primero agregue productos al inventario.', 'error');
      return;
    }
    cont.insertAdjacentHTML('beforeend', plantillaIngrediente());
  }

  async function crearPlato(e) {
    e.preventDefault();
    const nombre = document.getElementById('plato-nombre').value.trim();
    const categoria = document.getElementById('plato-categoria').value.trim();
    const precio = parseFloat(document.getElementById('plato-precio').value);

    if (!nombre) {
      App.mostrarToast('Indique el nombre del plato.', 'error');
      return;
    }
    if (!categoria) {
      App.mostrarToast('Indique la categoría del plato.', 'error');
      return;
    }
    if (isNaN(precio) || precio < 0) {
      App.mostrarToast('Ingrese un precio válido.', 'error');
      return;
    }

    const ingredientes = [];
    document.querySelectorAll('#plato-ingredientes .ing-row').forEach((fila) => {
      const idProducto = fila.querySelector('.ing-select').value;
      const cantidad = parseFloat(fila.querySelector('.ing-cant').value);
      if (idProducto && !isNaN(cantidad) && cantidad > 0) {
        ingredientes.push({ id_producto: idProducto, cantidad });
      }
    });
    if (!ingredientes.length) {
      App.mostrarToast('Agregue al menos un ingrediente con cantidad.', 'error');
      return;
    }

    const btn = e.target.querySelector('button[type="submit"]');
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    try {
      const resp = await Api.crearPlato({ nombre, categoria, precio, ingredientes });
      App.mostrarToast(resp.message, 'success');
      abrirModalPlato(false);
      e.target.reset();
      await refrescar();
    } catch (err) {
      App.mostrarToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  async function eliminarPlato(id, nombre) {
    if (!confirm(`¿Eliminar el plato "${nombre}"?\n\nSe quitará del menú y de su receta. Esta acción no se puede deshacer.`)) return;
    try {
      const resp = await Api.eliminarPlato(id);
      App.mostrarToast(resp.message, 'success');
      delete state.seleccion[id];
      await refrescar();
    } catch (err) {
      App.mostrarToast(err.message, 'error');
    }
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
      App.mostrarToast('Seleccione el responsable.', 'error');
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

document.addEventListener('DOMContentLoaded', Comandas.init);
