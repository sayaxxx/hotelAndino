/* ============================================================
   Capa de API — comunicación con el backend Express
   Maneja autenticación por token (Bearer)
   ============================================================ */

const Api = (() => {
  const BASE = '';
  const TOKEN_KEY = 'andino_token';
  let token = localStorage.getItem(TOKEN_KEY) || '';

  function setToken(nuevo) {
    token = nuevo || '';
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  }

  async function request(path, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    let res;
    try {
      res = await fetch(BASE + path, { ...options, headers });
    } catch (err) {
      throw new Error('No se pudo conectar con el servidor.');
    }

    const data = await res.json().catch(() => ({}));

    if (res.status === 401) {
      // Sesión inválida o expirada: volver al login
      setToken('');
      document.dispatchEvent(new Event('andino:noauth'));
      throw new Error(data.error || 'La sesión expiró. Inicie sesión nuevamente.');
    }
    if (!res.ok) {
      const err = new Error(data.error || 'Ocurrió un error en el servidor.');
      err.data = data;
      if (data.faltantes) err.faltantes = data.faltantes;
      throw err;
    }
    return data;
  }

  return {
    /* --- Autenticación --- */
    login(usuario, password) {
      return request('/api/login', {
        method: 'POST',
        body: JSON.stringify({ usuario, password }),
      });
    },
    logout() {
      return request('/api/logout', { method: 'POST' });
    },
    me() {
      return request('/api/me');
    },
    setToken,

    /* --- Módulo A --- */
    buscar(tipo, valor) {
      return request(`/api/search?tipo=${encodeURIComponent(tipo)}&valor=${encodeURIComponent(valor)}`);
    },
    listarConsumos(idReserva) {
      return request(`/api/reservas/${encodeURIComponent(idReserva)}/consumos`);
    },
    registrarConsumo(idReserva, servicio) {
      return request('/api/consumos', {
        method: 'POST',
        body: JSON.stringify({ id_reserva: idReserva, servicio }),
      });
    },

    /* --- Módulo facial --- */
    reclamoFacial(idHuesped, hora) {
      return request('/api/consumo-facial', {
        method: 'POST',
        body: JSON.stringify({ id_huesped: idHuesped, hora: hora || undefined }),
      });
    },

    /* --- Turnero (pantalla de TV en cafetería) --- */
    listarTurnero(fecha) {
      return request(`/api/turnero?fecha=${encodeURIComponent(fecha || '')}`);
    },
    turneroHistorial(fecha) {
      return request(`/api/turnero/historial?fecha=${encodeURIComponent(fecha || '')}`);
    },
    turneroEstado(idHuesped, hora) {
      return request(`/api/turnero/estado?id_huesped=${encodeURIComponent(idHuesped)}&hora=${encodeURIComponent(hora || '')}`);
    },
    turneroListo(id) {
      return request(`/api/turnero/${encodeURIComponent(id)}/lista`, { method: 'POST' });
    },
    turneroRecogido(id) {
      return request(`/api/turnero/${encodeURIComponent(id)}/recogido`, { method: 'POST' });
    },

    /* --- Administración --- */
    crearReserva(datos) {
      return request('/api/reservas', {
        method: 'POST',
        body: JSON.stringify(datos),
      });
    },

    /* --- Administración de reservas y usuarios --- */
    listarReservas(desde, hasta) {
      const q = new URLSearchParams();
      if (desde) q.set('desde', desde);
      if (hasta) q.set('hasta', hasta);
      const str = q.toString();
      return request(`/api/reservas${str ? '?' + str : ''}`);
    },
    eliminarReserva(id) {
      return request(`/api/reservas/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    eliminarHuesped(id) {
      return request(`/api/huespedes/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },

    /* --- Módulo B: comandas e inventario --- */
    listarMeseros() {
      return request('/api/meseros');
    },
    listarMesas() {
      return request('/api/mesas');
    },
    listarPlatos() {
      return request('/api/platos');
    },
    crearPlato(datos) {
      return request('/api/platos', {
        method: 'POST',
        body: JSON.stringify(datos),
      });
    },
    eliminarPlato(id) {
      return request(`/api/platos/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    listarInventario() {
      return request('/api/inventario');
    },
    crearProducto(datos) {
      return request('/api/inventario', {
        method: 'POST',
        body: JSON.stringify(datos),
      });
    },
    eliminarProducto(id) {
      return request(`/api/inventario/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    ajustarStock(id, stock) {
      return request(`/api/inventario/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify({ stock }),
      });
    },
    crearComanda(datos) {
      return request('/api/comandas', {
        method: 'POST',
        body: JSON.stringify(datos),
      });
    },
    listarComandas(fecha) {
      return request(`/api/comandas?fecha=${encodeURIComponent(fecha || '')}`);
    },
    entregarComanda(id) {
      return request(`/api/comandas/${encodeURIComponent(id)}/entregar`, { method: 'POST' });
    },
    cancelarComanda(id) {
      return request(`/api/comandas/${encodeURIComponent(id)}/cancelar`, { method: 'POST' });
    },

    /* --- Módulo C: financiero y reportes --- */
    listarCaja(fecha) {
      return request(`/api/caja?fecha=${encodeURIComponent(fecha || '')}`);
    },
    registrarCaja(datos) {
      return request('/api/caja', {
        method: 'POST',
        body: JSON.stringify(datos),
      });
    },
    reporteOperativo(fecha) {
      return request(`/api/reporte-operativo?fecha=${encodeURIComponent(fecha || '')}`);
    },

    /* --- Dashboard --- */
    listarDashboard() {
      return request('/api/dashboard');
    },
  };
})();
