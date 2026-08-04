/* ============================================================
   Capa de API — comunicación con el backend Express
   ============================================================ */

const Api = (() => {
  const BASE = '';

  async function request(path, options = {}) {
    const res = await fetch(BASE + path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Ocurrió un error en el servidor.');
    }
    return data;
  }

  return {
    // Buscar huésped por documento o número de reserva
    buscar(tipo, valor) {
      return request(`/api/search?tipo=${encodeURIComponent(tipo)}&valor=${encodeURIComponent(valor)}`);
    },

    // Consumos del día de una reserva
    listarConsumos(idReserva) {
      return request(`/api/reservas/${encodeURIComponent(idReserva)}/consumos`);
    },

    // Registrar que una comida fue reclamada
    registrarConsumo(idReserva, servicio) {
      return request('/api/consumos', {
        method: 'POST',
        body: JSON.stringify({ id_reserva: idReserva, servicio }),
      });
    },
  };
})();
