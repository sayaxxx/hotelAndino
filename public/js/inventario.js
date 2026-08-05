/* ============================================================
   Inventario — gestión de productos (solo admin)
   - Tabla con ajuste manual de stock
   - Crear y eliminar productos
   ============================================================ */

const Inventario = (() => {
  const state = {
    inventario: [],
  };

  function init() {
    // Ajuste de stock y eliminación (delegación)
    document.getElementById('tabla-inventario').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-accion]');
      if (!btn) return;
      if (btn.dataset.accion === 'actualizar') {
        const input = document.getElementById('stock-input-' + btn.dataset.id);
        ajustarStock(btn.dataset.id, input.value);
      }
      if (btn.dataset.accion === 'eliminar') eliminarProducto(btn.dataset.id, btn.dataset.nombre);
    });

    // Modal nuevo producto
    document.getElementById('btn-nuevo-producto').addEventListener('click', () => abrirModal(true));
    document.querySelectorAll('[data-cerrar-modal-producto]').forEach((el) => {
      el.addEventListener('click', () => abrirModal(false));
    });
    document.getElementById('form-producto').addEventListener('submit', crearProducto);
  }

  /* ---------- Carga de datos ---------- */

  async function refrescar() {
    try {
      const datos = await Api.listarInventario();
      state.inventario = datos.inventario;
      renderTabla();
    } catch (err) {
      App.mostrarToast(err.message, 'error');
    }
  }

  function renderTabla() {
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
          <td class="acciones">
            <button type="button" class="btn btn-secondary btn-sm" data-accion="actualizar" data-id="${esc(p.id)}">Actualizar</button>
            <button type="button" class="btn btn-danger btn-sm" data-accion="eliminar" data-id="${esc(p.id)}" data-nombre="${esc(p.nombre)}">Eliminar</button>
          </td>
        </tr>`;
    }).join('');
    cont.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Producto</th><th>Unidad</th><th>Stock</th><th>Stock mínimo</th><th>Estado</th><th>Acciones</th></tr></thead>
      <tbody>${filas}</tbody>
    </table></div>`;
  }

  /* ---------- Acciones ---------- */

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

  async function crearProducto(e) {
    e.preventDefault();
    const nombre = document.getElementById('prod-nombre').value.trim();
    const unidad = document.getElementById('prod-unidad').value.trim();
    const stock = parseFloat(document.getElementById('prod-stock').value);
    const stock_minimo = parseFloat(document.getElementById('prod-stock-min').value);

    if (!nombre) {
      App.mostrarToast('Indique el nombre del producto.', 'error');
      return;
    }
    if (isNaN(stock) || stock < 0) {
      App.mostrarToast('Ingrese un stock válido.', 'error');
      return;
    }
    if (isNaN(stock_minimo) || stock_minimo < 0) {
      App.mostrarToast('Ingrese un stock mínimo válido.', 'error');
      return;
    }

    const btn = e.target.querySelector('button[type="submit"]');
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    try {
      const resp = await Api.crearProducto({ nombre, unidad, stock, stock_minimo });
      App.mostrarToast(resp.message, 'success');
      abrirModal(false);
      e.target.reset();
      await refrescar();
    } catch (err) {
      App.mostrarToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  async function eliminarProducto(id, nombre) {
    if (!confirm(
      `¿Eliminar el producto "${nombre}"?\n\nSe quitará del inventario. Esta acción no se puede deshacer.`
    )) return;
    try {
      const resp = await Api.eliminarProducto(id);
      App.mostrarToast(resp.message, 'success');
      await refrescar();
    } catch (err) {
      App.mostrarToast(err.message, 'error');
    }
  }

  function abrirModal(abrir) {
    document.getElementById('modal-producto').classList.toggle('hidden', !abrir);
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

document.addEventListener('DOMContentLoaded', Inventario.init);
