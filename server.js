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
// "DATABASE" (1 akun hardcoded)
// Password di-hash dengan bcrypt supaya aman
// ===========================
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || 'filmbiru@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Filmbiru12345';
const JWT_SECRET     = process.env.JWT_SECRET     || 'layarbiru_secret_key_2024';

// Hash password saat server start
let hashedPassword;
(async () => {
  hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);
  console.log('✅ Server siap. Password ter-hash dengan bcrypt.');
})();

// Simulasi database user
const users = {
  [ADMIN_EMAIL]: {
    name: 'Film Biru',
    initial: 'FB',
    role: 'admin'
  }
};

// ===========================
// ROUTES
// ===========================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Layar Biru Backend berjalan ✅' });
});

// LOGIN endpoint
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  // Validasi input
  if (!email || !password) {
    return res.status(400).json({
      success: false,
      code: 'MISSING_FIELDS',
      message: 'Email dan password wajib diisi.'
    });
  }

  // Cek email (case-insensitive)
  if (email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    return res.status(401).json({
      success: false,
      code: 'EMAIL_NOT_FOUND',
      message: 'Akun dengan email ini tidak ditemukan.'
    });
  }

  // Cek password dengan bcrypt
  const passwordMatch = await bcrypt.compare(password, hashedPassword);
  if (!passwordMatch) {
    return res.status(401).json({
      success: false,
      code: 'WRONG_PASSWORD',
      message: 'Password salah. Silakan coba lagi.'
    });
  }

  // ✅ Login berhasil — buat JWT token
  const userData = users[ADMIN_EMAIL];
  const token = jwt.sign(
    { email: ADMIN_EMAIL, name: userData.name, role: userData.role },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  // Log ke server
  console.log(`[${new Date().toLocaleString('id-ID')}] Login berhasil: ${email}`);

  res.json({
    success: true,
    message: 'Login berhasil!',
    token,
    user: {
      name: userData.name,
      email: ADMIN_EMAIL,
      initial: userData.initial,
      role: userData.role
    }
  });
});

// VERIFY TOKEN endpoint (untuk cek sesi masih valid)
app.get('/api/verify', (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // "Bearer <token>"

  if (!token) {
    return res.status(401).json({ success: false, message: 'Token tidak ada.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ success: true, user: decoded });
  } catch (err) {
    res.status(401).json({ success: false, message: 'Token tidak valid atau sudah expired.' });
  }
});

// LOGOUT endpoint (client-side clear, tapi log ke server)
app.post('/api/logout', (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      console.log(`[${new Date().toLocaleString('id-ID')}] Logout: ${decoded.email}`);
    } catch {}
  }

  res.json({ success: true, message: 'Logout berhasil.' });
});

// Fallback — semua route lain serve index.html (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===========================
// START SERVER
// ===========================
app.listen(PORT, () => {
  console.log(`🎬 Layar Biru Backend berjalan di port ${PORT}`);
  console.log(`📧 Akun aktif: ${ADMIN_EMAIL}`);
});
