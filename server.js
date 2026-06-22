require('dotenv').config();
const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const cors    = require('cors');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

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

// ===========================
// DATABASE PENGGUNA
// Akun Admin  → masuk ke dashboard admin
// Akun Viewer → masuk ke halaman menonton
// ===========================
const ACCOUNTS = [
  {
    email:    (process.env.ADMIN_EMAIL    || 'admin@layarbiru.com').toLowerCase(),
    password: process.env.ADMIN_PASSWORD  || 'Admin12345',
    name:     'Admin Layar Biru',
    initial:  'AL',
    role:     'admin'
  },
  {
    email:    'budi@layarbiru.com',
    password: 'Budi12345',
    name:     'Budi Santoso',
    initial:  'BS',
    role:     'viewer'
  },
  {
    email:    'rina@layarbiru.com',
    password: 'Rina12345',
    name:     'Rina Dewi',
    initial:  'RD',
    role:     'viewer'
  },
  {
    email:    'hendri@layarbiru.com',
    password: 'Hendri12345',
    name:     'Hendri Kurniawan',
    initial:  'HK',
    role:     'viewer'
  }
];

// Hash semua password saat server start
let accountsReady = false;
const hashedAccounts = [];

(async () => {
  for (const acc of ACCOUNTS) {
    const hashed = await bcrypt.hash(acc.password, 10);
    hashedAccounts.push({ ...acc, hashedPassword: hashed });
  }
  accountsReady = true;
  console.log(`✅ Server siap. ${ACCOUNTS.length} akun dimuat (1 admin, ${ACCOUNTS.length - 1} viewer).`);
})();

// ===========================
// REALTIME: ACTIVE SESSIONS STORE
// ===========================
const activeSessions = new Map(); // token → { user, startTime, film, camActive, lastPing }
const sseClients     = new Set(); // SSE connections (admin)

function broadcastSessions() {
  const payload = JSON.stringify({ type: 'sessions', data: getSessionsPayload() });
  for (const res of sseClients) {
    res.write(`data: ${payload}\n\n`);
  }
}

function getSessionsPayload() {
  const now = Date.now();
  return Array.from(activeSessions.values()).map(s => ({
    name:      s.user.name,
    initial:   s.user.initial,
    email:     s.user.email,
    film:      s.film,
    camActive: s.camActive,
    duration:  Math.floor((now - s.startTime) / 1000),
    startTime: s.startTime
  }));
}

// ===========================
// ROUTES
// ===========================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Layar Biru Backend berjalan ✅', accounts: ACCOUNTS.length });
});

// LOGIN endpoint
app.post('/api/login', async (req, res) => {
  if (!accountsReady) {
    return res.status(503).json({ success: false, code: 'SERVER_LOADING', message: 'Server sedang memuat. Coba lagi sebentar.' });
  }

  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, code: 'MISSING_FIELDS', message: 'Email dan password wajib diisi.' });
  }

  const account = hashedAccounts.find(a => a.email === email.toLowerCase().trim());
  if (!account) {
    return res.status(401).json({ success: false, code: 'EMAIL_NOT_FOUND', message: 'Akun dengan email ini tidak ditemukan.' });
  }

  const passwordMatch = await bcrypt.compare(password, account.hashedPassword);
  if (!passwordMatch) {
    return res.status(401).json({ success: false, code: 'WRONG_PASSWORD', message: 'Password salah. Silakan coba lagi.' });
  }

  // Buat JWT token
  const token = jwt.sign(
    { email: account.email, name: account.name, initial: account.initial, role: account.role },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  console.log(`[${new Date().toLocaleString('id-ID')}] Login berhasil: ${account.email} (${account.role})`);

  res.json({
    success: true,
    message: 'Login berhasil!',
    token,
    user: {
      name:    account.name,
      email:   account.email,
      initial: account.initial,
      role:    account.role
    }
  });
});

// VERIFY TOKEN
app.get('/api/verify', (req, res) => {
  const token = (req.headers['authorization'] || '').split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'Token tidak ada.' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ success: true, user: decoded });
  } catch {
    res.status(401).json({ success: false, message: 'Token tidak valid atau sudah expired.' });
  }
});

// SESSION START — viewer melapor mulai nonton
app.post('/api/session/start', (req, res) => {
  const token = (req.headers['authorization'] || '').split(' ')[1];
  if (!token) return res.status(401).json({ success: false });
  try {
    const user = jwt.verify(token, JWT_SECRET);
    if (user.role !== 'viewer') return res.status(403).json({ success: false });

    activeSessions.set(token, {
      user,
      startTime: Date.now(),
      film:      req.body.film || 'Film tidak diketahui',
      camActive: req.body.camActive !== false,
      lastPing:  Date.now()
    });

    broadcastSessions();
    console.log(`[${new Date().toLocaleString('id-ID')}] Sesi mulai: ${user.name}`);
    res.json({ success: true });
  } catch {
    res.status(401).json({ success: false });
  }
});

// SESSION PING — viewer kirim heartbeat setiap 5 detik
app.post('/api/session/ping', (req, res) => {
  const token = (req.headers['authorization'] || '').split(' ')[1];
  if (!token) return res.status(401).json({ success: false });
  const session = activeSessions.get(token);
  if (session) {
    session.lastPing  = Date.now();
    session.film      = req.body.film      || session.film;
    session.camActive = req.body.camActive !== undefined ? req.body.camActive : session.camActive;
    broadcastSessions();
  }
  res.json({ success: true });
});

// SESSION END / LOGOUT
app.post('/api/logout', (req, res) => {
  const token = (req.headers['authorization'] || '').split(' ')[1];
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      activeSessions.delete(token);
      broadcastSessions();
      console.log(`[${new Date().toLocaleString('id-ID')}] Logout: ${decoded.email}`);
    } catch {}
  }
  res.json({ success: true, message: 'Logout berhasil.' });
});

// GET SESSIONS (REST fallback untuk admin)
app.get('/api/sessions', (req, res) => {
  const token = (req.headers['authorization'] || '').split(' ')[1];
  if (!token) return res.status(401).json({ success: false });
  try {
    const user = jwt.verify(token, JWT_SECRET);
    if (user.role !== 'admin') return res.status(403).json({ success: false });
    res.json({ success: true, sessions: getSessionsPayload(), count: activeSessions.size });
  } catch {
    res.status(401).json({ success: false });
  }
});

// SSE — admin subscribe ke realtime session updates
app.get('/api/sessions/stream', (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(401).end();
  try {
    jwt.verify(token, JWT_SECRET); // verifikasi (bisa tambah cek role admin)
  } catch {
    return res.status(401).end();
  }

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  // Kirim data awal
  const initial = JSON.stringify({ type: 'sessions', data: getSessionsPayload() });
  res.write(`data: ${initial}\n\n`);

  // Daftarkan client
  sseClients.add(res);

  // Heartbeat agar koneksi tidak timeout
  const heartbeat = setInterval(() => {
    res.write(`: ping\n\n`);
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// ===========================
// CLEANUP SESSIONS YANG TIDAK AKTIF (> 30 detik tanpa ping)
// ===========================
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [token, session] of activeSessions) {
    if (now - session.lastPing > 30000) {
      console.log(`[${new Date().toLocaleString('id-ID')}] Sesi timeout: ${session.user.name}`);
      activeSessions.delete(token);
      changed = true;
    }
  }
  if (changed) broadcastSessions();
}, 10000);

// Fallback SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===========================
// START SERVER
// ===========================
app.listen(PORT, () => {
  console.log(`🎬 Layar Biru Backend berjalan di port ${PORT}`);
  console.log(`\n📋 Daftar Akun:`);
  ACCOUNTS.forEach(a => console.log(`  [${a.role.toUpperCase()}] ${a.email} / ${a.password}`));
  console.log('');
});
