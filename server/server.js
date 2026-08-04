const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, '..', 'data');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// ------------------------------------------------------------------
// Utilidades CSV (lectura y escritura)
// ------------------------------------------------------------------
function readCsv(fileName) {
  const filePath = path.join(DATA_DIR, fileName);
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line, i) => {
    const values = parseCsvLine(line);
    const obj = {};
    headers.forEach((h, j) => {
      obj[h.trim()] = (values[j] !== undefined ? values[j].trim() : '');
    });
    obj.__line = i + 2; // número de línea real en el archivo (para sobrescribir)
    return obj;
  });
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      out.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function writeCsv(fileName, rows) {
  const filePath = path.join(DATA_DIR, fileName);
  const headers = Object.keys(rows[0]).filter((h) => h !== '__line');
  const lines = [headers.join(',')];
  rows.forEach((r) => {
    lines.push(headers.map((h) => String(r[h] ?? '').replace(/,/g, ';')).join(','));
  });
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

// ------------------------------------------------------------------
// Datos
// ------------------------------------------------------------------
const todayStr = () => new Date().toISOString().slice(0, 10);
const nowTime = () => new Date().toTimeString().slice(0, 5);

const MEALS = ['Desayuno', 'Almuerzo', 'Cena'];

function stripInternal(obj) {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    const copy = { ...obj };
    delete copy.__line;
    return copy;
  }
  return obj;
}

function nextId(rows, field) {
  return rows.length
    ? Math.max(...rows.map((r) => parseInt(r[field] || '0', 10))) + 1
    : 1;
}

// ------------------------------------------------------------------
// Autenticación y sesiones
// ------------------------------------------------------------------
const sessions = new Map(); // token -> { usuario, nombre, rol }

function obtenerToken(req) {
  return (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
}

function requireAuth(req, res, next) {
  const sesion = sessions.get(obtenerToken(req));
  if (!sesion) {
    return res.status(401).json({ error: 'No autorizado. Inicie sesión.' });
  }
  req.usuario = sesion;
  next();
}

function requireAdmin(req, res, next) {
  if (req.usuario.rol !== 'admin') {
    return res.status(403).json({ error: 'Acción reservada para administradores.' });
  }
  next();
}

// ------------------------------------------------------------------
// API: Autenticación
// ------------------------------------------------------------------
app.post('/api/login', (req, res) => {
  const { usuario, password } = req.body || {};
  const u = readCsv('usuarios.csv').find(
    (x) => x.usuario === usuario && x.password === password
  );
  if (!u) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { usuario: u.usuario, nombre: u.nombre, rol: u.rol });
  res.json({ token, nombre: u.nombre, rol: u.rol });
});

app.post('/api/logout', (req, res) => {
  sessions.delete(obtenerToken(req));
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const sesion = sessions.get(obtenerToken(req));
  if (!sesion) return res.json({ autenticado: false });
  res.json({ autenticado: true, ...sesion });
});

// ------------------------------------------------------------------
// API: Búsqueda de huésped por documento o número de reserva
// ------------------------------------------------------------------
app.get('/api/search', requireAuth, (req, res) => {
  const { tipo, valor } = req.query;
  if (!valor) {
    return res.status(400).json({ error: 'Debe indicar un valor de búsqueda.' });
  }

  const huespedes = readCsv('huespedes.csv');
  const reservas = readCsv('reservas.csv');
  const consumos = readCsv('consumos.csv');

  let huesped = null;
  let reserva = null;

  if (tipo === 'documento') {
    huesped = huespedes.find((h) => h.documento === String(valor).trim());
    if (!huesped) {
      return res.json({ found: false, message: 'No se encontró ningún huésped con ese documento.' });
    }
    reserva = reservas
      .filter((r) => r.id_huesped === huesped.id)
      .sort((a, b) => b.id_reserva.localeCompare(a.id_reserva))[0];
  } else if (tipo === 'reserva') {
    reserva = reservas.find((r) => r.id_reserva === String(valor).trim());
    if (!reserva) {
      return res.json({ found: false, message: 'No se encontró ninguna reserva con ese número.' });
    }
    huesped = huespedes.find((h) => h.id === reserva.id_huesped);
  } else {
    return res.status(400).json({ error: 'Tipo de búsqueda inválido.' });
  }

  if (!reserva) {
    return res.json({ found: false, message: 'El huésped no tiene reservas registradas.' });
  }

  const consumosReserva = consumos.filter(
    (c) => c.id_reserva === reserva.id_reserva && c.fecha === todayStr()
  );

  const plan = {
    total: MEALS.filter((m) => reserva['incluye_' + m.toLowerCase()] === '1').length,
    comidas: MEALS.map((m) => ({
      nombre: m,
      incluida: reserva['incluye_' + m.toLowerCase()] === '1',
      reclamada: consumosReserva.some((c) => c.servicio === m),
      horaReclamo: (consumosReserva.find((c) => c.servicio === m) || {}).hora || null,
    })),
  };

  res.json({
    found: true,
    huesped: stripInternal(huesped),
    reserva: { ...stripInternal(reserva), plan },
    consumos: consumosReserva.map(stripInternal),
  });
});

// ------------------------------------------------------------------
// API: Listar consumos del día de una reserva
// ------------------------------------------------------------------
app.get('/api/reservas/:id/consumos', requireAuth, (req, res) => {
  const consumos = readCsv('consumos.csv');
  const delDia = consumos.filter(
    (c) => c.id_reserva === req.params.id && c.fecha === todayStr()
  );
  res.json({ consumos: delDia });
});

// ------------------------------------------------------------------
// API: Registrar un consumo (marcar comida reclamada)
// ------------------------------------------------------------------
app.post('/api/consumos', requireAuth, (req, res) => {
  const { id_reserva, servicio } = req.body;

  if (!id_reserva || !MEALS.includes(servicio)) {
    return res.status(400).json({ error: 'Datos inválidos para registrar el consumo.' });
  }

  const reservas = readCsv('reservas.csv');
  const reserva = reservas.find((r) => r.id_reserva === String(id_reserva));
  if (!reserva) {
    return res.status(404).json({ error: 'La reserva no existe.' });
  }

  const incluida = reserva['incluye_' + servicio.toLowerCase()] === '1';
  if (!incluida) {
    return res.status(400).json({ error: `El huésped NO tiene ${servicio.toLowerCase()} incluido en su plan.` });
  }

  const consumos = readCsv('consumos.csv');
  const yaReclamada = consumos.some(
    (c) => c.id_reserva === String(id_reserva) && c.servicio === servicio && c.fecha === todayStr()
  );
  if (yaReclamada) {
    return res.status(400).json({ error: `${servicio} ya fue reclamado hoy. No se permiten duplicados.` });
  }

  consumos.push({
    id: String(nextId(consumos, 'id')),
    id_reserva: String(id_reserva),
    servicio,
    fecha: todayStr(),
    hora: nowTime(),
  });
  writeCsv('consumos.csv', consumos);

  res.status(201).json({
    message: `${servicio} registrado correctamente.`,
    consumo: consumos[consumos.length - 1],
    consumos: consumos.filter(
      (c) => c.id_reserva === String(id_reserva) && c.fecha === todayStr()
    ),
  });
});

// ------------------------------------------------------------------
// API: Crear nueva reserva (solo administradores)
// ------------------------------------------------------------------
app.post('/api/reservas', requireAuth, requireAdmin, (req, res) => {
  const {
    nombre, documento, tipo_documento, telefono, email,
    habitacion, fecha_checkin, fecha_checkout, comidas,
  } = req.body || {};

  if (!nombre || !documento || !habitacion || !fecha_checkin || !fecha_checkout) {
    return res.status(400).json({ error: 'Complete los campos obligatorios (nombre, documento, habitación y fechas).' });
  }
  if (!Array.isArray(comidas) || comidas.length === 0) {
    return res.status(400).json({ error: 'Seleccione al menos una comida del plan.' });
  }
  if (fecha_checkin > fecha_checkout) {
    return res.status(400).json({ error: 'El check-in no puede ser posterior al check-out.' });
  }

  // Buscar huésped existente por documento; si no existe, crearlo
  let huespedes = readCsv('huespedes.csv');
  let esNuevoHuesped = false;
  let huesped = huespedes.find((h) => h.documento === String(documento).trim());
  if (!huesped) {
    esNuevoHuesped = true;
    huesped = {
      id: String(nextId(huespedes, 'id')),
      nombre: String(nombre).trim(),
      documento: String(documento).trim(),
      tipo_documento: (tipo_documento || 'CC').trim(),
      telefono: String(telefono || '').trim(),
      email: String(email || '').trim(),
    };
    huespedes.push(huesped);
    writeCsv('huespedes.csv', huespedes);
  }

  const reservas = readCsv('reservas.csv');
  const id_reserva = String(nextId(reservas, 'id_reserva'));
  const nueva = {
    id_reserva,
    id_huesped: huesped.id,
    habitacion: String(habitacion).trim(),
    fecha_checkin,
    fecha_checkout,
    estado: 'Activa',
    incluye_desayuno: comidas.includes('Desayuno') ? '1' : '0',
    incluye_almuerzo: comidas.includes('Almuerzo') ? '1' : '0',
    incluye_cena: comidas.includes('Cena') ? '1' : '0',
  };
  reservas.push(nueva);
  writeCsv('reservas.csv', reservas);

  res.status(201).json({
    message: `Reserva ${id_reserva} creada para ${huesped.nombre}.`,
    reserva: stripInternal(nueva),
    esNuevoHuesped: esNuevoHuesped,
  });
});

// ------------------------------------------------------------------
// MÓDULO B — Comandas e Inventario
// ------------------------------------------------------------------

function redondear(n) {
  return Math.round(n * 100) / 100;
}

// Datos base del módulo (meseros y mesas)
app.get('/api/meseros', requireAuth, (req, res) => {
  const meseros = readCsv('usuarios.csv')
    .filter((u) => u.rol === 'mesero')
    .map((u) => ({ id: u.id, nombre: u.nombre }));
  res.json({ meseros });
});

app.get('/api/mesas', requireAuth, (req, res) => {
  res.json({ mesas: readCsv('mesas.csv').map(stripInternal) });
});

// Menú con disponibilidad de porciones según el stock actual
app.get('/api/platos', requireAuth, (req, res) => {
  const platos = readCsv('platos.csv');
  const recetas = readCsv('plato_ingredientes.csv');
  const productos = readCsv('productos.csv');

  const lista = platos.map((p) => {
    const ingredientes = recetas.filter((r) => r.id_plato === p.id).map((r) => {
      const prod = productos.find((x) => x.id === r.id_producto);
      return {
        id_producto: r.id_producto,
        nombre: prod ? prod.nombre : '?',
        cantidad: parseFloat(r.cantidad),
        stock: prod ? parseFloat(prod.stock) : 0,
        stock_minimo: prod ? parseFloat(prod.stock_minimo) : 0,
      };
    });

    // Porciones que se pueden preparar con el stock actual
    let porciones = Infinity;
    for (const ing of ingredientes) {
      if (ing.cantidad > 0) porciones = Math.min(porciones, Math.floor(ing.stock / ing.cantidad));
    }
    if (!Number.isFinite(porciones)) porciones = 999;

    return {
      ...stripInternal(p),
      precio: parseFloat(p.precio),
      ingredientes,
      porcionesDisponibles: porciones,
      stockBajo: porciones > 0 && porciones <= 5,
    };
  });

  res.json({ platos: lista });
});

// Inventario
app.get('/api/inventario', requireAuth, (req, res) => {
  const inventario = readCsv('productos.csv').map((p) => {
    const stock = parseFloat(p.stock);
    const stockMinimo = parseFloat(p.stock_minimo);
    return {
      ...stripInternal(p),
      stock,
      stock_minimo: stockMinimo,
      estado: stock <= 0 ? 'Agotado' : stock <= stockMinimo ? 'Bajo' : 'Disponible',
    };
  });
  res.json({ inventario });
});

app.put('/api/inventario/:id', requireAuth, requireAdmin, (req, res) => {
  const stock = parseFloat((req.body || {}).stock);
  if (isNaN(stock) || stock < 0) {
    return res.status(400).json({ error: 'Stock inválido.' });
  }
  const productos = readCsv('productos.csv');
  const prod = productos.find((p) => p.id === req.params.id);
  if (!prod) {
    return res.status(404).json({ error: 'Producto no encontrado.' });
  }
  prod.stock = String(stock);
  writeCsv('productos.csv', productos);
  res.json({ message: `Stock de ${prod.nombre} actualizado a ${redondear(stock)}.`, producto: stripInternal(prod) });
});

// Registrar comanda con descuento automático de stock
app.post('/api/comandas', requireAuth, requireAdmin, (req, res) => {
  const { id_mesero, tipo_servicio, id_mesa, id_reserva, platos } = req.body || {};

  if (!id_mesero) return res.status(400).json({ error: 'Seleccione el mesero responsable.' });
  const mesero = readCsv('usuarios.csv').find((m) => m.id === String(id_mesero) && m.rol === 'mesero');
  if (!mesero) return res.status(400).json({ error: 'El mesero seleccionado no es válido.' });

  if (!['mesa', 'huesped'].includes(tipo_servicio)) {
    return res.status(400).json({ error: 'Tipo de servicio inválido.' });
  }
  if (tipo_servicio === 'mesa') {
    if (!id_mesa) return res.status(400).json({ error: 'Seleccione la mesa.' });
    if (!readCsv('mesas.csv').some((m) => m.id === String(id_mesa))) {
      return res.status(400).json({ error: 'La mesa seleccionada no es válida.' });
    }
  } else {
    if (!id_reserva) return res.status(400).json({ error: 'Indique el número de reserva del huésped.' });
    const rsv = readCsv('reservas.csv').find((r) => r.id_reserva === String(id_reserva));
    if (!rsv) return res.status(400).json({ error: 'La reserva no existe.' });
    if (rsv.estado !== 'Activa') return res.status(400).json({ error: 'La reserva no está activa.' });
  }

  if (!Array.isArray(platos) || platos.length === 0) {
    return res.status(400).json({ error: 'Agregue al menos un plato a la comanda.' });
  }

  const platosCsv = readCsv('platos.csv');
  const recetas = readCsv('plato_ingredientes.csv');
  const productos = readCsv('productos.csv');

  const detalle = [];
  let total = 0;
  const requeridos = new Map(); // id_producto -> cantidad total

  for (const item of platos) {
    const cant = parseInt(item.cantidad, 10);
    if (!cant || cant <= 0) continue;
    const plato = platosCsv.find((p) => p.id === String(item.id_plato));
    if (!plato) return res.status(400).json({ error: 'Un plato de la comanda no existe.' });

    const subtotal = parseFloat(plato.precio) * cant;
    total += subtotal;
    detalle.push({ id_plato: plato.id, nombre: plato.nombre, cantidad: cant, subtotal: redondear(subtotal) });

    for (const r of recetas.filter((r) => r.id_plato === plato.id)) {
      const req = parseFloat(r.cantidad) * cant;
      requeridos.set(r.id_producto, redondear((requeridos.get(r.id_producto) || 0) + req));
    }
  }

  if (detalle.length === 0) {
    return res.status(400).json({ error: 'Indique cantidades válidas de platos.' });
  }

  // Validar stock suficiente para todos los ingredientes
  const faltantes = [];
  for (const [idProd, cantidadReq] of requeridos) {
    const prod = productos.find((p) => p.id === idProd);
    const stock = prod ? parseFloat(prod.stock) : 0;
    if (stock < cantidadReq) {
      faltantes.push(
        `${prod ? prod.nombre : 'Producto ' + idProd}: requiere ${redondear(cantidadReq)} ${prod ? prod.unidad : ''}, disponible ${redondear(stock)}`
      );
    }
  }
  if (faltantes.length) {
    return res.status(400).json({ error: 'Stock insuficiente para registrar la comanda.', faltantes });
  }

  // Descontar stock
  for (const [idProd, cantidadReq] of requeridos) {
    const prod = productos.find((p) => p.id === idProd);
    prod.stock = String(redondear(parseFloat(prod.stock) - cantidadReq));
  }
  writeCsv('productos.csv', productos);

  // Crear comanda
  const comandas = readCsv('comandas.csv');
  const id_comanda = String(nextId(comandas, 'id_comanda'));
  const nueva = {
    id_comanda,
    id_mesero: String(id_mesero),
    tipo_servicio,
    id_mesa: tipo_servicio === 'mesa' ? String(id_mesa) : '',
    id_reserva: tipo_servicio === 'huesped' ? String(id_reserva) : '',
    fecha: todayStr(),
    hora: nowTime(),
    estado: 'Registrada',
    total: String(redondear(total)),
  };
  comandas.push(nueva);
  writeCsv('comandas.csv', comandas);

  const items = readCsv('comanda_platos.csv');
  detalle.forEach((d) => {
    items.push({
      id: String(nextId(items, 'id')),
      id_comanda,
      id_plato: d.id_plato,
      cantidad: String(d.cantidad),
      subtotal: String(d.subtotal),
      estado: 'Registrada',
    });
  });
  writeCsv('comanda_platos.csv', items);

  res.status(201).json({
    message: `Comanda ${id_comanda} registrada correctamente.`,
    comanda: stripInternal(nueva),
    detalle,
  });
});

// Listar comandas de un día
app.get('/api/comandas', requireAuth, (req, res) => {
  const fecha = req.query.fecha || todayStr();
  const comandas = readCsv('comandas.csv').filter((c) => c.fecha === fecha);
  const meseros = readCsv('usuarios.csv');
  const mesas = readCsv('mesas.csv');
  const reservas = readCsv('reservas.csv');
  const huespedes = readCsv('huespedes.csv');
  const items = readCsv('comanda_platos.csv');
  const platos = readCsv('platos.csv');

  const lista = comandas
    .sort((a, b) => a.id_comanda.localeCompare(b.id_comanda))
    .map((c) => {
      const mesero = meseros.find((m) => m.id === c.id_mesero);
      let cliente = '';
      if (c.tipo_servicio === 'mesa') {
        const mesa = mesas.find((m) => m.id === c.id_mesa);
        cliente = mesa ? mesa.nombre : 'Mesa ' + c.id_mesa;
      } else {
        const rsv = reservas.find((r) => r.id_reserva === c.id_reserva);
        const hp = rsv ? huespedes.find((h) => h.id === rsv.id_huesped) : null;
        cliente = hp ? `${hp.nombre} (Res. ${c.id_reserva})` : 'Res. ' + c.id_reserva;
      }
      const comandaItems = items.filter((i) => i.id_comanda === c.id_comanda).map((i) => {
        const p = platos.find((x) => x.id === i.id_plato);
        return { ...stripInternal(i), nombre: p ? p.nombre : '?', precio: p ? parseFloat(p.precio) : 0 };
      });
      return {
        ...stripInternal(c),
        total: parseFloat(c.total),
        mesero: mesero ? mesero.nombre : c.id_mesero,
        cliente,
        items: comandaItems,
      };
    });

  res.json({ fecha, comandas: lista });
});

// Marcar comanda como entregada
app.post('/api/comandas/:id/entregar', requireAuth, requireAdmin, (req, res) => {
  const comandas = readCsv('comandas.csv');
  const c = comandas.find((x) => x.id_comanda === req.params.id);
  if (!c) return res.status(404).json({ error: 'Comanda no encontrada.' });
  if (c.estado !== 'Registrada') {
    return res.status(400).json({ error: 'Solo se puede entregar una comanda en estado Registrada.' });
  }
  c.estado = 'Entregada';
  writeCsv('comandas.csv', comandas);
  res.json({ message: `Comanda ${c.id_comanda} marcada como entregada.` });
});

// Cancelar comanda y restaurar stock
app.post('/api/comandas/:id/cancelar', requireAuth, requireAdmin, (req, res) => {
  const comandas = readCsv('comandas.csv');
  const c = comandas.find((x) => x.id_comanda === req.params.id);
  if (!c) return res.status(404).json({ error: 'Comanda no encontrada.' });
  if (c.estado !== 'Registrada') {
    return res.status(400).json({ error: 'Solo se puede cancelar una comanda en estado Registrada.' });
  }

  const items = readCsv('comanda_platos.csv').filter((i) => i.id_comanda === c.id_comanda);
  const recetas = readCsv('plato_ingredientes.csv');
  const productos = readCsv('productos.csv');

  for (const item of items) {
    const cant = parseInt(item.cantidad, 10) || 0;
    for (const r of recetas.filter((r) => r.id_plato === item.id_plato)) {
      const prod = productos.find((p) => p.id === r.id_producto);
      if (prod) {
        prod.stock = String(redondear(parseFloat(prod.stock) + parseFloat(r.cantidad) * cant));
      }
    }
  }
  writeCsv('productos.csv', productos);

  c.estado = 'Cancelada';
  writeCsv('comandas.csv', comandas);
  res.json({ message: `Comanda ${c.id_comanda} cancelada. Stock restaurado al inventario.` });
});

// ------------------------------------------------------------------
// Ruta principal
// ------------------------------------------------------------------
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[Hotel Andino] Servidor listo en http://localhost:${PORT}`);
});
