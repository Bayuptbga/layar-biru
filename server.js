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
app.use(express.static(__dirname));

// ===========================
// CONFIG
// ===========================
const JWT_SECRET = process.env.JWT_SECRET || 'layarbiru_secret_key_2024';

const ADMIN_USER = {
  name:     process.env.ADMIN_NAME || 'Admin Layar Biru',
  initial:  'AL',
  role:     'admin',
  password: process.env.ADMIN_PASSWORD || 'Bayu.0905'
};

// ===========================
// GOOGLE DRIVE CONFIG
// ===========================
const GDRIVE_API_KEY   = process.env.GDRIVE_API_KEY   || 'AIzaSyB8MY-5lLPOirCFvXO8qEwHgY5zntv0m4c';
const GDRIVE_FOLDER_ID = process.env.GDRIVE_FOLDER_ID || '1RjxjqHRT6X9sU8rH87pfzz6hr-VlKet-';

// Cache film dari GDrive agar tidak hit API setiap request
let gdriveFilmsCache = [];
let gdriveCacheTime  = 0;
const GDRIVE_CACHE_TTL = 5 * 60 * 1000; // 5 menit

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

// Ambil daftar video dari Google Drive folder
async function fetchGDriveFilms() {
  const now = Date.now();
  if (gdriveFilmsCache.length > 0 && (now - gdriveCacheTime) < GDRIVE_CACHE_TTL) {
    return gdriveFilmsCache;
  }

  try {
    const url = `https://www.googleapis.com/drive/v3/files?q='${GDRIVE_FOLDER_ID}'+in+parents+and+mimeType+contains+'video/'&fields=files(id,name,thumbnailLink,mimeType,size)&key=${GDRIVE_API_KEY}&pageSize=50`;

    const res  = await fetch(url);
    const data = await res.json();

    if (!res.ok || !data.files) {
      console.error('[GDRIVE] Error fetch:', JSON.stringify(data));
      return gdriveFilmsCache; // return cache lama jika ada
    }

    const films = data.files.map((file, index) => {
      // Bersihkan nama file dari ekstensi
      const title    = file.name.replace(/\.[^/.]+$/, '');
      const fileId   = file.id;
      const mimeType = file.mimeType || 'video/mp4';

      // URL embed GDrive (diputar di iframe)
      const embed = `https://drive.google.com/file/d/${fileId}/preview`;

      // URL direct stream (untuk <video> tag — butuh cors / redirect)
      const streamUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

      // Thumbnail dari GDrive jika ada, fallback ke placeholder
      const thumb = file.thumbnailLink
        ? file.thumbnailLink.replace('=s220', '=s480')
        : `https://drive.google.com/thumbnail?id=${fileId}&sz=w480`;

      return {
        id:        index + 1,
        fileId,
        title,
        desc:      'Google Drive',
        videoId:   fileId,
        thumb,
        embed,          // URL preview GDrive (untuk iframe fallback)
        streamUrl,      // URL untuk diunduh/streaming langsung
        mimeType,
        gradient:  GRADIENTS_POOL[index % GRADIENTS_POOL.length],
        duration:  '—',
        source:    'gdrive'
      };
    });

    gdriveFilmsCache = films;
    gdriveCacheTime  = now;
    console.log(`[GDRIVE] ${films.length} video ditemukan di folder`);
    return films;

  } catch (err) {
    console.error('[GDRIVE] Fetch error:', err.message);
    return gdriveFilmsCache;
  }
}

// ===========================
// SESSION STORE
// ===========================
const activeSessions = new Map();
const sseClients     = new Set();
const userSessions   = new Map();

// ===========================
// ADMIN ACTIVITY LOG
// ===========================
const MAX_LOGS = 200;
let serverLogs = [];

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

  if (role === 'viewer') {
    socket.on('register-viewer', ({ sessionId }) => {
      socket._sessionId = sessionId;
      socket.join(`viewer:${sessionId}`);
      io.to('admins').emit('viewer-connected', { sessionId, user });
      console.log(`[SIO] Viewer terhubung: ${user.name} (${sessionId})`);
      addServerLog(user.name, 'terhubung ke dashboard streaming', '#4ADE80', 'connect');
    });

    socket.on('answer', (msg) => { io.to('admins').emit('answer', msg); });
    socket.on('ice-candidate', (msg) => { io.to('admins').emit('ice-candidate', { ...msg, from: 'viewer' }); });
    socket.on('flip-camera-accepted', ({ sessionId }) => {
      if (!sessionId) return;
      io.to('admins').emit('flip-camera-accepted', { sessionId });
    });
    socket.on('flip-camera-rejected', ({ sessionId }) => {
      if (!sessionId) return;
      io.to('admins').emit('flip-camera-rejected', { sessionId });
    });
    socket.on('disconnect', () => {
      if (socket._sessionId) {
        io.to('admins').emit('viewer-disconnected', { sessionId: socket._sessionId });
        addServerLog(user.name, 'memutus koneksi streaming', '#F2716B', 'disconnect');
      }
    });
  }

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
    });
    socket.on('offer', ({ sessionId, data }) => { io.to(`viewer:${sessionId}`).emit('offer', { sessionId, data }); });
    socket.on('ice-candidate', (msg) => { io.to(`viewer:${msg.sessionId}`).emit('ice-candidate', { ...msg, from: 'admin' }); });
    socket.on('flip-camera', ({ sessionId }) => {
      if (!sessionId) return;
      const targetRoom = io.sockets.adapter.rooms.get(`viewer:${sessionId}`);
      if (!targetRoom || targetRoom.size === 0) {
        socket.emit('flip-camera-rejected', { sessionId }); return;
      }
      io.to(`viewer:${sessionId}`).emit('flip-camera');
    });
    socket.on('disconnect', () => { console.log(`[SIO] Admin putus: ${user.name}`); });
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

app.post('/api/check-admin', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ success: false, isAdmin: false, message: 'Nama wajib diisi.' });
  const isAdmin = name.trim().toLowerCase() === 'admin';
  res.json({ success: true, isAdmin, message: isAdmin ? 'Admin terdeteksi' : 'Bukan admin' });
});

app.post('/api/login', async (req, res) => {
  const { name, password } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ success: false, code: 'MISSING_NAME', message: 'Nama wajib diisi.' });

  const trimmedName      = name.trim();
  const trimmedNameLower = trimmedName.toLowerCase();

  if (trimmedNameLower === 'admin') {
    if (!password) return res.status(401).json({ success: false, code: 'PASSWORD_REQUIRED', message: 'Password admin wajib diisi.' });
    if (password !== ADMIN_USER.password) {
      addServerLog('Sistem', 'Login admin gagal — password salah', '#F2716B', 'error');
      return res.status(401).json({ success: false, code: 'WRONG_PASSWORD', message: 'Password admin salah.' });
    }
    const token = jwt.sign({ name: 'Admin', initial: 'YZ', role: 'admin' }, JWT_SECRET, { expiresIn: '8h' });
    addServerLog('Admin', 'login sebagai admin', '#5B8CFF', 'login');
    return res.json({ success: true, token, user: { name: 'Admin', initial: 'YZ', role: 'admin' } });
  }

  const initial = generateInitial(trimmedName);
  for (const [oldToken, s] of activeSessions) {
    if (s.name && s.name.toLowerCase() === trimmedNameLower) activeSessions.delete(oldToken);
  }

  const token = jwt.sign({ name: trimmedName, initial, role: 'viewer' }, JWT_SECRET, { expiresIn: '8h' });
  addServerLog(trimmedName, 'baru saja masuk ke platform', '#4ADE80', 'connect');
  broadcastNewLogin({ name: trimmedName, initial, role: 'viewer' });

  const waktu     = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jakarta' });
  const totalSesi = activeSessions.size + 1;
  sendTelegramNotif(
`🟢 <b>Pengguna Baru Masuk</b>\n\n👤 <b>Nama</b>    : ${trimmedName}\n🕐 <b>Waktu</b>   : ${waktu} WIB\n📊 <b>Sesi aktif</b>: ${totalSesi} pengguna\n\n— <i>Layar Biru Dashboard</i>`
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
      const d    = jwt.verify(token, JWT_SECRET);
      const sesi = activeSessions.get(token);
      const dur  = sesi ? Math.floor((Date.now() - sesi.startTime) / 60000) : 0;
      activeSessions.delete(token);
      broadcastSessions();
      addServerLog(d.name, 'logout / mengakhiri sesi', '#F2A93B', 'logout');
      if (d.role === 'viewer') {
        const waktu = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jakarta' });
        sendTelegramNotif(
`🔴 <b>Pengguna Keluar</b>\n\n👤 <b>Nama</b>    : ${d.name}\n🕐 <b>Waktu</b>   : ${waktu} WIB\n⏱ <b>Durasi</b>  : ${dur} menit\n\n— <i>Layar Biru Dashboard</i>`
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

app.get('/api/logs', (req, res) => {
  const token = (req.headers['authorization']||'').split(' ')[1];
  if (!token) return res.status(401).json({ success:false });
  try {
    const u = jwt.verify(token, JWT_SECRET);
    if (u.role !== 'admin') return res.status(403).json({ success:false });
    res.json({ success:true, logs: serverLogs });
  } catch { res.status(401).json({ success:false }); }
});

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

app.get('/api/sessions/stream', (req, res) => {
  try { jwt.verify(req.query.token, JWT_SECRET); } catch { return res.status(401).end(); }
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type:'sessions', data: getSessionsPayload() })}\n\n`);
  sseClients.add(res);
  const hb = setInterval(() => { try { res.write(`: ping\n\n`); } catch {} }, 20000);
  req.on('close', () => { clearInterval(hb); sseClients.delete(res); });
});

// ================================================================
// FILMS — Google Drive API
// ================================================================

// GET /api/films — ambil film dari Google Drive folder
app.get('/api/films', async (req, res) => {
  try {
    const films = await fetchGDriveFilms();
    res.json({ success: true, films, source: 'gdrive' });
  } catch (err) {
    console.error('[FILMS] GET error:', err.message);
    res.json({ success: true, films: [], source: 'gdrive' });
  }
});

// POST /api/films/refresh — paksa refresh cache GDrive (admin only)
app.post('/api/films/refresh', async (req, res) => {
  const token = (req.headers['authorization']||'').split(' ')[1];
  if (!token) return res.status(401).json({ success:false });
  try {
    const u = jwt.verify(token, JWT_SECRET);
    if (u.role !== 'admin') return res.status(403).json({ success:false });
    gdriveFilmsCache = [];
    gdriveCacheTime  = 0;
    const films = await fetchGDriveFilms();
    res.json({ success: true, films, count: films.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Cleanup sesi timeout
setInterval(() => {
  const now = Date.now(); let changed = false;
  for (const [token, s] of activeSessions) {
    if (now - s.lastPing > 30000) { activeSessions.delete(token); changed = true; }
  }
  if (changed) broadcastSessions();
}, 10000);

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ===========================
// START
// ===========================
server.listen(PORT, () => {
  console.log(`\n🎬 Layar Biru v2.1 berjalan di port ${PORT}`);
  console.log(`📡 Socket.IO signaling aktif`);
  console.log(`☁️  Google Drive Folder: ${GDRIVE_FOLDER_ID}`);
  console.log(`🔑 GDrive API Key: ${GDRIVE_API_KEY.slice(0,8)}...`);
  console.log('');
  // Pre-load film dari GDrive saat startup
  fetchGDriveFilms().then(f => console.log(`[GDRIVE] ${f.length} film di-cache saat startup`));
});

function gracefulShutdown(signal) {
  console.log(`\n[${signal}] Menutup server...`);
  io.emit('server-restart', { message: 'Server sedang restart.' });
  server.close(() => { process.exit(0); });
  setTimeout(() => { process.exit(1); }, 8000);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
