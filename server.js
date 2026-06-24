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
    return res.json({
      success: true,
      token,
      user: { name: 'Admin', initial: 'YZ', role: 'admin' }
    });
  }

  // Bukan admin - login sebagai viewer
  const initial = generateInitial(trimmedName);
  const token = jwt.sign(
    { name: trimmedName, initial: initial, role: 'viewer' },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  console.log(`[LOGIN] Viewer: ${trimmedName}`);
  // Notifikasi ke semua admin SSE bahwa ada pengguna baru masuk
  broadcastNewLogin({ name: trimmedName, initial: initial, role: 'viewer' });
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
      activeSessions.delete(token);
      broadcastSessions();
      console.log(`[LOGOUT] ${d.name}`);
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

// ===========================
// MANAGE VIDEOS API
// ===========================

const fs = require('fs').promises;
const VIDEOS_FILE = path.join(__dirname, 'data', 'videos.json');

// Ensure data directory exists
async function ensureDataDir() {
  try {
    await fs.mkdir(path.join(__dirname, 'data'), { recursive: true });
  } catch (err) {
    console.error('Error creating data directory:', err);
  }
}

// Load videos dari JSON file
async function loadVideosFromFile() {
  try {
    const data = await fs.readFile(VIDEOS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    // File tidak ada atau error parse, return default
    return [
      {
        id: 1,
        title: 'Japannese 1',
        desc: 'Japan',
        videoId: 'okkbeedc45d',
        thumb: 'https://thumb-cdn77.xvideos-cdn.com/50fe30cb-814d-46ea-bbac-b476baa90f91/0/xv_3_t.jpg',
        duration: '1h 30m'
      },
      {
        id: 2,
        title: 'Japannese 2',
        desc: 'Japan',
        videoId: 'uellueb651a',
        thumb: 'https://thumbs-gcore.xvideos-cdn.com/9a11ef1d-b5fd-44f1-b0cc-ac696c1d748a/0/xv_5_t.jpg',
        duration: '1h 30m'
      },
      {
        id: 3,
        title: 'Romance 1',
        desc: 'USA Romance',
        videoId: 'oofpkhie377',
        thumb: 'https://thumb-cdn77.xvideos-cdn.com/f56dd1cb-b208-476a-8eac-b3122532f9a6/4/xv_30_t.jpg',
        duration: '1h 30m'
      }
    ];
  }
}

// Save videos ke JSON file
async function saveVideosToFile(videos) {
  try {
    await ensureDataDir();
    await fs.writeFile(VIDEOS_FILE, JSON.stringify(videos, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error saving videos:', err);
    return false;
  }
}

// GET /api/videos - Ambil semua videos
app.get('/api/videos', async (req, res) => {
  try {
    const videos = await loadVideosFromFile();
    res.json({
      success: true,
      videos: videos
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error loading videos' });
  }
});

// POST /api/videos - Tambah video baru (ADMIN ONLY)
app.post('/api/videos', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1];
  
  // Verifikasi token
  if (!token) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // Cek apakah user adalah admin
    if (decoded.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Forbidden: Admin only' });
    }
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
  
  const { title, desc, videoId, thumb, duration } = req.body;
  
  // Validasi
  if (!title || !desc || !videoId || !thumb) {
    return res.status(400).json({ 
      success: false, 
      message: 'Missing required fields: title, desc, videoId, thumb' 
    });
  }
  
  try {
    const videos = await loadVideosFromFile();
    
    // Cek duplicate videoId
    if (videos.some(v => v.videoId === videoId)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Video dengan ID ini sudah ada' 
      });
    }
    
    // Create new video
    const newVideo = {
      id: Math.max(...videos.map(v => v.id || 0), 0) + 1,
      title,
      desc,
      videoId,
      thumb,
      duration: duration || '1h 30m',
      createdAt: new Date().toISOString()
    };
    
    videos.push(newVideo);
    
    // Save ke file
    const saved = await saveVideosToFile(videos);
    
    if (saved) {
      // Broadcast ke semua admin (SSE)
      broadcastVideoUpdate('add', newVideo);
      
      res.json({
        success: true,
        message: 'Video berhasil ditambahkan',
        video: newVideo
      });
    } else {
      res.status(500).json({ success: false, message: 'Error saving video' });
    }
  } catch (err) {
    console.error('Error adding video:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// DELETE /api/videos/:videoId - Hapus video (ADMIN ONLY)
app.delete('/api/videos/:videoId', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1];
  
  // Verifikasi token
  if (!token) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Forbidden: Admin only' });
    }
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
  
  const { videoId } = req.params;
  
  try {
    let videos = await loadVideosFromFile();
    const originalLength = videos.length;
    
    // Filter out video dengan videoId yang dicari
    videos = videos.filter(v => v.videoId !== videoId);
    
    if (videos.length === originalLength) {
      return res.status(404).json({ success: false, message: 'Video tidak ditemukan' });
    }
    
    // Save ke file
    const saved = await saveVideosToFile(videos);
    
    if (saved) {
      // Broadcast ke semua admin
      broadcastVideoUpdate('delete', { videoId });
      
      res.json({
        success: true,
        message: 'Video berhasil dihapus'
      });
    } else {
      res.status(500).json({ success: false, message: 'Error saving videos' });
    }
  } catch (err) {
    console.error('Error deleting video:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Function untuk broadcast video updates ke admin
function broadcastVideoUpdate(action, data) {
  const payload = JSON.stringify({ 
    type: 'video-update',
    action: action,
    data: data
  });
  
  for (const res of sseClients) {
    try {
      res.write(`data: ${payload}\n\n`);
    } catch {}
  }
}

// Initialize data directory on startup
ensureDataDir();

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
