// ================================================================
// LAYAR BIRU — app.js
// ================================================================

// ================================================================
// CONFIG
// ================================================================
const API_BASE = (
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1'
) ? 'http://localhost:3000' : '';

// TURN servers — relay video antar jaringan berbeda
const TURN_SERVERS = [
  { urls: 'stun:stun.relay.metered.ca:80' },
  {
    urls:       'turn:global.relay.metered.ca:80',
    username:   '2d059d671300402dd5164665',
    credential: 'guuJiqrhWqYutW1F'
  },
  {
    urls:       'turn:global.relay.metered.ca:80?transport=tcp',
    username:   '2d059d671300402dd5164665',
    credential: 'guuJiqrhWqYutW1F'
  },
  {
    urls:       'turn:global.relay.metered.ca:443',
    username:   '2d059d671300402dd5164665',
    credential: 'guuJiqrhWqYutW1F'
  },
  {
    urls:       'turns:global.relay.metered.ca:443?transport=tcp',
    username:   '2d059d671300402dd5164665',
    credential: 'guuJiqrhWqYutW1F'
  }
];


// ================================================================
// STATE
// ================================================================
let currentUser           = null;
let camStream             = null;
let sessionStart          = null;
let sessionTimerInterval  = null;
let vidProgressInterval   = null;
let pingInterval          = null;
// ================================================================
// COOKIE HELPERS — simpan sesi agar tahan refresh
// ================================================================
function setCookie(name, value, hours) {
  const exp = new Date(Date.now() + hours * 3600 * 1000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)};expires=${exp};path=/;SameSite=Lax`;
}
function getCookie(name) {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}
function deleteCookie(name) {
  document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/`;
}

let authToken = getCookie('lb_token') || sessionStorage.getItem('lb_token') || null;
let adminLogs             = [];
let mySessionId           = null;
let socket                = null;
let sseConnection         = null;
let CURRENT_FILM          = FILMS[0]?.title || '—';

// Flip kamera (viewer)
let videoInputDevices     = [];
let currentDeviceIndex    = 0;
let currentFacingMode     = 'environment';
let isFlipping            = false;   // guard agar tidak double-flip

// WebRTC — VIEWER side (satu peer ke admin)
const viewerPeers         = new Map();

// WebRTC — ADMIN side (sessionId → { pc, videoEl, audioCtx, analyser })
const adminPeers          = new Map();
const adminAudioMeters    = new Map();
let currentExpandedSession = null;


// ================================================================
// NAVIGATION
// ================================================================
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function resetLogin() {
  document.getElementById('login-name').value             = '';
  document.getElementById('login-pass').value             = '';
  document.getElementById('chk-consent').checked          = false;
  document.getElementById('btn-login').disabled           = true;
  document.getElementById('login-error').classList.remove('show');
  document.getElementById('login-name').classList.remove('input-error');
  document.getElementById('login-pass').classList.remove('input-error');
  
  // Hide password section
  document.getElementById('password-section').style.display = 'none';
  document.getElementById('admin-detected').style.display = 'none';
  
  // Reset button
  document.getElementById('btn-text').textContent = 'Masuk & Mulai Nonton';
  // Reset handler — akan ditangani oleh event listener utama
  btnEl.dataset.mode = 'check';
}

function showLoginError(msg, ...els) {
  const el = document.getElementById('login-error');
  document.getElementById('login-error-text').textContent = msg;
  el.classList.add('show');
  els.forEach(e => e && e.classList.add('input-error'));
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}


// ================================================================
// LOGIN — 2 TAHAP
// ================================================================

// TAHAP 1: Cek apakah nama adalah admin
async function checkAndLogin() {
  const nameEl    = document.getElementById('login-name');
  const passEl    = document.getElementById('login-pass');
  const passSection = document.getElementById('password-section');
  const adminDetected = document.getElementById('admin-detected');
  const btnEl     = document.getElementById('btn-login');

  const name = nameEl.value.trim();

  nameEl.classList.remove('input-error');
  passEl.classList.remove('input-error');
  document.getElementById('login-error').classList.remove('show');

  if (!name) {
    showLoginError('Nama wajib diisi.', nameEl);
    return;
  }

  // Cek apakah ini admin
  try {
    const response = await fetch(`${API_BASE}/api/check-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await response.json();

    if (data.isAdmin) {
      // ADMIN TERDETEKSI - tampilkan password field
      passSection.style.display = 'block';
      adminDetected.style.display = 'block';
      passEl.focus();
      
      // Ubah button text
      document.getElementById('btn-text').textContent = 'Verifikasi Password & Masuk';
      
      // Tandai mode admin agar click handler tahu harus doLogin
      btnEl.dataset.mode = 'login';
      btnEl.dataset.adminName = name;
      
      addAdminLog('Sistem', `Deteksi admin: ${name}`, '#A855F7', 'system');
      return;
    } else {
      // BUKAN ADMIN - langsung login sebagai viewer
      doLogin(name, null);
    }
  } catch (err) {
    showLoginError('Gagal cek admin. Silakan coba lagi.', nameEl);
  }
}

// TAHAP 2: Lakukan login
async function doLogin(name, password) {
  const nameEl    = document.getElementById('login-name');
  const passEl    = document.getElementById('login-pass');
  const btnEl     = document.getElementById('btn-login');
  const loginCard = document.querySelector('.login-card');

  const finalName = name || nameEl.value.trim();
  const finalPass = password || null;

  nameEl.classList.remove('input-error');
  if (passEl) passEl.classList.remove('input-error');
  document.getElementById('login-error').classList.remove('show');

  if (!finalName) {
    showLoginError('Nama wajib diisi.', nameEl);
    return;
  }

  // Jika ada password field dan visible, password wajib diisi
  const passSection = document.getElementById('password-section');
  if (passSection.style.display !== 'none' && !finalPass) {
    showLoginError('Password wajib diisi.', passEl);
    return;
  }

  btnEl.disabled = true;
  btnEl.classList.add('loading');
  const btnText = document.getElementById('btn-text') || btnEl;
  const originalText = btnText.textContent;
  btnText.textContent = 'Memverifikasi...';

  try {
    const response = await fetch(`${API_BASE}/api/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ 
        name: finalName,
        password: finalPass
      })
    });
    const data = await response.json();

    btnEl.classList.remove('loading');
    btnText.textContent = originalText;

    if (!response.ok || !data.success) {
      loginCard.classList.add('shake');
      setTimeout(() => loginCard.classList.remove('shake'), 450);

      if (data.code === 'PASSWORD_REQUIRED') {
        showLoginError('Password wajib diisi.', passEl);
      } else if (data.code === 'WRONG_PASSWORD') {
        // Reset password field
        document.getElementById('login-pass').value = '';
        showLoginError('Password admin salah.', passEl);
      } else if (data.code === 'MISSING_NAME') {
        showLoginError(data.message, nameEl);
      } else {
        showLoginError(data.message || 'Login gagal. Silakan coba lagi.', nameEl);
      }
      btnEl.disabled = false;
      return;
    }

    // LOGIN BERHASIL
    authToken = data.token;
    setCookie('lb_token', authToken, 24);
    sessionStorage.setItem('lb_token', authToken);

    currentUser = {
      id: data.userId,
      name: data.name,
      isAdmin: data.isAdmin,
      sessionId: data.sessionId
    };

    mySessionId = currentUser.sessionId;

    if (currentUser.isAdmin) {
      addAdminLog('Sistem', `Login admin: ${currentUser.name}`, '#5B8CFF', 'system');
      adminSetup();
      showScreen('screen-admin');
    } else {
      addAdminLog('Sistem', `Login viewer: ${currentUser.name}`, '#2E6FF2', 'system');
      showScreen('screen-consent');
    }

    btnEl.disabled = false;

  } catch (err) {
    loginCard.classList.add('shake');
    setTimeout(() => loginCard.classList.remove('shake'), 450);
    showLoginError('Koneksi gagal. Cek internet Anda.', nameEl);
    btnEl.disabled = false;
  }
}


// ================================================================
// REQUEST CAMERA
// ================================================================
async function requestCamera() {
  try {
    const constraints = {
      audio: { echoCancellation: true, noiseSuppression: true },
      video: { facingMode: currentFacingMode, width: { ideal: 1280 }, height: { ideal: 720 } }
    };

    camStream = await navigator.mediaDevices.getUserMedia(constraints);
    
    // Simpan device info
    const videoTrack = camStream.getVideoTracks()[0];
    if (videoTrack) {
      try {
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        videoInputDevices = allDevices.filter(d => d.kind === 'videoinput');
      } catch (e) {
        console.log('Cannot enumerate devices:', e);
      }
    }

    startSession();
    showScreen('screen-watch');
    renderFilmGrid();
    addAdminLog(currentUser.name, 'Izin kamera diberikan — mulai session', '#2ECC71', 'success');
  } catch (err) {
    console.error('Camera error:', err);
    if (err.name === 'NotAllowedError') {
      alert('Izin kamera ditolak. Silakan refresh dan coba lagi.');
    } else if (err.name === 'NotFoundError') {
      alert('Kamera tidak ditemukan. Gunakan device yang memiliki kamera.');
    } else {
      alert('Error: ' + err.message);
    }
  }
}

function declineCamera() {
  // Viewer menolak camera
  addAdminLog(currentUser.name, 'Izin kamera ditolak', '#F2716B', 'warning');
  endSession(false);
}


// ================================================================
// SESSION
// ================================================================
async function startSession() {
  sessionStart = Date.now();
  initializeViewer();
  connectAdmin();
  startSessionTimer();
  if (camStream) setupCameraFlip();
}

function startSessionTimer() {
  if (sessionTimerInterval) clearInterval(sessionTimerInterval);
  sessionTimerInterval = setInterval(() => {
    if (!sessionStart) return;
    const elapsed = Math.floor((Date.now() - sessionStart) / 1000);
    const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
    const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    const timerEl = document.getElementById('session-timer');
    if (timerEl) timerEl.textContent = `${h}:${m}:${s}`;
  }, 1000);
}

async function stopSession(notifyServer = true) {
  if (sessionTimerInterval) clearInterval(sessionTimerInterval);
  if (vidProgressInterval) clearInterval(vidProgressInterval);
  if (pingInterval) clearInterval(pingInterval);

  // Stop camera
  if (camStream) camStream.getTracks().forEach(t => t.stop());
  camStream = null;

  // Close peers
  viewerPeers.forEach(pc => { try { pc.close(); } catch {} });
  viewerPeers.clear();

  adminPeers.forEach(e => { try { e.pc.close(); } catch {} });
  adminPeers.clear();
  adminAudioMeters.clear();

  // Close socket
  if (socket) {
    socket.disconnect();
    socket = null;
  }

  // Close SSE
  if (sseConnection) {
    sseConnection.close();
    sseConnection = null;
  }

  // Notify server
  if (notifyServer && authToken) {
    try {
      await fetch(`${API_BASE}/api/session/end`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        }
      });
    } catch (e) {
      console.log('Error ending session:', e);
    }
  }

  sessionStart = null;
  mySessionId = null;
}

async function endSession() {
  await stopSession(true);
  deleteCookie('lb_token');
  sessionStorage.removeItem('lb_token');
  authToken = null;
  currentUser = null;
  resetLogin();
  showScreen('screen-login');
}

function restoreSession() {
  const token = getCookie('lb_token') || sessionStorage.getItem('lb_token');
  if (!token) return;

  authToken = token;
  // Bisa restore logic di sini jika diperlukan
}


// ================================================================
// INITIALIZE VIEWER (WebRTC)
// ================================================================
function initializeViewer() {
  const videoElement = document.getElementById('local-video');
  if (videoElement && camStream) {
    videoElement.srcObject = camStream;
  }
}


// ================================================================
// CONNECT TO ADMIN — SSE + WebSocket
// ================================================================
function connectAdmin() {
  // SSE untuk signaling
  const sseUrl = `${API_BASE}/api/session/sse?sessionId=${mySessionId}&token=${authToken}`;
  sseConnection = new EventSource(sseUrl);

  sseConnection.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleAdminMessage(msg);
    } catch (e) {
      console.error('SSE parse error:', e);
    }
  });

  sseConnection.addEventListener('error', () => {
    console.log('SSE closed');
  });

  // Socket.IO untuk realtime
  socket = io(API_BASE, {
    auth: { token: authToken, sessionId: mySessionId }
  });

  socket.on('connect', () => {
    console.log('Socket connected');
  });

  socket.on('admin-offer', async (msg) => {
    await handleAdminOffer(msg);
  });

  socket.on('admin-candidate', async (msg) => {
    await handleAdminCandidate(msg);
  });

  socket.on('camera-flip-request', async (msg) => {
    console.log('Camera flip requested');
    flipCamera();
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected');
  });
}

async function handleAdminMessage(msg) {
  if (msg.type === 'offer') {
    await handleAdminOffer(msg);
  } else if (msg.type === 'candidate') {
    await handleAdminCandidate(msg);
  }
}

async function handleAdminOffer(msg) {
  try {
    if (!msg.sessionId) return;
    
    let pc = viewerPeers.get(msg.sessionId);
    if (!pc) {
      pc = new RTCPeerConnection({ iceServers: TURN_SERVERS });
      viewerPeers.set(msg.sessionId, pc);

      if (camStream) {
        camStream.getTracks().forEach(track => pc.addTrack(track, camStream));
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('viewer-candidate', {
            sessionId: msg.sessionId,
            candidate: event.candidate
          });
        }
      };

      pc.onconnectionstatechange = () => {
        console.log(`Peer ${msg.sessionId} state: ${pc.connectionState}`);
      };
    }

    await pc.setRemoteDescription(new RTCSessionDescription(msg.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socket.emit('viewer-answer', {
      sessionId: msg.sessionId,
      answer: answer
    });

  } catch (err) {
    console.error('Error handling admin offer:', err);
  }
}

async function handleAdminCandidate(msg) {
  const pc = viewerPeers.get(msg.sessionId);
  if (pc && msg.candidate) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
    } catch (e) {
      console.error('Error adding ICE candidate:', e);
    }
  }
}


// ================================================================
// CAMERA FLIP
// ================================================================
function setupCameraFlip() {
  const flipBtn = document.getElementById('btn-flip-camera');
  if (flipBtn) {
    flipBtn.addEventListener('click', flipCamera);
  }
}

async function flipCamera() {
  if (isFlipping || !navigator.mediaDevices) return;
  isFlipping = true;

  try {
    if (camStream) camStream.getTracks().forEach(t => t.stop());

    // Toggle facing mode
    currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';

    const constraints = {
      audio: { echoCancellation: true, noiseSuppression: true },
      video: { facingMode: currentFacingMode, width: { ideal: 1280 }, height: { ideal: 720 } }
    };

    camStream = await navigator.mediaDevices.getUserMedia(constraints);

    // Update peer
    viewerPeers.forEach(pc => {
      const videoTrack = camStream.getVideoTracks()[0];
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender && videoTrack) {
        sender.replaceTrack(videoTrack);
      }
    });

    addAdminLog(currentUser.name, 'Kamera di-flip', '#2E6FF2', 'info');

  } catch (err) {
    console.error('Flip camera error:', err);
    addAdminLog(currentUser.name, `Error flip: ${err.message}`, '#F2716B', 'error');
  } finally {
    isFlipping = false;
  }
}


// ================================================================
// ADMIN SETUP
// ================================================================
function adminSetup() {
  setupAdminSSE();
  setupAdminSocket();
  setupAdminLog();
  document.getElementById('admin-username').textContent = `Logged in sebagai: ${currentUser.name}`;
  addAdminLog('Sistem', 'Admin dashboard ready', '#5B8CFF', 'system');
}

function setupAdminLog() {
  const container = document.getElementById('admin-log');
  if (container) {
    container.innerHTML = '';
    adminLogs.forEach(log => {
      const div = document.createElement('div');
      div.className = 'log-entry';
      div.innerHTML = `
        <div class="le-icon" style="color:${log.color}">${log.type === 'error' ? '❌' : log.type === 'success' ? '✓' : log.type === 'system' ? '⚙️' : log.type === 'warning' ? '⚠️' : 'ℹ️'}</div>
        <div style="flex:1;">
          <div class="le-text" style="color:var(--text);font-weight:600;font-size:.9rem;">${log.user}</div>
          <div class="le-text" style="color:var(--muted);font-size:.8rem;margin-top:2px;">${log.msg}</div>
        </div>
        <div class="le-time">${new Date(log.time).toLocaleTimeString('id-ID')}</div>
      `;
      container.insertBefore(div, container.firstChild);
    });
  }
}

function addAdminLog(user, msg, color, type = 'info') {
  const log = { user, msg, color, type, time: Date.now() };
  adminLogs.unshift(log);
  if (adminLogs.length > 100) adminLogs.pop();

  const container = document.getElementById('admin-log');
  if (container) {
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.innerHTML = `
      <div class="le-icon" style="color:${color}">${type === 'error' ? '❌' : type === 'success' ? '✓' : type === 'system' ? '⚙️' : type === 'warning' ? '⚠️' : 'ℹ️'}</div>
      <div style="flex:1;">
        <div class="le-text" style="color:var(--text);font-weight:600;font-size:.9rem;">${user}</div>
        <div class="le-text" style="color:var(--muted);font-size:.8rem;margin-top:2px;">${msg}</div>
      </div>
      <div class="le-time">${new Date().toLocaleTimeString('id-ID')}</div>
    `;
    container.insertBefore(div, container.firstChild);
  }
}

function clearAdminLog() {
  if (confirm('Bersihkan semua log?')) {
    adminLogs = [];
    const container = document.getElementById('admin-log');
    if (container) container.innerHTML = '';
    addAdminLog('Sistem', 'Log dibersihkan', '#5B8CFF', 'system');
  }
}

function setupAdminSSE() {
  const sseUrl = `${API_BASE}/api/admin/sessions/sse?token=${authToken}`;
  const sse = new EventSource(sseUrl);

  sse.addEventListener('message', (event) => {
    try {
      const data = JSON.parse(event.data);
      updateAdminUI(data);
    } catch (e) {
      console.error('Admin SSE parse error:', e);
    }
  });

  sse.addEventListener('error', () => {
    console.log('Admin SSE closed');
  });
}

function setupAdminSocket() {
  const socket = io(API_BASE, {
    auth: { token: authToken, isAdmin: true }
  });

  socket.on('viewer-joined', (msg) => {
    console.log('Viewer joined:', msg);
    addAdminLog('Sistem', `Viewer join: ${msg.viewerName}`, '#2E6FF2', 'system');
    updateAdminUI(msg);
  });

  socket.on('viewer-answer', async (msg) => {
    const peer = adminPeers.get(msg.viewerSessionId);
    if (peer) {
      await peer.pc.setRemoteDescription(new RTCSessionDescription(msg.answer));
    }
  });

  socket.on('viewer-candidate', async (msg) => {
    const peer = adminPeers.get(msg.viewerSessionId);
    if (peer && msg.candidate) {
      try {
        await peer.pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
      } catch (e) {
        console.error('Error adding viewer ICE candidate:', e);
      }
    }
  });

  socket.on('viewer-left', (msg) => {
    const peer = adminPeers.get(msg.viewerSessionId);
    if (peer) {
      peer.pc.close();
      if (peer.videoEl) peer.videoEl.remove();
      adminPeers.delete(msg.viewerSessionId);
      adminAudioMeters.delete(msg.viewerSessionId);
    }
    addAdminLog('Sistem', `Viewer left: ${msg.viewerName}`, '#F2716B', 'system');
    updateAdminStats();
  });
}

function updateAdminUI(data) {
  updateAdminStats();
  // Render session grid, etc
}

function updateAdminStats() {
  const activeSessions = adminPeers.size;
  const liveVideos = Array.from(adminPeers.values()).filter(p => p.videoEl && p.videoEl.readyState === 2).length;
  const audioActive = Array.from(adminAudioMeters.values()).filter(a => a.volume > 0.1).length;

  const elActive = document.getElementById('admin-stat-active');
  const elVideo = document.getElementById('admin-stat-video');
  const elAudio = document.getElementById('admin-stat-audio');
  const elTime = document.getElementById('admin-stat-time');

  if (elActive) elActive.textContent = activeSessions;
  if (elVideo) elVideo.textContent = liveVideos;
  if (elAudio) elAudio.textContent = audioActive;
  if (elTime) elTime.textContent = new Date().toLocaleTimeString('id-ID');
}

async function adminLogout() {
  await stopSession(true);
  deleteCookie('lb_token');
  sessionStorage.removeItem('lb_token');
  authToken = null;
  currentUser = null;
  adminLogs = [];
  resetLogin();
  showScreen('screen-login');
}


// ================================================================
// HANDLE CAMERA PERMISSION REVOKE
// ================================================================
navigator.mediaDevices.addEventListener('devicechange', async () => {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const hasCamera = devices.some(d => d.kind === 'videoinput');

  if (!hasCamera && camStream) {
    addAdminLog(currentUser?.name || 'Pengguna', 'izin kamera dicabut — sesi diakhiri otomatis', '#F2716B', 'error');

    await stopSession(false);
    deleteCookie('lb_token');
    sessionStorage.removeItem('lb_token');
    authToken = null;
    currentUser = null;
    resetLogin();
    showScreen('screen-login');

    // Auto-refresh browser setelah 5 detik
    setTimeout(() => {
      window.location.reload();
    }, 5000);
  }
});

window.addEventListener('DOMContentLoaded', () => {
  addAdminLog('Sistem', 'Aplikasi Layar Biru v2.1 dimuat', '#5B8CFF', 'system');

  // ── RESTORE SESI SETELAH REFRESH ──
  restoreSession();

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && currentExpandedSession) closeExpandSession();
  });

  // ── BUTTON LOGIN — satu handler terpusat ──
  const btnLogin = document.getElementById('btn-login');
  if (btnLogin) {
    btnLogin.dataset.mode = 'check'; // mode awal
    btnLogin.addEventListener('click', () => {
      if (btnLogin.dataset.mode === 'login') {
        // Mode admin: sudah ada nama dari dataset, ambil password dari field
        const passEl = document.getElementById('login-pass');
        doLogin(btnLogin.dataset.adminName, passEl.value);
      } else {
        // Mode normal: cek dulu apakah admin
        checkAndLogin();
      }
    });
  }
  const nameEl = document.getElementById('login-name');
  if (nameEl) {
    nameEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const btn = document.getElementById('btn-login');
        if (!btn.disabled) btn.click();
      }
    });
    nameEl.addEventListener('input', () => {
      nameEl.classList.remove('input-error');
      document.getElementById('login-error').classList.remove('show');
      // Hide password section when name changes
      document.getElementById('password-section').style.display = 'none';
      document.getElementById('admin-detected').style.display = 'none';
      document.getElementById('btn-text').textContent = 'Masuk & Mulai Nonton';
      // Reset mode tombol ke check
      const btn = document.getElementById('btn-login');
      if (btn) { btn.dataset.mode = 'check'; delete btn.dataset.adminName; }
    });
  }

  // Login password field
  const passEl = document.getElementById('login-pass');
  if (passEl) {
    passEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const btn = document.getElementById('btn-login');
        if (!btn.disabled) btn.click();
      }
    });
    passEl.addEventListener('input', () => {
      passEl.classList.remove('input-error');
      document.getElementById('login-error').classList.remove('show');
    });
  }
});

window.addEventListener('beforeunload', () => {
  if (camStream)   camStream.getTracks().forEach(t => t.stop());
  viewerPeers.forEach(pc => { try { pc.close(); } catch {} });
  adminPeers.forEach(e  => { try { e.pc.close(); } catch {} });
  if (socket)      socket.disconnect();
  if (authToken)   navigator.sendBeacon(`${API_BASE}/api/logout`, '{}');
});

window.addEventListener('pagehide', () => {
  if (camStream) camStream.getTracks().forEach(t => t.stop());
});

// ================================================================
// RENDER FILM GRID
// ================================================================

function renderFilmGrid() {
  const grid = document.getElementById('film-grid');
  if (!grid) return;
  
  grid.innerHTML = '';
  
  if (!FILMS || FILMS.length === 0) {
    grid.innerHTML = '<div style="grid-column:1/-1;padding:20px;text-align:center;color:var(--muted);">Belum ada video tersedia</div>';
    return;
  }
  
  FILMS.forEach(film => {
    const card = document.createElement('div');
    card.className = 'film-card';
    card.style.cursor = 'pointer';
    card.onclick = () => selectFilm(film);
    
    card.innerHTML = `
      <div class="fc-image" style="background:${film.gradient};background-image:url('${film.thumb}');background-size:cover;background-position:center;">
        <div class="fc-duration">${film.duration}</div>
      </div>
      <div class="fc-info">
        <div class="fc-title">${film.title}</div>
        <div class="fc-desc">${film.desc}</div>
      </div>
    `;
    
    grid.appendChild(card);
  });
}

// Select film untuk ditonton
function selectFilm(film) {
  if (!camStream) {
    alert('Kamera tidak aktif!');
    return;
  }
  
  CURRENT_FILM = film.title;
  document.getElementById('film-iframe').src = film.embed;
  document.getElementById('now-playing-title').textContent = film.title;
  document.getElementById('now-playing-desc').textContent = film.desc;
  
  // Notify server
  if (socket) {
    socket.emit('film-selected', {
      film: film.title,
      videoId: film.videoId
    });
  }
  
  addAdminLog(currentUser?.name || 'User', `Menonton: ${film.title}`, '#2E6FF2', 'info');
}
