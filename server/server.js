const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, '..', 'data');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const ROSTROS_DIR = path.join(DATA_DIR, 'rostros');

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
  let headers;
  if (rows.length === 0) {
    // Conservar la cabecera del archivo si quedó vacío
    const raw = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
    const firstLine = raw.split(/\r?\n/)[0] || '';
    headers = firstLine ? parseCsvLine(firstLine).map((h) => h.trim()) : [];
    fs.writeFileSync(filePath, headers.length ? headers.join(',') + '\n' : '', 'utf8');
    return;
  }
  headers = Object.keys(rows[0]).filter((h) => h !== '__line');
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

// Ventanas de servicio para el reconocimiento facial en cafetería
// (el kiosco marca la comida según la hora del sistema)
const VENTANAS_COMIDA = [
  { servicio: 'Desayuno', inicio: '05:00', fin: '08:30', etiqueta: 'Desayuno (05:00 - 08:30)' },
  { servicio: 'Almuerzo', inicio: '12:00', fin: '15:00', etiqueta: 'Almuerzo (12:00 - 15:00)' },
  // Cena temporalmente hasta las 23:59 para pruebas; luego se ajusta su horario definitivo.
  { servicio: 'Cena', inicio: '17:30', fin: '23:59', etiqueta: 'Cena (17:30 - 23:59)' },
];

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

  const v = String(valor || '').trim();

  const responderMatch = (rsv, hp) => {
    const consumosReserva = consumos.filter(
      (c) => c.id_reserva === rsv.id_reserva && c.fecha === todayStr()
    );
    const plan = {
      total: MEALS.filter((m) => rsv['incluye_' + m.toLowerCase()] === '1').length,
      comidas: MEALS.map((m) => ({
        nombre: m,
        incluida: rsv['incluye_' + m.toLowerCase()] === '1',
        reclamada: consumosReserva.some((c) => c.servicio === m),
        horaReclamo: (consumosReserva.find((c) => c.servicio === m) || {}).hora || null,
      })),
    };
    return res.json({
      found: true,
      huesped: stripInternal(hp),
      reserva: { ...stripInternal(rsv), plan },
      consumos: consumosReserva.map(stripInternal),
    });
  };

  // Búsqueda automática mientras se escribe: documento, reserva o parcial
  if (tipo === 'auto') {
    if (!v) {
      return res.json({ found: false, message: 'Escriba un documento, número de reserva o nombre.', sugerencias: [] });
    }

    const porReserva = reservas.find((r) => r.id_reserva === v);
    if (porReserva) {
      const hp = huespedes.find((h) => h.id === porReserva.id_huesped);
      if (hp) return responderMatch(porReserva, hp);
    }

    const porDoc = huespedes.find((h) => h.documento === v);
    if (porDoc) {
      const rsv = reservas
        .filter((r) => r.id_huesped === porDoc.id)
        .sort((a, b) => b.id_reserva.localeCompare(a.id_reserva))[0];
      if (rsv) return responderMatch(rsv, porDoc);
    }

    // Coincidencias parciales para mostrar sugerencias mientras se escribe
    const sugerencias = [];
    const vistos = new Set();
    const agregar = (rsv, hp) => {
      if (vistos.has(rsv.id_reserva)) return;
      vistos.add(rsv.id_reserva);
      sugerencias.push({
        id_reserva: rsv.id_reserva,
        huesped: hp ? hp.nombre : '',
        habitacion: rsv.habitacion,
        documento: hp ? hp.documento : '',
      });
    };
    for (const r of reservas) {
      if (String(r.id_reserva).startsWith(v)) {
        agregar(r, huespedes.find((h) => h.id === r.id_huesped));
      }
    }
    for (const h of huespedes) {
      if (
        String(h.documento).startsWith(v) ||
        String(h.nombre || '').toLowerCase().includes(v.toLowerCase())
      ) {
        const r = reservas
          .filter((x) => x.id_huesped === h.id)
          .sort((a, b) => b.id_reserva.localeCompare(a.id_reserva))[0];
        if (r) agregar(r, h);
      }
    }
    sugerencias.sort((a, b) => a.id_reserva.localeCompare(b.id_reserva)).slice(0, 8);
    return res.json({
      found: false,
      message: sugerencias.length ? '' : `Sin coincidencias con "${v}".`,
      sugerencias,
    });
  }

  if (tipo === 'documento') {
    huesped = huespedes.find((h) => h.documento === v);
    if (!huesped) {
      return res.json({ found: false, message: 'No se encontró ningún huésped con ese documento.' });
    }
    reserva = reservas
      .filter((r) => r.id_huesped === huesped.id)
      .sort((a, b) => b.id_reserva.localeCompare(a.id_reserva))[0];
  } else if (tipo === 'reserva') {
    reserva = reservas.find((r) => r.id_reserva === v);
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
  if (!huesped) {
    return res.json({ found: false, message: 'No se encontró el huésped de la reserva.' });
  }

  responderMatch(reserva, huesped);
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
    habitacion, fecha_checkin, fecha_checkout, comidas, rostro_base64,
  } = req.body || {};

  const nombreVal = String(nombre || '').trim();
  const documentoVal = String(documento || '').trim();
  const habitacionVal = String(habitacion || '').trim();
  const telefonoVal = String(telefono || '').trim();
  const emailVal = String(email || '').trim();

  if (!nombreVal || !documentoVal || !habitacionVal || !fecha_checkin || !fecha_checkout) {
    return res.status(400).json({ error: 'Complete los campos obligatorios (nombre, documento, habitación y fechas).' });
  }
  if (!Array.isArray(comidas) || comidas.length === 0) {
    return res.status(400).json({ error: 'Seleccione al menos una comida del plan.' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha_checkin)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(fecha_checkout))) {
    return res.status(400).json({ error: 'Las fechas deben tener el formato AAAA-MM-DD.' });
  }
  if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?: [A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)*$/.test(nombreVal)) {
    return res.status(400).json({ error: 'El nombre solo puede contener letras y espacios (sin números ni caracteres especiales).' });
  }
  if (!/^\d+$/.test(documentoVal)) {
    return res.status(400).json({ error: 'El documento solo puede contener números.' });
  }
  if (documentoVal.length < 4 || documentoVal.length > 15) {
    return res.status(400).json({ error: 'El documento debe tener entre 4 y 15 dígitos.' });
  }
  if (!/^[A-Za-z0-9-]+$/.test(habitacionVal)) {
    return res.status(400).json({ error: 'La habitación solo puede contener letras y números.' });
  }
  if (fecha_checkin < todayStr()) {
    return res.status(400).json({ error: `El check-in no puede ser anterior a la fecha actual (${todayStr()}).` });
  }
  if (fecha_checkin >= fecha_checkout) {
    return res.status(400).json({ error: 'El check-out debe ser posterior al check-in.' });
  }
  if (telefonoVal && !/^[\d\s()+.-]{7,}$/.test(telefonoVal)) {
    return res.status(400).json({ error: 'El teléfono solo puede contener números y el prefijo +.' });
  }
  if (emailVal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
    return res.status(400).json({ error: 'El correo electrónico no es válido.' });
  }

  // Buscar huésped existente por documento; si no existe, crearlo
  let huespedes = readCsv('huespedes.csv');
  let esNuevoHuesped = false;
  let huesped = huespedes.find((h) => h.documento === documentoVal);
  if (!huesped) {
    esNuevoHuesped = true;
    huesped = {
      id: String(nextId(huespedes, 'id')),
      nombre: nombreVal,
      documento: documentoVal,
      tipo_documento: (tipo_documento || 'CC').trim(),
      telefono: telefonoVal,
      email: emailVal,
    };
    huespedes.push(huesped);
    writeCsv('huespedes.csv', huespedes);
  }

  // Disponibilidad de habitación: no se puede reservar una habitación que ya
  // esté ocupada o reservada en un rango de fechas que se solape.
  const reservas = readCsv('reservas.csv');
  const solapada = reservas.find(
    (r) =>
      r.habitacion === habitacionVal &&
      r.estado === 'Activa' &&
      String(fecha_checkin) < r.fecha_checkout &&
      r.fecha_checkin < String(fecha_checkout)
  );
  if (solapada) {
    return res.status(409).json({
      error: `La habitación ${habitacionVal} ya está ocupada o reservada (Res. ${solapada.id_reserva}) en esas fechas.`,
    });
  }

  const id_reserva = String(nextId(reservas, 'id_reserva'));
  const nueva = {
    id_reserva,
    id_huesped: huesped.id,
    habitacion: habitacionVal,
    fecha_checkin,
    fecha_checkout,
    estado: 'Activa',
    incluye_desayuno: comidas.includes('Desayuno') ? '1' : '0',
    incluye_almuerzo: comidas.includes('Almuerzo') ? '1' : '0',
    incluye_cena: comidas.includes('Cena') ? '1' : '0',
  };
  reservas.push(nueva);
  writeCsv('reservas.csv', reservas);

  // Si se envió un rostro (base64), guardarlo para el reconocimiento en cafetería
  if (rostro_base64 && typeof rostro_base64 === 'string') {
    guardarRostro(huesped.id, rostro_base64);
  }

  res.status(201).json({
    message: `Reserva ${id_reserva} creada para ${huesped.nombre}.`,
    reserva: stripInternal(nueva),
    esNuevoHuesped: esNuevoHuesped,
  });
});

// ------------------------------------------------------------------
// API: Administración de reservas y huéspedes (solo administradores)
// ------------------------------------------------------------------

// Listar reservas con su huésped. Filtro opcional por rango de fechas
// (devuelve las estadías que coinciden con el rango indicado).
app.get('/api/reservas', requireAuth, requireAdmin, (req, res) => {
  const { desde, hasta } = req.query;
  const reservas = readCsv('reservas.csv');
  const huespedes = readCsv('huespedes.csv');
  const consumos = readCsv('consumos.csv');

  let lista = reservas.map((r) => {
    const hp = huespedes.find((h) => h.id === r.id_huesped) || {};
    return {
      id_reserva: r.id_reserva,
      id_huesped: r.id_huesped,
      huesped: hp.nombre || '(sin huésped)',
      documento: hp.documento || '',
      tipo_documento: hp.tipo_documento || '',
      telefono: hp.telefono || '',
      email: hp.email || '',
      habitacion: r.habitacion,
      fecha_checkin: r.fecha_checkin,
      fecha_checkout: r.fecha_checkout,
      estado: r.estado,
      incluye_desayuno: r['incluye_desayuno'] === '1',
      incluye_almuerzo: r['incluye_almuerzo'] === '1',
      incluye_cena: r['incluye_cena'] === '1',
      consumos: consumos.filter((c) => c.id_reserva === r.id_reserva).length,
    };
  });

  if (desde || hasta) {
    const inicio = desde || '0000-01-01';
    const fin = hasta || '9999-12-31';
    lista = lista.filter(
      (r) => r.fecha_checkin <= fin && r.fecha_checkout >= inicio
    );
  }

  lista.sort((a, b) => a.id_reserva.localeCompare(b.id_reserva));

  res.json({
    total: lista.length,
    total_huespedes: huespedes.length,
    desde: desde || null,
    hasta: hasta || null,
    reservas: lista,
  });
});

// Eliminar una reserva y sus consumos / registros del turnero asociados
app.delete('/api/reservas/:id', requireAuth, requireAdmin, (req, res) => {
  const reservas = readCsv('reservas.csv');
  const idx = reservas.findIndex((r) => r.id_reserva === String(req.params.id));
  if (idx === -1) {
    return res.status(404).json({ error: 'La reserva no existe.' });
  }
  const reserva = reservas[idx];
  reservas.splice(idx, 1);
  writeCsv('reservas.csv', reservas);

  const consumos = readCsv('consumos.csv').filter((c) => c.id_reserva !== reserva.id_reserva);
  writeCsv('consumos.csv', consumos);

  const turnero = readCsv('turnero.csv').filter((t) => t.id_reserva !== reserva.id_reserva);
  writeCsv('turnero.csv', turnero);

  // Si el huésped queda sin reservas, eliminar también sus datos del escaneo
  // facial (foto y artefactos locales del kiosco) para que deje de reconocerse.
  const quedanReservas = readCsv('reservas.csv').some(
    (r) => r.id_huesped === reserva.id_huesped
  );
  const facialEliminado = quedanReservas ? [] : limpiarDatosFacialesLocal(reserva.id_huesped);

  res.json({
    ok: true,
    message: `Reserva ${reserva.id_reserva} eliminada correctamente.`,
    datos_escaneo_eliminados: facialEliminado,
  });
});

// Eliminar un huésped (usuario) con todo lo asociado:
// reservas, consumos, registros del turnero y foto de reconocimiento facial
app.delete('/api/huespedes/:id', requireAuth, requireAdmin, (req, res) => {
  const huespedes = readCsv('huespedes.csv');
  const idx = huespedes.findIndex((h) => h.id === String(req.params.id));
  if (idx === -1) {
    return res.status(404).json({ error: 'El huésped no existe.' });
  }
  const hp = huespedes[idx];
  huespedes.splice(idx, 1);
  writeCsv('huespedes.csv', huespedes);

  const reservas = readCsv('reservas.csv');
  const idReservas = reservas
    .filter((r) => r.id_huesped === hp.id)
    .map((r) => r.id_reserva);
  writeCsv('reservas.csv', reservas.filter((r) => r.id_huesped !== hp.id));

  if (idReservas.length > 0) {
    const consumos = readCsv('consumos.csv').filter((c) => !idReservas.includes(c.id_reserva));
    writeCsv('consumos.csv', consumos);
    const turnero = readCsv('turnero.csv').filter((t) => !idReservas.includes(t.id_reserva));
    writeCsv('turnero.csv', turnero);
  }

  // Limpiar los datos del escaneo facial (foto del servidor, descargas
  // locales y modelo del kiosco) para que deje de reconocerse.
  const facialEliminado = limpiarDatosFacialesLocal(hp.id);

  res.json({
    ok: true,
    message: `Huésped ${hp.nombre} eliminado correctamente${idReservas.length ? ` junto con sus ${idReservas.length} reserva(s)` : ''}.`,
    datos_escaneo_eliminados: facialEliminado,
  });
});

// ------------------------------------------------------------------
// MÓDULO FACIAL — Registro y reconocimiento de rostros (OpenCV)
// ------------------------------------------------------------------

// Guarda la imagen (base64) del huésped en data/rostros/{id}.jpg
function guardarRostro(idHuesped, base64Imagen) {
  const dataUrl = String(base64Imagen);
  const b64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  const buffer = Buffer.from(b64, 'base64');
  if (buffer.length < 100) {
    throw new Error('La imagen del rostro no es válida (archivo demasiado pequeño).');
  }
  fs.mkdirSync(ROSTROS_DIR, { recursive: true });
  const ruta = path.join(ROSTROS_DIR, String(idHuesped) + '.jpg');
  fs.writeFileSync(ruta, buffer);
  return ruta;
}

// Archivos de rostro guardados en data/rostros
function listarArchivosRostros() {
  if (!fs.existsSync(ROSTROS_DIR)) return [];
  return fs
    .readdirSync(ROSTROS_DIR)
    .filter((f) => /\.(jpg|jpeg|png)$/i.test(f))
    .sort((a, b) => a.localeCompare(b));
}

// Firma del conjunto actual de rostros (para que el kiosco detecte altas/bajas)
function calcularFirmaRostros() {
  const hash = crypto.createHash('sha256');
  const archivos = listarArchivosRostros();
  for (const f of archivos) {
    hash.update(f);
    hash.update(fs.readFileSync(path.join(ROSTROS_DIR, f)));
  }
  return hash.digest('hex');
}

// Limpia los datos del escaneo facial de un huésped: foto del servidor y
// los artefactos locales del kiosco (descargas y modelo entrenado), si el
// kiosco corre en esta misma máquina. Así el reconocimiento deja de verlo.
function limpiarDatosFacialesLocal(idHuesped) {
  const id = String(idHuesped);
  const borrados = [];

  for (const f of listarArchivosRostros()) {
    if (f.replace(/\.[^.]+$/, '') === id) {
      const ruta = path.join(ROSTROS_DIR, f);
      if (fs.existsSync(ruta)) {
        fs.unlinkSync(ruta);
        borrados.push(f);
      }
    }
  }

  const pythonDir = path.join(__dirname, '..', 'python');
  const localRostrosDir = path.join(pythonDir, 'rostros_local');
  if (fs.existsSync(localRostrosDir)) {
    const archivos = fs.readdirSync(localRostrosDir);
    for (const f of archivos) {
      if (f.startsWith(id + '__') || f.replace(/\.[^.]+$/, '') === id) {
        const ruta = path.join(localRostrosDir, f);
        if (fs.existsSync(ruta)) {
          fs.unlinkSync(ruta);
          borrados.push('rostros_local/' + f);
        }
      }
    }
  }

  // Forzar que el modelo se re-entrene desde cero en el próximo ciclo
  const modeloDir = path.join(pythonDir, 'modelo');
  for (const f of ['modelo_lbph.yml', 'labels.json']) {
    const ruta = path.join(modeloDir, f);
    if (fs.existsSync(ruta)) {
      fs.unlinkSync(ruta);
      borrados.push('modelo/' + f);
    }
  }

  return borrados;
}

// Lista los rostros registrados (para que el kiosco OpenCV los descargue y entrene)
app.get('/api/rostros', requireAuth, (req, res) => {
  const huespedes = readCsv('huespedes.csv');
  const archivos = listarArchivosRostros();

  const rostros = archivos.map((f) => {
    const idHuesped = f.replace(/\.[^.]+$/, '');
    const hp = huespedes.find((h) => h.id === idHuesped);
    const buffer = fs.readFileSync(path.join(ROSTROS_DIR, f));
    return {
      id_huesped: idHuesped,
      nombre: hp ? hp.nombre : '',
      archivo: f,
      imagen: buffer.toString('base64'),
    };
  });
  res.json({ rostros, firma: calcularFirmaRostros() });
});

// Firma ligera del conjunto de rostros (el kiosco la consulta cada pocos
// segundos para saber si debe re-sincronizar/re-entrenar su modelo).
app.get('/api/rostros/firma', requireAuth, (req, res) => {
  res.json({ firma: calcularFirmaRostros() });
});

// Reclamo de comida por reconocimiento facial.
// El kiosco envía el id_huesped identificado; el servidor decide la ventana
// según la hora (body.hora, si viene, o la hora del servidor), valida el plan,
// evita duplicados y registra el consumo.
app.post('/api/consumo-facial', requireAuth, (req, res) => {
  const { id_huesped, hora } = req.body || {};

  if (!id_huesped) {
    return res.status(400).json({ error: 'Debe indicar el id_huesped identificado.' });
  }

  const huespedes = readCsv('huespedes.csv');
  const hp = huespedes.find((h) => h.id === String(id_huesped));
  if (!hp) {
    return res.status(404).json({ ok: false, estado: 'no_encontrado', message: 'El huésped no está registrado en el sistema.' });
  }

  const reservas = readCsv('reservas.csv');
  const activas = reservas
    .filter((r) => r.id_huesped === hp.id && r.estado === 'Activa')
    .sort((a, b) => b.fecha_checkin.localeCompare(a.fecha_checkin));
  if (activas.length === 0) {
    return res.json({ ok: false, estado: 'sin_reserva_activa', message: `${hp.nombre} no tiene una reserva activa.`, huesped: hp.nombre });
  }
  const reserva = activas[0];

  // Ventana de servicio según la hora del sistema (o la reportada por el kiosco)
  const hhmm = /^\d{2}:\d{2}$/.test(String(hora || '')) ? String(hora) : nowTime();
  const ventana = VENTANAS_COMIDA.find((v) => hhmm >= v.inicio && hhmm <= v.fin);
  if (!ventana) {
    return res.json({
      ok: false,
      estado: 'fuera_de_horario',
      message: `No hay servicio disponible a las ${hhmm}. Horarios: ${VENTANAS_COMIDA.map((v) => v.etiqueta).join(' · ')}`,
      huesped: hp.nombre,
      hora: hhmm,
      ventanas: VENTANAS_COMIDA.map((v) => ({ servicio: v.servicio, inicio: v.inicio, fin: v.fin })),
    });
  }

  const servicio = ventana.servicio;
  const incluida = reserva['incluye_' + servicio.toLowerCase()] === '1';
  if (!incluida) {
    return res.json({
      ok: false,
      estado: 'no_incluida',
      message: `${hp.nombre} no tiene ${servicio.toLowerCase()} incluido en su plan (Res. ${reserva.id_reserva}).`,
      huesped: hp.nombre,
      reserva: reserva.id_reserva,
      servicio,
    });
  }

  const consumos = readCsv('consumos.csv');
  const yaReclamada = consumos.some(
    (c) => c.id_reserva === reserva.id_reserva && c.servicio === servicio && c.fecha === todayStr()
  );
  if (yaReclamada) {
    return res.json({
      ok: false,
      estado: 'ya_reclamado',
      message: `${hp.nombre} ya reclamó el ${servicio.toLowerCase()} hoy.`,
      huesped: hp.nombre,
      reserva: reserva.id_reserva,
      servicio,
    });
  }

  consumos.push({
    id: String(nextId(consumos, 'id')),
    id_reserva: reserva.id_reserva,
    servicio,
    fecha: todayStr(),
    hora: nowTime(),
  });
  writeCsv('consumos.csv', consumos);

  // Crear ticket en el turnero (pantalla de la cafetería)
  const turnero = readCsv('turnero.csv');
  const ticket = {
    id: String(nextId(turnero, 'id')),
    id_reserva: reserva.id_reserva,
    id_huesped: hp.id,
    huesped: hp.nombre,
    habitacion: reserva.habitacion,
    servicio,
    fecha: todayStr(),
    hora: nowTime(),
    estado: 'EN_PREPARACION',
  };
  turnero.push(ticket);
  writeCsv('turnero.csv', turnero);

  res.json({
    ok: true,
    estado: 'recibido',
    message: `${servicio} recibido correctamente para ${hp.nombre}.`,
    huesped: hp.nombre,
    reserva: reserva.id_reserva,
    habitacion: reserva.habitacion,
    servicio,
    hora: nowTime(),
    turnero: stripInternal(ticket),
  });
});

// ------------------------------------------------------------------
// TURNERO — Pantalla de estados de pedidos de la cafetería
// ------------------------------------------------------------------

// Estado activo (no recogido) del turnero del día
app.get('/api/turnero', requireAuth, (req, res) => {
  const fecha = req.query.fecha || todayStr();
  const delDia = readCsv('turnero.csv').filter((t) => t.fecha === fecha);
  const activos = delDia
    .filter((t) => t.estado !== 'RECOGIDO')
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(stripInternal);
  const ultimo = delDia
    .filter((t) => t.estado === 'RECOGIDO')
    .sort((a, b) => b.id.localeCompare(a.id))[0];
  res.json({ fecha, turnero: activos, ultimo_entregado: ultimo ? stripInternal(ultimo) : null });
});

// Historial del día (pedidos recogidos, se mantienen en la base de datos)
app.get('/api/turnero/historial', requireAuth, (req, res) => {
  const fecha = req.query.fecha || todayStr();
  const recogidos = readCsv('turnero.csv')
    .filter((t) => t.fecha === fecha && t.estado === 'RECOGIDO')
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(stripInternal);
  res.json({ fecha, recogidos });
});

// Consulta para el kiosco: ¿el huésped ya recibió la comida de la ventana vigente?
app.get('/api/turnero/estado', requireAuth, (req, res) => {
  const { id_huesped, hora } = req.query;
  if (!id_huesped) {
    return res.status(400).json({ error: 'Debe indicar el id_huesped.' });
  }

  const huespedes = readCsv('huespedes.csv');
  const hp = huespedes.find((h) => h.id === String(id_huesped));
  if (!hp) {
    return res.json({ ok: false, estado: 'no_encontrado', message: 'El huésped no está registrado.' });
  }

  const reservas = readCsv('reservas.csv');
  const activas = reservas
    .filter((r) => r.id_huesped === hp.id && r.estado === 'Activa')
    .sort((a, b) => b.fecha_checkin.localeCompare(a.fecha_checkin));
  if (activas.length === 0) {
    return res.json({ ok: false, estado: 'sin_reserva_activa', message: `${hp.nombre} no tiene una reserva activa.`, huesped: hp.nombre });
  }
  const reserva = activas[0];

  const hhmm = /^\d{2}:\d{2}$/.test(String(hora || '')) ? String(hora) : nowTime();
  const ventana = VENTANAS_COMIDA.find((v) => hhmm >= v.inicio && hhmm <= v.fin);
  if (!ventana) {
    return res.json({
      ok: false,
      estado: 'fuera_de_horario',
      message: `No hay servicio disponible a las ${hhmm}.`,
      huesped: hp.nombre,
      servicio: null,
      hora: hhmm,
    });
  }

  const servicio = ventana.servicio;
  const incluida = reserva['incluye_' + servicio.toLowerCase()] === '1';
  const reclamada = readCsv('consumos.csv').some(
    (c) => c.id_reserva === reserva.id_reserva && c.servicio === servicio && c.fecha === todayStr()
  );

  if (!incluida) {
    return res.json({
      ok: false,
      estado: 'no_incluida',
      message: `${hp.nombre} no tiene ${servicio.toLowerCase()} incluido en su plan.`,
      huesped: hp.nombre,
      reserva: reserva.id_reserva,
      servicio,
    });
  }
  if (reclamada) {
    return res.json({
      ok: false,
      estado: 'ya_reclamado',
      message: `${hp.nombre} ya recibió el ${servicio.toLowerCase()} hoy.`,
      huesped: hp.nombre,
      reserva: reserva.id_reserva,
      servicio,
    });
  }

  res.json({
    ok: true,
    estado: 'disponible',
    message: `${servicio} disponible para ${hp.nombre}.`,
    huesped: hp.nombre,
    reserva: reserva.id_reserva,
    habitacion: reserva.habitacion,
    servicio,
    hora: hhmm,
  });
});

// Marcar un pedido como listo para recoger
app.post('/api/turnero/:id/lista', requireAuth, (req, res) => {
  const turnero = readCsv('turnero.csv');
  const t = turnero.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Pedido del turnero no encontrado.' });
  if (t.estado !== 'EN_PREPARACION') {
    return res.status(400).json({ error: 'Solo se puede marcar como listo un pedido en preparación.' });
  }
  t.estado = 'LISTO_PARA_RECOGER';
  writeCsv('turnero.csv', turnero);
  res.json({ message: `${t.huesped}: ${t.servicio} listo para recoger.`, turnero: stripInternal(t) });
});

// Marcar un pedido como recogido (se borra de la pantalla, queda en la base de datos)
app.post('/api/turnero/:id/recogido', requireAuth, (req, res) => {
  const turnero = readCsv('turnero.csv');
  const t = turnero.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Pedido del turnero no encontrado.' });
  if (t.estado !== 'LISTO_PARA_RECOGER') {
    return res.status(400).json({ error: 'Solo se puede recoger un pedido que esté listo para recoger.' });
  }
  t.estado = 'RECOGIDO';
  writeCsv('turnero.csv', turnero);
  res.json({ message: `${t.huesped}: ${t.servicio} recogido.`, turnero: stripInternal(t) });
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
    .filter((u) => u.rol !== 'admin')
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

// Agregar un nuevo producto al inventario
app.post('/api/inventario', requireAuth, requireAdmin, (req, res) => {
  const { nombre, unidad, stock, stock_minimo } = req.body || {};
  if (!nombre || !String(nombre).trim()) {
    return res.status(400).json({ error: 'Indique el nombre del producto.' });
  }
  const s = parseFloat(stock);
  const sm = parseFloat(stock_minimo);
  if (isNaN(s) || s < 0) {
    return res.status(400).json({ error: 'Stock inválido.' });
  }
  if (isNaN(sm) || sm < 0) {
    return res.status(400).json({ error: 'Stock mínimo inválido.' });
  }
  const productos = readCsv('productos.csv');
  if (productos.some((p) => p.nombre.toLowerCase() === String(nombre).trim().toLowerCase())) {
    return res.status(400).json({ error: 'Ya existe un producto con ese nombre.' });
  }
  const nuevo = {
    id: String(nextId(productos, 'id')),
    nombre: String(nombre).trim(),
    unidad: String(unidad || '').trim(),
    stock: String(redondear(s)),
    stock_minimo: String(redondear(sm)),
  };
  productos.push(nuevo);
  writeCsv('productos.csv', productos);
  res.status(201).json({ message: `Producto ${nuevo.nombre} agregado al inventario.`, producto: stripInternal(nuevo) });
});

// Eliminar un producto del inventario
app.delete('/api/inventario/:id', requireAuth, requireAdmin, (req, res) => {
  const productos = readCsv('productos.csv');
  const idx = productos.findIndex((p) => p.id === String(req.params.id));
  if (idx === -1) {
    return res.status(404).json({ error: 'Producto no encontrado.' });
  }
  const eliminado = productos[idx];
  productos.splice(idx, 1);
  writeCsv('productos.csv', productos);
  res.json({ message: `Producto ${eliminado.nombre} eliminado del inventario.` });
});

// Registrar comanda con descuento automático de stock
app.post('/api/comandas', requireAuth, (req, res) => {
  const { id_mesero, tipo_servicio, id_mesa, id_reserva, platos } = req.body || {};

  if (!id_mesero) return res.status(400).json({ error: 'Seleccione el mesero responsable.' });
  const mesero = readCsv('usuarios.csv').find((m) => m.id === String(id_mesero) && m.rol !== 'admin');
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
app.post('/api/comandas/:id/entregar', requireAuth, (req, res) => {
  const comandas = readCsv('comandas.csv');
  const c = comandas.find((x) => x.id_comanda === req.params.id);
  if (!c) return res.status(404).json({ error: 'Comanda no encontrada.' });
  if (c.estado !== 'Registrada') {
    return res.status(400).json({ error: 'Solo se puede entregar una comanda en estado Registrada.' });
  }
  c.estado = 'Entregada';
  writeCsv('comandas.csv', comandas);

  // La comanda es un ingreso aparte (no está incluida en las reservas):
  // al completarse, se suma automáticamente al balance como ingreso de caja.
  // Si es de un huésped, se clasifica como consumo de huésped (no como venta de comanda).
  let cliente = '';
  if (c.tipo_servicio === 'mesa') {
    const mesa = readCsv('mesas.csv').find((m) => m.id === c.id_mesa);
    cliente = mesa ? mesa.nombre : 'Mesa ' + c.id_mesa;
  } else {
    const rsv = readCsv('reservas.csv').find((r) => r.id_reserva === c.id_reserva);
    const hp = rsv ? readCsv('huespedes.csv').find((h) => h.id === rsv.id_huesped) : null;
    cliente = hp ? hp.nombre : 'Res. ' + c.id_reserva;
  }

  const origen = c.tipo_servicio === 'huesped' ? 'huesped' : 'comanda';

  const caja = readCsv('caja.csv');
  caja.push({
    id: String(nextId(caja, 'id')),
    origen,
    tipo: 'ingreso',
    id_reserva: c.tipo_servicio === 'huesped' ? String(c.id_reserva) : '',
    concepto: `Comanda #${c.id_comanda} - ${cliente}`,
    valor: String(c.total),
    fecha: c.fecha,
    hora: nowTime(),
    registrado_por: req.usuario.nombre,
  });
  writeCsv('caja.csv', caja);

  const clasificacion = origen === 'huesped' ? 'como consumo de huésped' : 'como venta de comanda';
  res.json({
    message: `Comanda ${c.id_comanda} marcada como entregada. El total se sumó al balance ${clasificacion}.`,
  });
});

// Cancelar comanda y restaurar stock
app.post('/api/comandas/:id/cancelar', requireAuth, (req, res) => {
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
// MÓDULO C — Financiero y Reportes
// ------------------------------------------------------------------

const ORIGENES_CAJA = ['externo', 'huesped', 'gasto'];

// Flujo de caja: movimientos y totales del día
app.get('/api/caja', requireAuth, requireAdmin, (req, res) => {
  const fecha = req.query.fecha || todayStr();
  const movimientos = readCsv('caja.csv')
    .filter((m) => m.fecha === fecha)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(stripInternal);

  const sumar = (fn) =>
    movimientos.filter(fn).reduce((s, m) => s + parseFloat(m.valor), 0);

  const ingresos = sumar((m) => m.tipo === 'ingreso');
  const egresos = sumar((m) => m.tipo === 'egreso');

  res.json({
    fecha,
    movimientos,
    totales: {
      externos: redondear(sumar((m) => m.origen === 'externo' && m.tipo === 'ingreso')),
      huespedes: redondear(sumar((m) => m.origen === 'huesped' && m.tipo === 'ingreso')),
      comandas: redondear(sumar((m) => m.origen === 'comanda' && m.tipo === 'ingreso')),
      ingresos: redondear(ingresos),
      egresos: redondear(egresos),
      neto: redondear(ingresos - egresos),
    },
  });
});

// Registrar un movimiento de caja
app.post('/api/caja', requireAuth, requireAdmin, (req, res) => {
  const { tipo, origen, id_reserva, concepto, valor } = req.body || {};

  if (!['ingreso', 'egreso'].includes(tipo)) {
    return res.status(400).json({ error: 'Tipo de movimiento inválido.' });
  }
  if (!ORIGENES_CAJA.includes(origen)) {
    return res.status(400).json({ error: 'Origen del movimiento inválido.' });
  }
  const v = parseFloat(valor);
  if (isNaN(v) || v <= 0) {
    return res.status(400).json({ error: 'Ingrese un valor mayor a cero.' });
  }
  if (!concepto || !String(concepto).trim()) {
    return res.status(400).json({ error: 'Indique el concepto del movimiento.' });
  }
  if (origen === 'huesped') {
    if (!id_reserva) {
      return res.status(400).json({ error: 'Indique el número de reserva del huésped.' });
    }
    const rsv = readCsv('reservas.csv').find((r) => r.id_reserva === String(id_reserva));
    if (!rsv) return res.status(400).json({ error: 'La reserva no existe.' });
  }

  const caja = readCsv('caja.csv');
  const nuevo = {
    id: String(nextId(caja, 'id')),
    origen,
    tipo,
    id_reserva: origen === 'huesped' ? String(id_reserva) : '',
    concepto: String(concepto).trim(),
    valor: String(v),
    fecha: todayStr(),
    hora: nowTime(),
    registrado_por: req.usuario.nombre,
  };
  caja.push(nuevo);
  writeCsv('caja.csv', caja);

  res.status(201).json({ message: 'Movimiento de caja registrado.', movimiento: stripInternal(nuevo) });
});

// Reporte operativo: comidas entregadas del día
app.get('/api/reporte-operativo', requireAuth, requireAdmin, (req, res) => {
  const fecha = req.query.fecha || todayStr();
  const consumos = readCsv('consumos.csv')
    .filter((c) => c.fecha === fecha)
    .sort((a, b) => (a.hora || '').localeCompare(b.hora || ''));
  const reservas = readCsv('reservas.csv');
  const huespedes = readCsv('huespedes.csv');

  const comidas = { Desayuno: 0, Almuerzo: 0, Cena: 0 };
  consumos.forEach((c) => {
    if (comidas[c.servicio] !== undefined) comidas[c.servicio]++;
  });

  const detalle = consumos.map((c) => {
    const rsv = reservas.find((r) => r.id_reserva === c.id_reserva);
    const hp = rsv ? huespedes.find((h) => h.id === rsv.id_huesped) : null;
    return {
      ...stripInternal(c),
      huesped: hp ? hp.nombre : '',
      habitacion: rsv ? rsv.habitacion : '',
    };
  });

  const comandas = readCsv('comandas.csv').filter(
    (c) => c.fecha === fecha && c.estado !== 'Cancelada'
  );
  const ventasComandas = comandas.reduce((s, c) => s + parseFloat(c.total), 0);

  res.json({
    fecha,
    comidas,
    totalComidas: consumos.length,
    detalle,
    comandas: { cantidad: comandas.length, ventas: redondear(ventasComandas) },
  });
});

// ------------------------------------------------------------------
// DASHBOARD — Resumen del día para el asistente de la portada
// ------------------------------------------------------------------
app.get('/api/dashboard', requireAuth, (req, res) => {
  const fecha = req.query.fecha || todayStr();
  const reservas = readCsv('reservas.csv');
  const huespedes = readCsv('huespedes.csv');
  const consumos = readCsv('consumos.csv');

  const activas = reservas.filter(
    (r) => r.estado === 'Activa' && r.fecha_checkin <= fecha && r.fecha_checkout >= fecha
  );
  const consumosHoy = consumos.filter((c) => c.fecha === fecha);

  const pendientes = { Desayuno: 0, Almuerzo: 0, Cena: 0 };
  const entregados = { Desayuno: 0, Almuerzo: 0, Cena: 0 };
  for (const m of MEALS) {
    entregados[m] = consumosHoy.filter((c) => c.servicio === m).length;
    for (const r of activas) {
      if (r['incluye_' + m.toLowerCase()] === '1') {
        const ya = consumosHoy.some((c) => c.id_reserva === r.id_reserva && c.servicio === m);
        if (!ya) pendientes[m]++;
      }
    }
  }

  // Stock bajo solo para administradores (el kiosco no ve inventario)
  let stock_bajo = [];
  let agotados = [];
  if (req.usuario.rol === 'admin') {
    const productos = readCsv('productos.csv');
    stock_bajo = productos
      .filter((p) => {
        const stock = parseFloat(p.stock);
        const min = parseFloat(p.stock_minimo);
        return stock > 0 && stock <= min;
      })
      .map((p) => ({ ...stripInternal(p), stock: parseFloat(p.stock), stock_minimo: parseFloat(p.stock_minimo) }));
    agotados = productos
      .filter((p) => parseFloat(p.stock) <= 0)
      .map((p) => ({ ...stripInternal(p), stock: parseFloat(p.stock), stock_minimo: parseFloat(p.stock_minimo) }));
  }

  res.json({
    fecha,
    total_huespedes: huespedes.length,
    reservas: {
      activas: activas.length,
      checkins_hoy: activas.filter((r) => r.fecha_checkin === fecha).length,
      checkouts_hoy: activas.filter((r) => r.fecha_checkout === fecha).length,
    },
    pendientes,
    entregados,
    total_entregados_hoy: consumosHoy.length,
    stock_bajo,
    agotados,
  });
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
