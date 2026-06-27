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
  password: process.env.ADMIN_PASSWORD || 'Bayu.0905'
};

// ===========================
// SESSION STORE
// ===========================
const activeSessions = new Map(); // token → sessionData
const sseClients     = new Set(); // SSE admin connections
const userSessions   = new Map(); // username → session count (untuk tracking)

// ===========================
// ADMIN ACTIVITY LOG — Persisten di server (tidak hilang saat refresh)
// ===========================
const MAX_LOGS = 200;
let serverLogs = []; // { id, user, action, color, type, time, date, timestamp }

function addServerLog(user, action, color = '#5B8CFF', type = '') {
  const now = new Date();
  const entry = {
    id:        now.getTime() + '-' + Math.random().toString(36).slice(2, 7),
    user,
    action,
    color,
    type,
    time:      now.toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit', second:'2-digit', timeZone:'Asia/Jakarta' }),
    date:      now.toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric', timeZone:'Asia/Jakarta' }),
    timestamp: now.getTime()
  };
  serverLogs.unshift(entry);
  if (serverLogs.length > MAX_LOGS) serverLogs.length = MAX_LOGS;

  // Broadcast ke semua admin yang sedang terhubung via SSE
  const payload = JSON.stringify({ type: 'log', data: entry });
  for (const res of sseClients) {
    try { res.write(`data: ${payload}\n\n`); } catch {}
  }
  return entry;
}

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
    email:     s.user.name, // gunakan name sebagai identifier
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
  // Ambil huruf pertama dari 2 kata pertama
  return (parts[0].substring(0, 1) + parts[1].substring(0, 1)).toUpperCase();
}

// ===========================
// SOCKET.IO — WebRTC SIGNALING
// ===========================
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST'] },
  transports: ['polling', 'websocket'],   // polling dulu → upgrade ke WS (lebih stabil di Railway)
  pingInterval: 20000,                    // kirim ping setiap 20 detik
  pingTimeout:  30000,                    // timeout setelah 30 detik tidak ada pong
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
      // Beritahu semua admin ada viewer baru
      io.to('admins').emit('viewer-connected', { sessionId, user });
      console.log(`[SIO] Viewer terhubung: ${user.name} (${sessionId})`);
      addServerLog(user.name, 'terhubung ke dashboard streaming', '#4ADE80', 'connect');
    });

    socket.on('answer', (msg) => {
      io.to('admins').emit('answer', msg);
    });

    socket.on('ice-candidate', (msg) => {
      io.to('admins').emit('ice-candidate', { ...msg, from: 'viewer' });
    });

    // Teruskan feedback flip kamera ke semua admin
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
        addServerLog(user.name, 'memutus koneksi streaming', '#F2716B', 'disconnect');
      }
    });
  }

  // ── ADMIN ──
  if (role === 'admin') {
    socket.join('admins');

    socket.on('register-admin', () => {
      // Kirim daftar viewer yang sudah aktif
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

    // Admin meminta viewer membalik kamera (depan/belakang)
    socket.on('flip-camera', ({ sessionId }) => {
      if (!sessionId) return;
      // Cek apakah viewer target masih terhubung
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

// CHECK ADMIN — Cek apakah username adalah admin
app.post('/api/check-admin', (req, res) => {
  const { name } = req.body;
  
  if (!name || !name.trim()) {
    return res.status(400).json({ 
      success: false, 
      isAdmin: false,
      message: 'Nama wajib diisi.' 
    });
  }

  const trimmedName = name.trim().toLowerCase();
  
  // Cek apakah nama adalah admin username (yungz)
  const isAdmin = trimmedName === 'admin';
  
  res.json({
    success: true,
    isAdmin: isAdmin,
    message: isAdmin ? 'Admin terdeteksi, silakan masukkan password' : 'Username tidak terdaftar sebagai admin'
  });
});

// LOGIN — Dengan nama dan optional password untuk admin
app.post('/api/login', async (req, res) => {
  const { name, password } = req.body;
  
  if (!name || !name.trim()) {
    return res.status(400).json({ 
      success: false, 
      code: 'MISSING_NAME', 
      message: 'Nama wajib diisi.' 
    });
  }

  const trimmedName = name.trim();
  const trimmedNameLower = trimmedName.toLowerCase();

  // Cek apakah ini admin
  if (trimmedNameLower === 'admin') {
    // Ini admin, validasi password
    if (!password) {
      return res.status(401).json({
        success: false,
        code: 'PASSWORD_REQUIRED',
        message: 'Password admin wajib diisi.'
      });
    }

    if (password !== ADMIN_USER.password) {
      addServerLog('Sistem', 'Login admin gagal — password salah', '#F2716B', 'error');
      return res.status(401).json({
        success: false,
        code: 'WRONG_PASSWORD',
        message: 'Password admin salah.'
      });
    }

    // Password benar, login sebagai admin
    const token = jwt.sign(
      { name: 'Admin', initial: 'YZ', role: 'admin' },
      JWT_SECRET,
      { expiresIn: '8h' }
    );
    console.log(`[LOGIN] Admin: Wnot`);
    addServerLog('Admin', 'login sebagai admin', '#5B8CFF', 'login');
    return res.json({
      success: true,
      token,
      user: { name: 'Admin', initial: 'YZ', role: 'admin' }
    });
  }

  // Bukan admin - login sebagai viewer
  const initial = generateInitial(trimmedName);

  // Cleanup sesi lama dengan nama yang sama agar tidak double card di admin
  for (const [oldToken, s] of activeSessions) {
    if (s.name && s.name.toLowerCase() === trimmedNameLower) {
      activeSessions.delete(oldToken);
      console.log(`[LOGIN] Sesi lama ${trimmedName} dihapus sebelum login ulang`);
    }
  }

  const token = jwt.sign(
    { name: trimmedName, initial: initial, role: 'viewer' },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  console.log(`[LOGIN] Viewer: ${trimmedName}`);
  addServerLog(trimmedName, 'baru saja masuk ke platform', '#4ADE80', 'connect');
  // Notifikasi ke semua admin SSE bahwa ada pengguna baru masuk
  broadcastNewLogin({ name: trimmedName, initial: initial, role: 'viewer' });

  // Kirim notifikasi Telegram ke admin
  const waktu = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jakarta' });
  const totalSesi = activeSessions.size + 1; // +1 karena sesi baru belum masuk activeSessions
  sendTelegramNotif(
`🟢 <b>Pengguna Baru Masuk</b>

👤 <b>Nama</b>    : ${trimmedName}
🕐 <b>Waktu</b>   : ${waktu} WIB
📊 <b>Sesi aktif</b>: ${totalSesi} pengguna

— <i>Layar Biru Dashboard</i>`
  );

  res.json({
    success: true,
    token,
    user: { name: trimmedName, initial: initial, role: 'viewer' }
  });
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
      addServerLog(d.name, 'logout / mengakhiri sesi', '#F2A93B', 'logout');

      // Notifikasi Telegram hanya untuk viewer
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

// GET /api/logs — ambil histori log admin (persisten, tahan refresh)
app.get('/api/logs', (req, res) => {
  const token = (req.headers['authorization']||'').split(' ')[1];
  if (!token) return res.status(401).json({ success:false });
  try {
    const u = jwt.verify(token, JWT_SECRET);
    if (u.role !== 'admin') return res.status(403).json({ success:false });
    res.json({ success:true, logs: serverLogs });
  } catch { res.status(401).json({ success:false }); }
});

// DELETE /api/logs — hapus semua histori log (admin only)
app.delete('/api/logs', (req, res) => {
  const token = (req.headers['authorization']||'').split(' ')[1];
  if (!token) return res.status(401).json({ success:false });
  try {
    const u = jwt.verify(token, JWT_SECRET);
    if (u.role !== 'admin') return res.status(403).json({ success:false });
    serverLogs = [];
    res.json({ success:true });
  } catch { res.status(401).json({ success:false }); }
});

// SSE stream untuk admin (stats counter)
app.get('/api/sessions/stream', (req, res) => {
  try { jwt.verify(req.query.token, JWT_SECRET); } catch { return res.status(401).end(); }
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type:'sessions', data: getSessionsPayload() })}\n\n`);
  sseClients.add(res);
  // Heartbeat setiap 20 detik agar SSE tidak di-cut Railway (max 5 menit idle)
  const hb = setInterval(() => {
    try { res.write(`: ping\n\n`); } catch {}
  }, 20000);
  req.on('close', () => { clearInterval(hb); sseClients.delete(res); });
});

// Cleanup sesi timeout (tidak ping > 30 detik)
setInterval(() => {
  const now = Date.now(); let changed = false;
  for (const [token, s] of activeSessions) {
    if (now - s.lastPing > 30000) { activeSessions.delete(token); changed = true; }
  }
  if (changed) broadcastSessions();
}, 10000);




// ================================================================
// FILMS — In-Memory Storage (Tanpa MongoDB)
// ================================================================

// Film data disimpan di memory (hilang saat server restart)
let filmsData = [
  {
    id: 1,
    title: 'Japannese 1',
    desc: 'Japan',
    videoId: 'okkbeedc45d',
    thumb: 'https://thumb-cdn77.xvideos-cdn.com/50fe30cb-814d-46ea-bbac-b476baa90f91/0/xv_3_t.jpg',
    embed: 'https://www.xvideos.com/embedframe/okkbeedc45d',
    gradient: 'linear-gradient(135deg,#1a1a2e,#16213e)',
    duration: '1h 30m'
  },
  {
    id: 2,
    title: 'Japannese 2',
    desc: 'Japan',
    videoId: 'uellueb651a',
    thumb: 'https://thumbs-gcore.xvideos-cdn.com/9a11ef1d-b5fd-44f1-b0cc-ac696c1d748a/0/xv_5_t.jpg',
    embed: 'https://www.xvideos.com/embedframe/uellueb651a',
    gradient: 'linear-gradient(135deg,#0f3460,#533483)',
    duration: '1h 30m'
  },
  {
    id: 3,
    title: 'Japannese 3',
    desc: 'Japan',
    videoId: 'udptlbbc307',
    thumb: 'https://thumb-cdn77.xvideos-cdn.com/bf05f85c-e1da-4522-9ac3-fc349b90c19f/0/xv_4_t.jpg',
    embed: 'https://www.xvideos.com/embedframe/udptlbbc307',
    gradient: 'linear-gradient(135deg,#e94560,#0f3460)',
    duration: '1h 30m'
  },
  {
    id: 4,
    title: 'Japannese 4',
    desc: 'Japan',
    videoId: 'kvceumk9d12',
    thumb: 'https://thumbs-gcore.xvideos-cdn.com/5c5c996e-8d49-40cc-9362-8950b6e6e2c0/0/xv_13_t.jpg',
    embed: 'https://www.xvideos.com/embedframe/kvceumk9d12',
    gradient: 'linear-gradient(135deg,#2c003e,#ad5cad)',
    duration: '1h 30m'
  },
  {
    id: 5,
    title: 'Japannese 5',
    desc: 'Japan',
    videoId: 'oiopumb63e9',
    thumb: 'https://thumbs-gcore.xvideos-cdn.com/5028e180-83a5-4770-ab9d-5917d4dd8e2a/0/xv_16_t.jpg',
    embed: 'https://www.xvideos.com/embedframe/oiopumb63e9',
    gradient: 'linear-gradient(135deg,#1b1b2f,#e43f5a)',
    duration: '1h 30m'
  },
  {
    id: 6,
    title: 'Romance 1',
    desc: 'USA Romance',
    videoId: 'oofpkhie377',
    thumb: 'https://thumb-cdn77.xvideos-cdn.com/f56dd1cb-b208-476a-8eac-b3122532f9a6/4/xv_30_t.jpg',
    embed: 'https://www.xvideos.com/embedframe/oofpkhie377',
    gradient: 'linear-gradient(135deg,#162447,#1f4068)',
    duration: '1h 30m'
  },
  {
    id: 7,
    title: 'Romance 2',
    desc: 'USA Romance',
    videoId: 'oofpkhbcb6d',
    thumb: 'https://thumb-cdn77.xvideos-cdn.com/46122ae9-d9e8-4526-9490-291910b347ce/4/xv_30_t.jpg',
    embed: 'https://www.xvideos.com/embedframe/oofpkhbcb6d',
    gradient: 'linear-gradient(135deg,#1b262c,#0f4c75)',
    duration: '1h 30m'
  },
  {
    id: 8,
    title: 'Romance 3',
    desc: 'USA Romance',
    videoId: 'oovploe8868',
    thumb: 'https://thumb-cdn77.xvideos-cdn.com/44b5c5e9-56ef-41be-af96-149b1e4c138c/3/xv_30_t.jpg',
    embed: 'https://www.xvideos.com/embedframe/oovploe8868',
    gradient: 'linear-gradient(135deg,#2d132c,#ee4540)',
    duration: '1h 30m'
  },
  {
    id: 9,
    title: 'Romance 4',
    desc: 'USA Romance',
    videoId: 'oovivca4f73',
    thumb: 'https://thumbs-gcore.xvideos-cdn.com/af1621b4-9cbb-4e65-98e6-be8d55ec549f/3/xv_30_t.jpg',
    embed: 'https://www.xvideos.com/embedframe/oovivca4f73',
    gradient: 'linear-gradient(135deg,#0d0d0d,#3a0ca3)',
    duration: '1h 30m'
  },
  {
    id: 10,
    title: 'Romance 5',
    desc: 'USA Romance',
    videoId: 'oovidcvd0ba',
    thumb: 'https://thumbs-gcore.xvideos-cdn.com/aa9f4667-023d-419d-870f-00b436d83b30/3/xv_30_t.jpg',
    embed: 'https://www.xvideos.com/embedframe/oovidcvd0ba',
    gradient: 'linear-gradient(135deg,#10002b,#e0aaff)',
    duration: '1h 30m'
  }
];

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
app.get('/api/films', (req, res) => {
  try {
    res.json({ success: true, films: filmsData });
  } catch (err) {
    console.error('[FILMS] GET error:', err.message);
    res.json({ success: true, films: [] });
  }
});

// POST /api/films — tambah film baru (admin only)
app.post('/api/films', (req, res) => {
  if (!verifyAdmin(req, res)) return;

  const { title, desc, videoId, thumb, duration } = req.body;
  if (!title || !desc || !videoId || !thumb)
    return res.status(400).json({ success: false, message: 'Field title, desc, videoId, thumb wajib diisi' });

  try {
    // Cek apakah videoId sudah ada
    const exists = filmsData.find(f => f.videoId === videoId);
    if (exists) return res.status(400).json({ success: false, message: 'Video ID sudah ada' });

    // Generate ID baru
    const nextId = filmsData.length > 0 ? Math.max(...filmsData.map(f => f.id || 0)) + 1 : 1;

    const newFilm = {
      id:       nextId,
      title, 
      desc, 
      videoId, 
      thumb,
      embed:    `https://www.xvideos.com/embedframe/${videoId}`,
      gradient: GRADIENTS_POOL[filmsData.length % GRADIENTS_POOL.length],
      duration: duration || '1h 30m'
    };

    filmsData.push(newFilm);
    console.log(`[FILMS] Film ditambahkan: ${title} (ID: ${nextId})`);
    res.json({ success: true, film: newFilm });
  } catch (err) {
    console.error('[FILMS] POST error:', err.message);
    res.status(500).json({ success: false, message: 'Gagal menyimpan film' });
  }
});

// DELETE /api/films/:videoId — hapus film (admin only)
app.delete('/api/films/:videoId', (req, res) => {
  if (!verifyAdmin(req, res)) return;

  try {
    const index = filmsData.findIndex(f => f.videoId === req.params.videoId);
    if (index === -1)
      return res.status(404).json({ success: false, message: 'Film tidak ditemukan' });

    const deletedFilm = filmsData[index];
    filmsData.splice(index, 1);
    console.log(`[FILMS] Film dihapus: ${deletedFilm.title}`);
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
  console.log(`💾 Database: In-Memory (Tanpa MongoDB)`);
  console.log(`\n📋 Login:`);
  console.log(`  [VIEWER] Masukkan nama apapun untuk login`);
  console.log(`  [ADMIN]  Masukkan password: ${ADMIN_USER.password}`);
  console.log('');
});

// ===========================
// GRACEFUL SHUTDOWN (Railway SIGTERM)
// ===========================
function gracefulShutdown(signal) {
  console.log(`\n[${signal}] Menutup server dengan graceful...`);

  // Beritahu semua client bahwa server akan restart
  io.emit('server-restart', { message: 'Server sedang restart, harap refresh.' });

  server.close(() => {
    console.log('[SHUTDOWN] HTTP server ditutup.');
    process.exit(0);
  });

  // Paksa keluar setelah 8 detik jika ada yang gantung
  setTimeout(() => {
    console.error('[SHUTDOWN] Timeout, force exit.');
    process.exit(1);
  }, 8000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
