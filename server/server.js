const express = require('express');
const path = require('path');
const fs = require('fs');

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
// API: Búsqueda de huésped por documento o número de reserva
// ------------------------------------------------------------------
app.get('/api/search', (req, res) => {
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
app.get('/api/reservas/:id/consumos', (req, res) => {
  const consumos = readCsv('consumos.csv');
  const delDia = consumos.filter(
    (c) => c.id_reserva === req.params.id && c.fecha === todayStr()
  );
  res.json({ consumos: delDia });
});

// ------------------------------------------------------------------
// API: Registrar un consumo (marcar comida reclamada)
// ------------------------------------------------------------------
app.post('/api/consumos', (req, res) => {
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
// Ruta principal
// ------------------------------------------------------------------
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[Hotel Andino] Servidor listo en http://localhost:${PORT}`);
});
