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

    /* --- Administración --- */
    crearReserva(datos) {
      return request('/api/reservas', {
        method: 'POST',
        body: JSON.stringify(datos),
      });
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
    listarInventario() {
      return request('/api/inventario');
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
  };
})();
