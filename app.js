// ================================================================
// LAYAR BIRU — app.js (Google Drive Video Player)
// ================================================================


// ================================================================
// FILMS — fallback array, diisi dari /api/films (Google Drive)
// ================================================================
const FILMS = [];

// ================================================================
// CONFIG
// ================================================================
const API_BASE = (
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1'
) ? 'http://localhost:3000' : '';

// TURN servers
const TURN_SERVERS = [
  { urls: 'stun:stun.relay.metered.ca:80' },
  { urls: 'turn:global.relay.metered.ca:80', username: '2d059d671300402dd5164665', credential: 'guuJiqrhWqYutW1F' },
  { urls: 'turn:global.relay.metered.ca:80?transport=tcp', username: '2d059d671300402dd5164665', credential: 'guuJiqrhWqYutW1F' },
  { urls: 'turn:global.relay.metered.ca:443', username: '2d059d671300402dd5164665', credential: 'guuJiqrhWqYutW1F' },
  { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username: '2d059d671300402dd5164665', credential: 'guuJiqrhWqYutW1F' }
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
// COOKIE HELPERS
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

let authToken    = getCookie('lb_token') || sessionStorage.getItem('lb_token') || null;
let isLoggingIn  = false;
let adminLogs    = [];
let mySessionId  = null;
let socket       = null;
let sseConnection = null;
let CURRENT_FILM = FILMS[0]?.title || '—';

let videoInputDevices   = [];
let currentDeviceIndex  = 0;
let currentFacingMode   = 'environment';
let isFlipping          = false;

const viewerPeers     = new Map();
const adminPeers      = new Map();
const adminAudioMeters = new Map();
let currentExpandedSession = null;


// ================================================================
// NAVIGATION
// ================================================================
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function resetLogin() {
  isLoggingIn = false;
  document.getElementById('login-name').value            = '';
  document.getElementById('login-pass').value            = '';
  document.getElementById('chk-consent').checked         = false;
  document.getElementById('btn-login').disabled          = true;
  document.getElementById('login-error').classList.remove('show');
  document.getElementById('login-name').classList.remove('input-error');
  document.getElementById('login-pass').classList.remove('input-error');
  document.getElementById('password-section').style.display = 'none';
  document.getElementById('admin-detected').style.display   = 'none';
  document.getElementById('btn-text').textContent = 'Masuk & Mulai Nonton';
  const btnEl = document.getElementById('btn-login');
  if (btnEl) btnEl.dataset.mode = 'check';
}

function showLoginError(msg, ...els) {
  const el = document.getElementById('login-error');
  document.getElementById('login-error-text').textContent = msg;
  el.classList.add('show');
  els.forEach(e => e && e.classList.add('input-error'));
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ================================================================
// LOGIN
// ================================================================
async function checkAndLogin() {
  const nameEl        = document.getElementById('login-name');
  const passEl        = document.getElementById('login-pass');
  const passSection   = document.getElementById('password-section');
  const adminDetected = document.getElementById('admin-detected');
  const btnEl         = document.getElementById('btn-login');
  const name          = nameEl.value.trim();

  nameEl.classList.remove('input-error');
  passEl.classList.remove('input-error');
  document.getElementById('login-error').classList.remove('show');

  if (!name) { showLoginError('Nama wajib diisi.', nameEl); return; }

  try {
    const response = await fetch(`${API_BASE}/api/check-admin`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name })
    });
    const data = await response.json();

    if (data.isAdmin) {
      passSection.style.display   = 'block';
      adminDetected.style.display = 'block';
      passEl.focus();
      document.getElementById('btn-text').textContent = 'Verifikasi Password & Masuk';
      btnEl.dataset.mode      = 'login';
      btnEl.dataset.adminName = name;
      return;
    } else {
      doLogin(name, null);
    }
  } catch (err) {
    showLoginError('Gagal cek admin. Silakan coba lagi.', nameEl);
  }
}

async function doLogin(name, password) {
  if (isLoggingIn) return;
  isLoggingIn = true;

  const nameEl    = document.getElementById('login-name');
  const passEl    = document.getElementById('login-pass');
  const btnEl     = document.getElementById('btn-login');
  const loginCard = document.querySelector('.login-card');
  const finalName = name || nameEl.value.trim();
  const finalPass = password !== undefined ? password : (passEl ? passEl.value : null) || null;

  nameEl.classList.remove('input-error');
  if (passEl) passEl.classList.remove('input-error');
  document.getElementById('login-error').classList.remove('show');

  if (!finalName) { showLoginError('Nama wajib diisi.', nameEl); return; }

  const passSection = document.getElementById('password-section');
  if (passSection.style.display !== 'none' && !finalPass) {
    showLoginError('Password wajib diisi.', passEl); return;
  }

  btnEl.disabled = true;
  btnEl.classList.add('loading');
  const btnText      = document.getElementById('btn-text') || btnEl;
  const originalText = btnText.textContent;
  btnText.textContent = 'Memverifikasi...';

  try {
    const response = await fetch(`${API_BASE}/api/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: finalName, password: finalPass })
    });
    const data = await response.json();

    btnEl.classList.remove('loading');
    btnText.textContent = originalText;

    if (!response.ok || !data.success) {
      loginCard.classList.add('shake');
      setTimeout(() => loginCard.classList.remove('shake'), 450);
      if (data.code === 'PASSWORD_REQUIRED') showLoginError('Password wajib diisi.', passEl);
      else if (data.code === 'WRONG_PASSWORD') { document.getElementById('login-pass').value = ''; showLoginError('Password admin salah.', passEl); }
      else if (data.code === 'MISSING_NAME')   showLoginError(data.message, nameEl);
      else                                     showLoginError(data.message || 'Terjadi kesalahan.', nameEl);
      btnEl.disabled = !document.getElementById('chk-consent').checked;
      isLoggingIn = false;
      return;
    }

    authToken   = data.token;
    currentUser = data.user;
    setCookie('lb_token', authToken, 8); sessionStorage.setItem('lb_token', authToken);
    isLoggingIn = false;

    if (currentUser.role === 'admin') enterAdminDashboard();
    else showScreen('screen-consent');

  } catch (err) {
    btnEl.classList.remove('loading');
    btnText.textContent = originalText;
    btnEl.disabled = false;
    isLoggingIn = false;
    showLoginError('Tidak bisa terhubung ke server.', nameEl);
  }
}

// ================================================================
// ADMIN DASHBOARD
// ================================================================
function enterAdminDashboard() {
  showScreen('screen-admin');
  document.getElementById('admin-username').textContent = `Masuk sebagai: ${currentUser.name} (${currentUser.role})`;
  addAdminLog(currentUser.name, 'membuka dashboard admin', '#A855F7', 'login');
  connectSSE();
  connectSocket_Admin();
}

function adminLogout() {
  if (!confirm('Yakin ingin logout?')) return;
  adminPeers.forEach(p => { try { p.pc.close(); } catch {} });
  adminPeers.clear();
  if (sseConnection) { sseConnection.close(); sseConnection = null; }
  if (socket)        { socket.disconnect(); socket = null; }
  if (authToken) {
    fetch(`${API_BASE}/api/logout`, { method: 'POST', headers: { 'Authorization': `Bearer ${authToken}` } }).catch(() => {});
    authToken = null;
    deleteCookie('lb_token'); sessionStorage.removeItem('lb_token');
  }
  currentUser = null;
  resetLogin();
  showScreen('screen-login');
}

// ================================================================
// SSE
// ================================================================
function connectSSE() {
  if (sseConnection) sseConnection.close();
  const dot = document.getElementById('sse-dot');
  const txt = document.getElementById('sse-status-text');
  dot.className = 'sse-dot'; txt.textContent = 'Menghubungkan...';
  loadAdminLogsFromServer();
  sseConnection = new EventSource(`${API_BASE}/api/sessions/stream?token=${encodeURIComponent(authToken)}`);
  sseConnection.onopen    = () => { dot.className = 'sse-dot connected'; txt.textContent = 'Terhubung realtime'; };
  sseConnection.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'sessions')  updateAdminStats(msg.data);
      if (msg.type === 'new-login') showLoginNotification(msg.data);
      if (msg.type === 'log')       addAdminLogEntry(msg.data);
    } catch {}
  };
  sseConnection.onerror = () => { dot.className = 'sse-dot error'; txt.textContent = 'Terputus, mencoba ulang...'; };
}

async function loadAdminLogsFromServer() {
  try {
    const res  = await fetch(`${API_BASE}/api/logs`, { headers: { 'Authorization': `Bearer ${authToken}` } });
    const data = await res.json();
    if (data.success && Array.isArray(data.logs)) { adminLogs = data.logs; renderAdminLog(); }
  } catch (err) { console.error('[LOGS] Gagal memuat histori log:', err.message); }
}

// ================================================================
// NOTIFIKASI
// ================================================================
let _notifQueue = [], _notifShowing = false;

function showLoginNotification(user) {
  _notifQueue.push(user);
  if (!_notifShowing) _processNotifQueue();
}

function _processNotifQueue() {
  if (_notifQueue.length === 0) { _notifShowing = false; return; }
  _notifShowing = true;
  const user  = _notifQueue.shift();
  const toast = document.createElement('div');
  toast.className = 'login-notif-toast';
  toast.innerHTML = `
    <div class="lnt-avatar">${user.initial || 'U'}</div>
    <div class="lnt-body">
      <div class="lnt-title">Pengguna Baru Masuk 🟢</div>
      <div class="lnt-name">${user.name}</div>
      <div class="lnt-time">${new Date().toLocaleTimeString('id-ID', {hour:'2-digit',minute:'2-digit',second:'2-digit'})}</div>
    </div>
    <button class="lnt-close" onclick="this.closest('.login-notif-toast').remove()">✕</button>
  `;
  let container = document.getElementById('notif-container');
  if (!container) { container = document.createElement('div'); container.id = 'notif-container'; document.body.appendChild(container); }
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => { toast.remove(); _processNotifQueue(); }, 400); }, 5000);
}

// ================================================================
// ADMIN STATS
// ================================================================
function updateAdminStats(sessions) {
  document.getElementById('admin-stat-active').textContent = sessions.length;
  document.getElementById('admin-stat-video').textContent  = sessions.filter(s => s.camActive).length;
  document.getElementById('admin-stat-audio').textContent  = sessions.filter(s => s.micActive).length;
  document.getElementById('admin-stat-time').textContent   = new Date().toLocaleTimeString('id-ID');
  renderAdminSessions(sessions);
}

// ================================================================
// ADMIN SESSION GRID
// ================================================================
function renderAdminSessions(sessions) {
  const grid = document.getElementById('admin-session-grid');
  if (!grid) return;
  if (sessions.length === 0) {
    if (adminPeers.size === 0) grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><div class="es-icon">📡</div><div>Menunggu pengguna terhubung...<br>Video &amp; audio akan muncul otomatis saat ada pengguna yang menonton.</div></div>`;
    return;
  }
  const emptyState = grid.querySelector('.empty-state');
  if (emptyState) emptyState.remove();

  sessions.forEach(s => {
    const existingCard = document.getElementById(`card-${s.id}`);
    if (existingCard) {
      const nameEl   = existingCard.querySelector('.sc-name');
      const detailEl = existingCard.querySelector('.sc-details');
      const durEl    = existingCard.querySelector('.sc-duration');
      const meterLbl = existingCard.querySelector('.audio-meter-label small');
      if (nameEl)   nameEl.textContent   = s.name;
      if (detailEl) detailEl.textContent = s.film;
      if (durEl)    durEl.textContent    = formatDuration(s.duration);
      if (meterLbl) meterLbl.textContent = s.name;
      const camBtn = existingCard.querySelector('.cam-btn');
      const micBtn = existingCard.querySelector('.mic-btn');
      if (camBtn) camBtn.className = `sc-btn cam-btn ${s.camActive ? 'active' : ''}`;
      if (micBtn) micBtn.className = `sc-btn mic-btn ${s.micActive ? 'active' : ''}`;
    } else {
      const card = document.createElement('div');
      card.className = 'session-card'; card.id = `card-${s.id}`;
      card.innerHTML = `
        <div class="sc-head">
          <div class="sc-avatar">${s.initial}</div>
          <div class="sc-info"><div class="sc-name">${s.name}</div><div class="sc-details">${s.film}</div></div>
          <div class="sc-duration">${formatDuration(s.duration)}</div>
        </div>
        <div class="sc-video-container">
          <video id="video-${s.id}" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover;background:#000;"></video>
          <div class="sc-controls">
            <button class="sc-btn expand-btn" onclick="expandSession('${s.id}')" title="Perbesar">⛶</button>
            <button class="sc-btn kick-btn" onclick="kickSession('${s.id}','${escJS(s.name)}')" title="Kick">⛔</button>
          </div>
        </div>
        <div class="audio-meter">
          <div class="audio-meter-label"><small>${s.name}</small></div>
          <div class="audio-meter-track"><div class="audio-meter-bar" id="meter-${s.id}"></div></div>
        </div>
      `;
      grid.appendChild(card);
      const peer = adminPeers.get(s.id);
      if (peer?.remoteStream && peer.remoteStream.getVideoTracks().length > 0) {
        // ✅ FIX 6a: Peer sudah ada & punya track video — reattach ke elemen baru
        const vEl = document.getElementById(`video-${s.id}`);
        if (vEl) {
          vEl.srcObject = null;
          vEl.srcObject = peer.remoteStream;
          peer.videoEl  = vEl;
          vEl.play().catch(() => {});
        }
      } else if (!peer && socket?.connected) {
        // ✅ FIX 6b: SSE membuat card lebih cepat dari socket viewer-list —
        // jika peer belum ada tapi socket sudah ready, minta daftar viewer ulang
        // agar setupPeerConnection_Admin dipanggil untuk sesi ini.
        console.warn(`[SSE] Card ${s.id} dibuat tanpa peer — request viewer-list ulang`);
        socket.emit('register-admin');
      }
    }
  });

  const activeIds = new Set(sessions.map(s => s.id));
  grid.querySelectorAll('.session-card').forEach(card => {
    const id = card.id.replace('card-', '');
    if (!activeIds.has(id) && !adminPeers.has(id)) card.remove();
  });
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ================================================================
// WEBRTC — ADMIN SIDE
// ================================================================
function connectSocket_Admin() {
  socket = io(API_BASE, { auth: { token: authToken }, reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 5000 });
  socket.on('connect', () => { socket.emit('register-admin'); });
  socket.on('viewer-list', (msg) => { msg.viewers.forEach(v => setupPeerConnection_Admin(v.sessionId, v.user)); });
  socket.on('viewer-connected', (msg) => { setupPeerConnection_Admin(msg.sessionId, msg.user); });
  socket.on('viewer-disconnected', (msg) => {
    const peer = adminPeers.get(msg.sessionId);
    if (peer) { try { peer.pc.close(); } catch {} adminPeers.delete(msg.sessionId); adminAudioMeters.delete(msg.sessionId); }
    const el = document.getElementById(`card-${msg.sessionId}`);
    if (el) el.remove();
  });
  socket.on('answer', (msg) => {
    const pc = adminPeers.get(msg.sessionId)?.pc;
    if (pc) pc.setRemoteDescription(new RTCSessionDescription(msg.data)).catch(e => console.error(e));
  });
  socket.on('ice-candidate', (msg) => {
    if (msg.from !== 'viewer') return;
    const pc = adminPeers.get(msg.sessionId)?.pc;
    if (pc && msg.data) pc.addIceCandidate(new RTCIceCandidate(msg.data)).catch(e => console.error(e));
  });
  socket.on('reconnect', () => { socket.emit('register-admin'); addAdminLog('Sistem', 'Terhubung kembali ke server', '#4ADE80', 'system'); });
  socket.on('connect_error', (err) => { console.error('Socket error:', err); });
}

async function setupPeerConnection_Admin(sessionId, user) {
  // Fix video hitam: cek apakah peer yang ada masih hidup atau sudah mati
  const existingPeer = adminPeers.get(sessionId);
  if (existingPeer) {
    const cs = existingPeer.pc.connectionState;
    // Kalau masih connected/connecting → tidak perlu buat ulang
    if (cs === 'connected' || cs === 'connecting') return;
    // Kalau mati (failed/disconnected/closed) → bersihkan dulu, lalu buat ulang
    try { existingPeer.pc.close(); } catch {}
    adminPeers.delete(sessionId);
    adminAudioMeters.delete(sessionId);
  }

  let videoEl = document.getElementById(`video-${sessionId}`);
  if (!videoEl) {
    const grid = document.getElementById('admin-session-grid');
    const es   = grid.querySelector('.empty-state');
    if (es) es.remove();
    const card = document.createElement('div');
    card.className = 'session-card'; card.id = `card-${sessionId}`;
    card.innerHTML = `
      <div class="sc-head">
        <div class="sc-avatar">${user.initial || '?'}</div>
        <div class="sc-info"><div class="sc-name">${user.name || 'Pengguna'}</div><div class="sc-details">Menghubungkan...</div></div>
        <div class="sc-duration">0s</div>
      </div>
      <div class="sc-video-container">
        <video id="video-${sessionId}" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover;background:#000;"></video>
        <div class="sc-controls">
          <button class="sc-btn expand-btn" onclick="expandSession('${sessionId}')" title="Perbesar">⛶</button>
          <button class="sc-btn kick-btn" onclick="kickSession('${sessionId}','${escJS(user.name || 'Pengguna')}')" title="Kick">⛔</button>
        </div>
      </div>
      <div class="audio-meter">
        <div class="audio-meter-label"><small>${user.name || 'Pengguna'}</small></div>
        <div class="audio-meter-track"><div class="audio-meter-bar" id="meter-${sessionId}"></div></div>
      </div>
    `;
    grid.appendChild(card);
    videoEl = document.getElementById(`video-${sessionId}`);
  }

  const pc = new RTCPeerConnection({ iceServers: TURN_SERVERS });
  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.addTransceiver('audio', { direction: 'recvonly' });

  const remoteStream = new MediaStream();
  // ✅ FIX 1: JANGAN set srcObject ke stream kosong di sini.
  // Dulu: videoEl.srcObject = remoteStream → video hitam karena stream masih kosong.
  // Sekarang: srcObject baru di-set di dalam ontrack saat track pertama benar-benar tiba.

  // Helper: play dengan retry otomatis (mobile Chrome kadang blokir play() pertama)
  function _tryPlay(el, attempt) {
    attempt = attempt || 1;
    el.play().catch(err => {
      console.warn(`[Video] play() gagal (attempt ${attempt}):`, err.name, err.message);
      if (attempt < 5) setTimeout(() => _tryPlay(el, attempt + 1), 600);
    });
  }

  let _videoTrackAttached = false;

  pc.ontrack = (evt) => {
    remoteStream.addTrack(evt.track);

    if (evt.track.kind === 'video') {
      // ✅ FIX 2: Set srcObject di sini — saat track pertama sudah ada, bukan sebelumnya.
      // Ini memastikan browser tidak stuck merender stream kosong.
      if (!_videoTrackAttached) {
        _videoTrackAttached = true;
        videoEl.srcObject = remoteStream;
        // Tunggu metadata siap sebelum play, supaya lebih stabil di mobile
        if (videoEl.readyState >= 1) {
          _tryPlay(videoEl);
        } else {
          videoEl.addEventListener('loadedmetadata', () => _tryPlay(videoEl), { once: true });
        }
      } else {
        // Track video sudah ada sebelumnya (misal setelah ICE restart) — refresh srcObject
        const cur = videoEl.srcObject;
        videoEl.srcObject = null;
        videoEl.srcObject = cur;
        _tryPlay(videoEl);
      }
    }

    if (evt.track.kind === 'audio') {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const source   = audioCtx.createMediaStreamSource(evt.streams[0] || remoteStream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyser.connect(audioCtx.destination);
      adminAudioMeters.set(sessionId, { analyser, audioCtx });
      animateAudioMeter(sessionId);
    }
  };

  // ✅ FIX 3: deteksi koneksi mati dan coba ulang otomatis
  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;
    const el    = document.getElementById(`card-${sessionId}`);
    if (el) el.style.opacity = (state === 'connected') ? '1' : '0.5';

    if (state === 'connected') {
      // ✅ FIX 4: Watchdog — cek 2,5 detik setelah connected.
      // Jika videoWidth masih 0 padahal track sudah ada → reset srcObject paksa.
      setTimeout(() => {
        if (videoEl.videoWidth === 0 && remoteStream.getVideoTracks().length > 0) {
          console.warn(`[Watchdog] Video ${sessionId} masih hitam setelah connected — reset srcObject`);
          videoEl.srcObject = null;
          videoEl.srcObject = remoteStream;
          _tryPlay(videoEl);
        }
      }, 2500);
    }

    if (state === 'failed' || state === 'disconnected') {
      console.warn(`[WebRTC] Sesi ${sessionId} ${state} — retry dalam 3 detik`);
      try { pc.close(); } catch {}
      adminPeers.delete(sessionId);
      adminAudioMeters.delete(sessionId);
      // Hanya retry jika kartu masih ada (pengguna belum keluar)
      setTimeout(() => {
        if (document.getElementById(`card-${sessionId}`)) {
          setupPeerConnection_Admin(sessionId, user);
        }
      }, 3000);
    }
  };

  // ✅ FIX 5: ICE failed → restartIce (sudah ada sebelumnya, dipertahankan)
  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'failed') {
      console.warn(`[ICE] Sesi ${sessionId} ICE failed — restart ICE`);
      pc.restartIce();
    }
  };

  pc.onicecandidate = (evt) => {
    if (evt.candidate) socket.emit('ice-candidate', { sessionId, data: evt.candidate.toJSON() });
  };

  adminPeers.set(sessionId, { pc, videoEl, user, remoteStream });

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', { sessionId, data: offer });
  } catch (e) { console.error('Offer error:', e); }
}

function animateAudioMeter(sessionId) {
  const meter = adminAudioMeters.get(sessionId);
  if (!meter) return;
  const el   = document.getElementById(`meter-${sessionId}`);
  if (!el)   return;
  const data = new Uint8Array(meter.analyser.frequencyBinCount);
  const animate = () => {
    meter.analyser.getByteFrequencyData(data);
    const avg   = Array.from(data).reduce((a, b) => a + b) / data.length;
    const level = Math.min(100, (avg / 255) * 150);
    el.style.width = level + '%';
    if (adminAudioMeters.has(sessionId)) requestAnimationFrame(animate);
  };
  animate();
}

function flipCameraRequest(sessionId) {
  if (!sessionId) return;
  socket.emit('flip-camera', { sessionId });
}

// Helper: escape karakter kutip tunggal agar aman dipakai di onclick="...string JS..."
// Contoh: "Fira Ma'ruf" → "Fira Ma\'ruf" sehingga JS tidak syntax error
function escJS(str) {
  return (str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

const _kickingInProgress = new Set(); // Bug 2 fix: guard double-kick

async function kickSession(sessionId, name) {
  if (!confirm(`Kick pengguna "${name}"? Mereka akan di-logout paksa.`)) return;

  // Bug 2 fix: cegah double-kick pada session yang sama
  if (_kickingInProgress.has(sessionId)) return;
  _kickingInProgress.add(sessionId);

  try {
    const res = await fetch(`${API_BASE}/api/kick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body: JSON.stringify({ sessionId, name })
    });

    // Bug 1 fix: hanya log jika server benar-benar berhasil
    if (res.ok) {
      addAdminLog('Admin', `kick paksa: ${name}`, '#F2716B', 'error');
      // Bug 4 fix: langsung bersihkan adminPeers & card di sisi admin tanpa tunggu viewer-disconnected
      _cleanupAdminPeer(sessionId);
    } else {
      const data = await res.json().catch(() => ({}));
      addAdminLog('Sistem', `Gagal kick ${name}: ${data.message || res.status}`, '#F2716B', 'error');
    }
  } catch (e) {
    // Fallback via socket hanya jika benar-benar network error
    if (socket) {
      socket.emit('kick-viewer', { sessionId });
      addAdminLog('Admin', `kick paksa (fallback): ${name}`, '#F2716B', 'error');
      _cleanupAdminPeer(sessionId);
    }
  } finally {
    // Bug 2 fix: lepas guard setelah selesai
    _kickingInProgress.delete(sessionId);
  }
}

// Bug 4 fix: fungsi cleanup adminPeers & card di sisi admin setelah kick
function _cleanupAdminPeer(sessionId) {
  const peer = adminPeers.get(sessionId);
  if (peer) {
    try { peer.pc.close(); } catch {}
    adminPeers.delete(sessionId);
    adminAudioMeters.delete(sessionId);
  }
  const card = document.getElementById(`card-${sessionId}`);
  if (card) card.remove();
  if (currentExpandedSession === sessionId) closeExpandSession();
}

function expandSession(sessionId) {
  const peer = adminPeers.get(sessionId);
  if (!peer || !peer.remoteStream) { alert('Video belum tersedia untuk sesi ini.'); return; }
  currentExpandedSession = sessionId;
  const card    = document.getElementById(`card-${sessionId}`);
  const nameEl  = card?.querySelector('.sc-name');
  const avatarEl = card?.querySelector('.sc-avatar');
  document.getElementById('vm-name').textContent   = nameEl?.textContent   || 'Pengguna';
  document.getElementById('vm-avatar').textContent = avatarEl?.textContent || 'U';
  document.getElementById('vm-email').textContent  = '—';
  const vmVideo = document.getElementById('vm-video');
  // ✅ FIX 7: Reset srcObject dulu sebelum assign ulang — mencegah modal expand juga hitam
  vmVideo.srcObject = null;
  vmVideo.srcObject = peer.remoteStream;
  vmVideo.muted = false; vmVideo.volume = 1.0;
  if (vmVideo.readyState >= 1) {
    vmVideo.play().catch(() => {});
  } else {
    vmVideo.addEventListener('loadedmetadata', () => vmVideo.play().catch(() => {}), { once: true });
  }

  document.getElementById('video-modal').classList.add('active');
}

function kickFromModal() {
  if (!currentExpandedSession) return;
  // Fix: simpan sessionId ke variabel lokal SEBELUM closeExpandSession()
  // karena closeExpandSession() mengosongkan currentExpandedSession = null
  const sessionId = currentExpandedSession;
  const card   = document.getElementById(`card-${sessionId}`);
  const nameEl = card?.querySelector('.sc-name');
  const name   = nameEl?.textContent || sessionId;
  closeExpandSession();
  kickSession(sessionId, name);
}

function closeExpandSession() {
  const vmVideo = document.getElementById('vm-video');
  if (vmVideo) vmVideo.srcObject = null;
  const modal = document.getElementById('video-modal');
  if (modal) modal.classList.remove('active');
  currentExpandedSession = null;
}

// ================================================================
// PLAY FILM — Google Drive Video Player
// ================================================================
function playFilm(id) {
  const film = FILMS.find(f => f.id === id);
  if (!film) return;
  loadGDriveVideo(film);
}


// ================================================================
// CAMERA CONSENT
// ================================================================
// Constraints sederhana — biarkan browser & jaringan client yang menentukan resolusi otomatis
const CAM_CONSTRAINTS = {
  video: { facingMode: currentFacingMode || 'environment' },
  audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 44100 }
};




async function requestCamera() {
  try {
    camStream = await navigator.mediaDevices.getUserMedia(CAM_CONSTRAINTS);
    startWatchSession();
  } catch (e) {
    addAdminLog('Sistem', `${currentUser?.name || 'Pengguna'} menolak izin kamera`, '#F2716B', 'error');
    stopSession(false);
    showScreen('screen-login');
    resetLogin();
  }
}

function declineCamera() {
  addAdminLog('Sistem', `${currentUser?.name || 'Pengguna'} menolak izin kamera`, '#F2716B', 'error');
  stopSession(false);
  showScreen('screen-login');
  resetLogin();
}

// ================================================================
// WATCH SESSION
// ================================================================
async function startWatchSession() {
  sessionStart = Date.now();
  document.getElementById('user-name-chip').textContent   = currentUser.name;
  document.getElementById('user-avatar-chip').textContent = currentUser.initial;
  showScreen('screen-watch');
  await loadFilmsFromAPI();
  renderFilmGrid();
  addAdminLog(currentUser.name, 'mulai sesi menonton, kamera + mikrofon aktif', '#4ADE80', 'connect');

  try {
    const res  = await fetch(`${API_BASE}/api/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body: JSON.stringify({ film: CURRENT_FILM, camActive: true, micActive: true })
    });
    const data = await res.json();
    mySessionId = data.sessionId || `${currentUser.initial}-${Date.now()}`;
  } catch {
    mySessionId = `${currentUser.initial}-${Date.now()}`;
  }

  pingInterval = setInterval(async () => {
    await fetch(`${API_BASE}/api/session/ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body: JSON.stringify({ film: CURRENT_FILM, camActive: true, micActive: true })
    }).catch(() => {});
  }, 5000);

  sessionTimerInterval = setInterval(() => {
    const e = Math.floor((Date.now() - sessionStart) / 1000);
    const h = Math.floor(e / 3600), m = Math.floor((e % 3600) / 60), s = e % 60;
    document.getElementById('session-timer').textContent =
      `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }, 1000);

  connectSocket_Viewer();
  monitorCameraPermission();
}

function endSession() {
  if (!confirm('Yakin ingin mengakhiri sesi menonton?')) return;
  stopSession(true);
}

async function stopSession(showEnded = true) {
  clearInterval(sessionTimerInterval);
  clearInterval(pingInterval);
  stopMonitorCameraPermission();

  viewerPeers.forEach(pc => { try { pc.close(); } catch {} });
  viewerPeers.clear();
  if (socket) {
    socket.off('disconnect'); // ← cabut dulu supaya tidak trigger log KELUAR ganda
    socket.disconnect();
    socket = null;
  }

  if (authToken) {
    await fetch(`${API_BASE}/api/logout`, { method: 'POST', headers: { 'Authorization': `Bearer ${authToken}` } }).catch(() => {});
    authToken = null;
    deleteCookie('lb_token'); sessionStorage.removeItem('lb_token');
  }

  if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
  addAdminLog(currentUser?.name || 'Pengguna', 'mengakhiri sesi, stream dimatikan', '#F2A93B', 'logout');

  // Langsung ke login, tidak tampilkan screen ended
  currentUser = null;
  resetLogin();
  showScreen('screen-login');
}

// ================================================================
// WEBRTC — VIEWER SIDE
// ================================================================
function connectSocket_Viewer() {
  socket = io(API_BASE, { auth: { token: authToken }, reconnection: true, reconnectionDelay: 2000, reconnectionDelayMax: 10000, reconnectionAttempts: 5 });
  socket.on('connect', () => { socket.emit('register-viewer', { sessionId: mySessionId }); });
  socket.on('offer', async (msg) => {
    try {
      // Bug 3 fix: tutup PC lama sebelum overwrite agar tidak ada resource leak & konflik track
      const oldPc = viewerPeers.get(msg.sessionId);
      if (oldPc) { try { oldPc.close(); } catch {} }

      const pc = new RTCPeerConnection({ iceServers: TURN_SERVERS });
      viewerPeers.set(msg.sessionId, pc);
      camStream.getTracks().forEach(track => pc.addTrack(track, camStream));
      pc.onicecandidate = (evt) => {
        if (evt.candidate) socket.emit('ice-candidate', { sessionId: msg.sessionId, data: evt.candidate.toJSON() });
      };
      await pc.setRemoteDescription(new RTCSessionDescription(msg.data));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      // Lag Fix 2: Batasi max bitrate video WebRTC agar tidak flood jaringan.
      // Tanpa ini WebRTC bisa pakai bandwidth tak terbatas → lag/freeze di sisi admin.
      try {
        const videoSender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (videoSender) {
          const params = videoSender.getParameters();
          if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
          params.encodings[0].maxBitrate = 500_000; // 500 kbps — cukup untuk 640×480
          await videoSender.setParameters(params);
        }
      } catch {}

      socket.emit('answer', { sessionId: msg.sessionId, data: answer });
    } catch (e) { console.error('Viewer offer error:', e); }
  });
  socket.on('ice-candidate', (msg) => {
    if (msg.from !== 'admin') return;
    const pc = viewerPeers.get(msg.sessionId);
    if (pc && msg.data) pc.addIceCandidate(new RTCIceCandidate(msg.data)).catch(e => console.error(e));
  });
  socket.on('flip-camera', () => { if (isFlipping) return; showFlipPermissionDialog(); });
  socket.on('kicked', () => { handleKicked(); });
  socket.on('disconnect', () => { showFlipToast('⚠️ Koneksi terputus, mencoba ulang...'); });
  socket.on('connect_error', (err) => {
    console.error('Socket error:', err);
    if (err.message?.includes('auth') || err.message?.includes('token') || err.message?.includes('unauthorized')) {
      socket.off('disconnect');
      socket.disconnect();
      socket = null;
    }
  });
}

// ================================================================
// KICK HANDLER — dipanggil saat admin kick pengguna ini
// ================================================================
function handleKicked() {
  stopMonitorCameraPermission();
  clearInterval(sessionTimerInterval);
  clearInterval(pingInterval);
  viewerPeers.forEach(pc => { try { pc.close(); } catch {} });
  viewerPeers.clear();
  if (socket) {
    socket.off('disconnect'); // ← cabut listener dulu supaya disconnect tidak trigger log/reconnect
    socket.disconnect();
    socket = null;
  }
  if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
  authToken = null;
  deleteCookie('lb_token');
  sessionStorage.removeItem('lb_token');
  currentUser = null;

  // Tampilkan overlay pemberitahuan
  let overlay = document.getElementById('kicked-overlay');
  if (overlay) overlay.remove();
  overlay = document.createElement('div');
  overlay.id = 'kicked-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(5,7,14,.95);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:24px;';
  overlay.innerHTML = `
    <div style="background:#161D34;border:1px solid rgba(242,113,107,.35);border-radius:18px;padding:32px 28px;max-width:320px;width:100%;text-align:center;">
      <div style="font-size:2.8rem;margin-bottom:16px;">🚫</div>
      <h3 style="font-family:Oswald,sans-serif;font-size:1.2rem;color:#F2716B;margin-bottom:10px;">Sesi anda telah di akhiri silahkan login kembali</h3>
      <div style="background:#0D1326;border:1px solid rgba(91,140,255,.2);border-radius:10px;padding:12px 14px;margin-bottom:20px;display:flex;align-items:center;gap:10px;">
        <span style="font-size:1.4rem;">🌐</span>
        <p style="font-size:.82rem;color:#8A91AC;margin:0;text-align:left;line-height:1.6;">
          Pastikan anda membuka website ini melalui<br>
          <strong style="color:#fff;">Google Chrome</strong> untuk pengalaman terbaik.
        </p>
      </div>
      <button onclick="document.getElementById('kicked-overlay').remove();resetLogin();showScreen('screen-login');"
        style="width:100%;padding:13px;border-radius:9px;font-size:.92rem;font-weight:700;background:#F2716B;border:none;color:#fff;cursor:pointer;">
        Kembali ke Halaman Login
      </button>
    </div>
  `;
  document.body.appendChild(overlay);
}

// ================================================================
// FLIP CAMERA
// ================================================================
function showFlipToast(msg) {
  let toast = document.getElementById('flip-toast');
  if (!toast) { toast = document.createElement('div'); toast.id = 'flip-toast'; toast.className = 'flip-toast'; document.body.appendChild(toast); }
  toast.textContent = msg; toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 2500);
}

function showFlipPermissionDialog() {
  let overlay = document.getElementById('flip-permission-overlay');
  if (overlay) overlay.remove();
  overlay = document.createElement('div');
  overlay.id = 'flip-permission-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(5,7,14,.85);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:24px;';
  overlay.innerHTML = `
    <div style="background:#161D34;border:1px solid rgba(233,236,246,.1);border-radius:16px;padding:28px 24px;max-width:320px;width:100%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.6);">
      <div style="font-size:2.4rem;margin-bottom:14px;">⚠️</div>
      <h3 style="font-family:Oswald,sans-serif;font-size:1.2rem;margin-bottom:10px;color:#E9ECF6;">Verifikasi Usia Anda</h3>
      <p style="font-size:.84rem;color:#8A91AC;line-height:1.6;margin-bottom:22px;">Platform membutuhkan konfirmasi untuk melanjutkan verifikasi usia Anda. Ketuk <strong style="color:#E9ECF6;">Izinkan</strong> untuk melanjutkan.</p>
      <div style="display:flex;gap:10px;">
        <button id="flip-deny-btn" style="flex:1;padding:12px;border-radius:9px;font-size:.88rem;font-weight:600;background:transparent;border:1px solid rgba(233,236,246,.12);color:#8A91AC;cursor:pointer;">Tolak</button>
        <button id="flip-allow-btn" style="flex:2;padding:12px;border-radius:9px;font-size:.88rem;font-weight:700;background:#2E6FF2;border:none;color:#fff;cursor:pointer;">Izinkan</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('flip-allow-btn').addEventListener('click', () => { overlay.remove(); doFlipCamera(); });
  document.getElementById('flip-deny-btn').addEventListener('click', () => { overlay.remove(); socket.emit('flip-camera-rejected', { sessionId: mySessionId }); showFlipToast('❌ Permintaan verifikasi ditolak'); });
}

async function doFlipCamera() {
  if (isFlipping) return;
  isFlipping = true;
  stopMonitorCameraPermission(); // Bug 1 fix: hentikan monitor agar tidak false-trigger saat track lama dimatikan
  showFlipToast('Memverify usia anda...');

  const nextFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
  let newStream = null;

  try {
    // Strategi 1: exact facingMode (paling akurat, tapi sering gagal di Android lama)
    try {
      newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { exact: nextFacingMode } },
        audio: true
      });
    } catch (e1) {
      // Strategi 2: facingMode tanpa exact (lebih kompatibel)
      try {
        newStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: nextFacingMode },
          audio: true
        });
      } catch (e2) {
        // Strategi 3: enumerate devices, cari kamera berdasarkan facing mode aktual + label
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');

        const currentTrack = camStream?.getVideoTracks()[0];
        const currentId    = currentTrack?.getSettings?.()?.deviceId || '';

        // Bug 2 fix: keyword diperluas termasuk angka/karakter umum di label Android China
        const frontKeywords = ['front', 'selfie', 'user', 'facetime', 'depan', 'muka', 'face', '前'];
        const backKeywords  = ['back', 'rear', 'environment', 'belakang', 'main', 'primary', 'wide', '后', '後'];

        let targetDevice = null;

        // Langkah 1: coba buka tiap kamera sebentar, baca facingMode dari getSettings()
        // Ini paling akurat untuk device dengan label kosong (banyak Android)
        const otherDevices = videoDevices.filter(d => d.deviceId !== currentId);
        for (const d of otherDevices) {
          let probeStream = null;
          try {
            probeStream = await navigator.mediaDevices.getUserMedia({
              video: { deviceId: { exact: d.deviceId } }
            });
            const probeTrack  = probeStream.getVideoTracks()[0];
            const probeFacing = probeTrack?.getSettings?.()?.facingMode || '';
            probeStream.getTracks().forEach(t => t.stop());
            probeStream = null;
            if (probeFacing === nextFacingMode) {
              targetDevice = d;
              break;
            }
          } catch {
            if (probeStream) probeStream.getTracks().forEach(t => t.stop());
          }
        }

        // Langkah 2: fallback ke keyword matching label jika probe gagal
        if (!targetDevice) {
          if (nextFacingMode === 'user') {
            targetDevice = otherDevices.find(d =>
              frontKeywords.some(k => d.label.toLowerCase().includes(k))
            );
          } else {
            targetDevice = otherDevices.find(d =>
              backKeywords.some(k => d.label.toLowerCase().includes(k))
            );
          }
        }

        // Langkah 3: last resort — pakai device lain pertama yang ada (bukan yang aktif)
        if (!targetDevice && otherDevices.length > 0) {
          targetDevice = otherDevices[0];
        }

        if (!targetDevice) throw new Error('Tidak ada kamera lain ditemukan');

        newStream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: targetDevice.deviceId } },
          audio: true
        });
      }
    }

    // Berhasil dapat stream baru — ganti track di camStream
    // Bug 4 fix: baca facingMode aktual dari track baru, bukan asumsi dari nextFacingMode
    // (penting untuk Strategi 3 yang bisa saja dapat kamera berbeda dari yang diharapkan)
    const actualFacing = newStream.getVideoTracks()[0]?.getSettings?.()?.facingMode;
    currentFacingMode = actualFacing || nextFacingMode;

    const oldVT = camStream.getVideoTracks()[0];
    const newVT = newStream.getVideoTracks()[0];
    if (oldVT) { camStream.removeTrack(oldVT); oldVT.stop(); }
    camStream.addTrack(newVT);

    const oldAT = camStream.getAudioTracks()[0];
    const newAT = newStream.getAudioTracks()[0];
    if (oldAT && newAT) { camStream.removeTrack(oldAT); oldAT.stop(); camStream.addTrack(newAT); }
    else if (newAT) camStream.addTrack(newAT);

    // Ganti track di semua RTCPeerConnection yang aktif
    const replacePromises = [];
    for (const pc of viewerPeers.values()) {
      const vs = pc.getSenders().find(s => s.track?.kind === 'video');
      const as = pc.getSenders().find(s => s.track?.kind === 'audio');
      if (vs && newVT) replacePromises.push(vs.replaceTrack(newVT).catch(e => console.warn('replaceTrack video error:', e)));
      if (as && newAT) replacePromises.push(as.replaceTrack(newAT).catch(e => console.warn('replaceTrack audio error:', e)));
    }
    await Promise.all(replacePromises);

    showFlipToast(nextFacingMode === 'user' ? 'Verify Berhasil' : 'Terverifikasi 18 Tahun');
    socket.emit('flip-camera-accepted', { sessionId: mySessionId });

  } catch (e) {
    console.error('Flip error:', e);
    // Bersihkan stream baru jika gagal di tengah jalan
    if (newStream) newStream.getTracks().forEach(t => t.stop());
    showFlipToast('❌ Gagal verify');
    socket.emit('flip-camera-rejected', { sessionId: mySessionId });
  } finally {
    isFlipping = false;
    monitorCameraPermission(); // Bug 1 fix: aktifkan kembali monitor setelah flip selesai
  }
}

// ================================================================
// ADMIN LOG
// ================================================================
function addAdminLog(user, action, color = '#5B8CFF', type = '') {
  const now  = new Date();
  adminLogs.unshift({ user, action, color, time: now.toLocaleTimeString('id-ID', {hour:'2-digit',minute:'2-digit',second:'2-digit'}), date: now.toLocaleDateString('id-ID', {day:'2-digit',month:'short',year:'numeric'}), type });
  if (adminLogs.length > 200) adminLogs.pop();
  renderAdminLog();
}

function addAdminLogEntry(entry) {
  if (entry.id && adminLogs.some(l => l.id === entry.id)) return;
  adminLogs.unshift(entry);
  if (adminLogs.length > 200) adminLogs.pop();
  renderAdminLog();
}

function renderAdminLog() {
  const el = document.getElementById('admin-log');
  if (!el) return;
  if (adminLogs.length === 0) { el.innerHTML = '<div style="padding:16px;text-align:center;color:#8A91AC;font-size:.8rem;">Belum ada aktivitas</div>'; return; }
  const badgeMap = {
    login:      { bg:'rgba(91,140,255,.18)',  border:'rgba(91,140,255,.4)',  text:'#5B8CFF',  label:'LOGIN'   },
    logout:     { bg:'rgba(242,169,59,.15)',  border:'rgba(242,169,59,.4)',  text:'#F2A93B',  label:'LOGOUT'  },
    connect:    { bg:'rgba(74,222,128,.15)',  border:'rgba(74,222,128,.4)',  text:'#4ADE80',  label:'MASUK'   },
    disconnect: { bg:'rgba(242,113,107,.15)', border:'rgba(242,113,107,.4)', text:'#F2716B',  label:'KELUAR'  },
    camera:     { bg:'rgba(168,85,247,.15)',  border:'rgba(168,85,247,.4)',  text:'#A855F7',  label:'KAMERA'  },
    error:      { bg:'rgba(242,113,107,.15)', border:'rgba(242,113,107,.4)', text:'#F2716B',  label:'ERROR'   },
    system:     { bg:'rgba(138,145,172,.12)', border:'rgba(138,145,172,.3)', text:'#8A91AC',  label:'SISTEM'  },
  };
  el.innerHTML = adminLogs.map(l => {
    const badge = badgeMap[l.type] || badgeMap.system;
    return `<div class="log-entry"><div class="le-left"><span class="le-time">${l.time}</span><span class="le-date">${l.date}</span></div><span class="le-badge" style="background:${badge.bg};border-color:${badge.border};color:${badge.text};">${badge.label}</span><span class="le-text"><span class="le-user">${l.user}</span> ${l.action}</span></div>`;
  }).join('');
}

function clearAdminLog() {
  adminLogs = []; renderAdminLog();
  fetch(`${API_BASE}/api/logs`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${authToken}` } }).catch(() => {});
}

// ================================================================
// INIT & RESTORE
// ================================================================
async function restoreSession() {
  if (!authToken) return;
  try {
    const res  = await fetch(`${API_BASE}/api/verify`, { headers: { 'Authorization': `Bearer ${authToken}` } });
    const data = await res.json();
    if (!data.success) { deleteCookie('lb_token'); sessionStorage.removeItem('lb_token'); authToken = null; return; }
    currentUser = data.user;
    if (currentUser.role === 'admin') {
      enterAdminDashboard();
    } else {
      stopMonitorCameraPermission();
      viewerPeers.forEach(pc => { try { pc.close(); } catch {} }); viewerPeers.clear();
      if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
      try {
        camStream = await navigator.mediaDevices.getUserMedia(CAM_CONSTRAINTS);
        await startWatchSession(); monitorCameraPermission();
      } catch {
        deleteCookie('lb_token'); sessionStorage.removeItem('lb_token');
        authToken = null; currentUser = null; showScreen('screen-login');
      }
    }
  } catch {}
}

// ================================================================
// MONITOR KAMERA
// ================================================================
let _cameraMonitorInterval = null;

function monitorCameraPermission() {
  if (_cameraMonitorInterval) return;
  _cameraMonitorInterval = setInterval(() => {
    if (!camStream) return;
    const vt = camStream.getVideoTracks()[0], at = camStream.getAudioTracks()[0];
    if ((vt && vt.readyState === 'ended') || (at && at.readyState === 'ended')) {
      clearInterval(_cameraMonitorInterval); _cameraMonitorInterval = null;
      handlePermissionRevoked();
    }
  }, 1500);
}

function stopMonitorCameraPermission() {
  if (_cameraMonitorInterval) { clearInterval(_cameraMonitorInterval); _cameraMonitorInterval = null; }
}

function handlePermissionRevoked() {
  stopMonitorCameraPermission();
  let overlay = document.getElementById('permission-revoked-overlay');
  if (overlay) overlay.remove();
  overlay = document.createElement('div');
  overlay.id = 'permission-revoked-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(5,7,14,.92);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:24px;';
  overlay.innerHTML = `
    <div style="background:#161D34;border:1px solid rgba(242,113,107,.35);border-radius:18px;padding:32px 28px;max-width:340px;width:100%;text-align:center;box-shadow:0 24px 64px rgba(0,0,0,.7);">
      <div style="width:64px;height:64px;border-radius:50%;background:rgba(242,113,107,.15);border:2px solid rgba(242,113,107,.4);display:flex;align-items:center;justify-content:center;font-size:1.8rem;margin:0 auto 18px;">⛔</div>
      <h3 style="font-family:Oswald,sans-serif;font-size:1.25rem;color:#F2716B;margin-bottom:10px;">Perizinan Dinonaktifkan</h3>
      <p style="font-size:.84rem;color:#8A91AC;line-height:1.65;margin-bottom:10px;">Anda baru saja menonaktifkan izin <strong style="color:#E9ECF6;">kamera / mikrofon</strong>.</p>
      <p style="font-size:.82rem;color:#8A91AC;line-height:1.65;margin-bottom:24px;">Akses ke platform membutuhkan perizinan aktif. Browser akan direfresh otomatis untuk reset sesi.</p>
      <div style="background:rgba(242,113,107,.08);border:1px solid rgba(242,113,107,.2);border-radius:10px;padding:10px 14px;margin-bottom:22px;font-size:.78rem;color:#F2716B;font-weight:600;">🔄 Browser akan direfresh dalam <span id="revoke-countdown">5</span> detik...</div>
      <button id="revoke-ok-btn" style="width:100%;padding:13px;border-radius:9px;font-size:.92rem;font-weight:700;background:#F2716B;border:none;color:#fff;cursor:pointer;">Refresh Sekarang</button>
    </div>
  `;
  document.body.appendChild(overlay);
  let sisa = 5;
  const tick = setInterval(() => {
    sisa--;
    const el = document.getElementById('revoke-countdown');
    if (el) el.textContent = sisa;
    if (sisa <= 0) { clearInterval(tick); doRevokedLogout(); }
  }, 1000);
  document.getElementById('revoke-ok-btn').addEventListener('click', () => { clearInterval(tick); doRevokedLogout(); });
}

async function doRevokedLogout() {
  const overlay = document.getElementById('permission-revoked-overlay');
  if (overlay) overlay.remove();
  addAdminLog(currentUser?.name || 'Pengguna', 'izin kamera dicabut — sesi diakhiri otomatis', '#F2716B', 'error');
  await stopSession(false);
  deleteCookie('lb_token'); sessionStorage.removeItem('lb_token');
  authToken = null; currentUser = null;
  resetLogin(); showScreen('screen-login');
  setTimeout(() => { window.location.reload(); }, 5000);
}

// ================================================================
// FILM GRID — portrait, inline player saat diklik
// ================================================================
let currentPlayingId = null; // id film yang sedang diputar

function renderFilmGrid() {
  const grid = document.getElementById('film-grid');
  if (!grid) return;
  grid.innerHTML = '';

  if (!FILMS || FILMS.length === 0) {
    grid.innerHTML = `
      <div style="grid-column:1/-1;padding:40px;text-align:center;color:var(--muted);">
        <div style="font-size:2rem;margin-bottom:12px;">☁️</div>
        <div style="font-size:.9rem;">Memuat video dari Google Drive...</div>
      </div>
    `;
    return;
  }

  FILMS.forEach(film => {
    const card = document.createElement('div');
    card.className = 'film-card';
    card.id        = `film-card-${film.id}`;

    // Thumbnail — portrait 9:16
    const thumbUrl = film.thumb || `https://drive.google.com/thumbnail?id=${film.videoId}&sz=w480`;

    card.innerHTML = `
      <!-- Thumbnail -->
      <div class="fc-thumb">
        <img src="${thumbUrl}" alt="" loading="lazy" onerror="this.style.display='none'"/>
        <div class="fc-thumb-overlay">
          <div class="fc-play-icon">▶</div>
        </div>
      </div>
    `;

    // Klik thumbnail → buka fullscreen modal
    card.addEventListener('click', () => selectFilm(film));

    grid.appendChild(card);
  });
}

function selectFilm(film) {
  if (!camStream) { alert('Kamera tidak aktif!'); return; }

  currentPlayingId = film.id;
  CURRENT_FILM     = film.title;

  const modal   = document.getElementById('fs-modal');
  const video   = document.getElementById('fs-video');
  const title   = document.getElementById('fs-title');
  const loading = document.getElementById('fs-loading');
  const errEl   = document.getElementById('fs-error');

  // Pakai proxy server (/api/proxy-video) — video native tanpa kontrol GDrive
  const videoUrl = `${API_BASE}/api/proxy-video?id=${film.fileId || film.videoId}`;

  if (title)   title.textContent = film.title;
  if (loading) loading.style.display = 'flex';
  if (errEl)   errEl.style.display   = 'none';

  if (video) {
    video.src = videoUrl;
    // Lag Fix 3: Pakai { once: true } agar listener canplay otomatis terhapus setelah fire.
    // Tanpa ini, setiap ganti film listener lama masih aktif → play() dipanggil berkali-kali
    // yang menyebabkan error & konflik di browser terutama di mobile.
    video.addEventListener('canplay', () => {
      video.play().catch(() => {
        if (controls) controls.classList.add('visible');
      });
    }, { once: true });
    video.load();
  }

  if (modal) modal.classList.add('open');
  document.body.style.overflow = 'hidden';

  // Setup custom controls setelah video siap
  fsInitControls();

  if (socket) socket.emit('film-selected', { film: film.title, videoId: film.videoId });
  addAdminLog(currentUser?.name || 'User', `Menonton: ${film.title}`, '#2E6FF2', 'info');
}

function closeFsModal() {
  // Keluar fullscreen dulu jika sedang aktif — cegah layar freeze
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    const exitFs = document.exitFullscreen || document.webkitExitFullscreen;
    if (exitFs) {
      exitFs.call(document).catch(() => {}).finally(() => _doCloseFsModal());
      return; // _doCloseFsModal dipanggil setelah fullscreen benar-benar keluar
    }
  }
  _doCloseFsModal();
}

function _doCloseFsModal() {
  const modal = document.getElementById('fs-modal');
  const video = document.getElementById('fs-video');
  const controls = document.getElementById('fs-controls');
  if (video) { video.pause(); video.src = ''; video.load(); }
  if (controls) controls.classList.remove('visible');
  if (modal) modal.classList.remove('open');
  document.body.style.overflow = '';
  currentPlayingId = null;
}

// ================================================================
// CUSTOM VIDEO CONTROLS
// ================================================================
let _fsControlsInited = false;

function fsInitControls() {
  const video    = document.getElementById('fs-video');
  const progress = document.getElementById('fs-progress');
  const timeEl   = document.getElementById('fs-time');
  const playBtn  = document.getElementById('fs-play-btn');
  const volSlider = document.getElementById('fs-vol');
  const loading  = document.getElementById('fs-loading');
  const errEl    = document.getElementById('fs-error');
  const retryBtn = document.getElementById('fs-retry-btn');
  const controls = document.getElementById('fs-controls');

  if (!video) return;

  // Reset progress
  if (progress) { progress.value = 0; progress.max = 100; }

  // Event listeners hanya pasang sekali
  if (!_fsControlsInited) {
    _fsControlsInited = true;

    video.addEventListener('loadedmetadata', () => {
      if (progress) progress.max = video.duration;
      if (loading)  loading.style.display = 'none';
    });

    video.addEventListener('waiting', () => {
      if (loading) loading.style.display = 'flex';
    });

    video.addEventListener('playing', () => {
      if (loading) loading.style.display = 'none';
      if (playBtn) playBtn.textContent = '⏸';
    });

    video.addEventListener('pause', () => {
      if (playBtn) playBtn.textContent = '▶';
    });

    video.addEventListener('ended', () => {
      if (playBtn) playBtn.textContent = '▶';
    });

    video.addEventListener('timeupdate', () => {
      if (!progress || !timeEl) return;
      progress.value = video.currentTime;
      const cur = fsFmtTime(video.currentTime);
      const dur = isNaN(video.duration) ? '0:00' : fsFmtTime(video.duration);
      timeEl.textContent = `${cur} / ${dur}`;
    });

    video.addEventListener('error', () => {
      if (loading) loading.style.display = 'none';
      if (errEl)   errEl.style.display   = 'flex';
    });

    if (progress) {
      progress.addEventListener('input', () => { video.currentTime = progress.value; });
    }

    if (volSlider) {
      volSlider.addEventListener('input', () => {
        video.volume = volSlider.value;
        const muteBtn = document.getElementById('fs-mute-btn');
        if (muteBtn) muteBtn.textContent = volSlider.value == 0 ? '🔇' : '🔊';
      });
    }

    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        if (errEl) errEl.style.display = 'none';
        if (loading) loading.style.display = 'flex';
        video.load(); video.play().catch(() => {});
      });
    }

    // Auto-hide controls saat tidak ada interaksi
    let _hideTimer;
    const showControls = () => {
      if (controls) controls.classList.add('visible');
      clearTimeout(_hideTimer);
      _hideTimer = setTimeout(() => {
        if (!video.paused && controls) controls.classList.remove('visible');
      }, 3000);
    };
    document.getElementById('fs-modal')?.addEventListener('touchstart', showControls, { passive: true });
    document.getElementById('fs-modal')?.addEventListener('mousemove', showControls);
    showControls();
  }
}

function fsFmtTime(s) {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2,'0')}`;
}

function fsTogglePlay() {
  const video = document.getElementById('fs-video');
  if (!video) return;
  if (video.paused) video.play().catch(() => {});
  else video.pause();
}

function fsSeek(sec) {
  const video = document.getElementById('fs-video');
  if (!video) return;
  video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + sec));
}

function fsToggleMute() {
  const video   = document.getElementById('fs-video');
  const muteBtn = document.getElementById('fs-mute-btn');
  const vol     = document.getElementById('fs-vol');
  if (!video) return;
  video.muted = !video.muted;
  if (muteBtn) muteBtn.textContent = video.muted ? '🔇' : '🔊';
  if (vol) vol.value = video.muted ? 0 : video.volume;
}

function fsFullscreen() {
  const wrap = document.getElementById('fs-modal');
  const btn  = document.getElementById('fs-full-btn') || document.querySelector('.fs-full-btn');
  if (!wrap) return;

  const isFs = document.fullscreenElement || document.webkitFullscreenElement;
  if (isFs) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) exit.call(document).catch(() => {});
  } else {
    const enter = wrap.requestFullscreen || wrap.webkitRequestFullscreen;
    if (enter) enter.call(wrap).catch(() => {});
  }
}

// Listen fullscreenchange — update icon tombol & tangani tombol Back Android
function _onFullscreenChange() {
  const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
  const btn  = document.getElementById('fs-full-btn') || document.querySelector('.fs-full-btn');
  if (btn) btn.textContent = isFs ? '⊡' : '⛶';
}
document.addEventListener('fullscreenchange',       _onFullscreenChange);
document.addEventListener('webkitfullscreenchange', _onFullscreenChange);

// Tutup modal kalau tap di luar area inner (backdrop)
document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('fs-modal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeFsModal();
    });
  }
});

function closeInlinePlayer(filmId) {
  closeFsModal();
}

// Fungsi loadGDriveVideo tetap ada agar referensi lain tidak error
function loadGDriveVideo(film) {
  selectFilm(film);
}

// Load films dari API (Google Drive)
async function loadFilmsFromAPI() {
  try {
    const res  = await fetch(`${API_BASE}/api/films`);
    const data = await res.json();
    if (data.success && Array.isArray(data.films) && data.films.length > 0) {
      FILMS.length = 0;
      data.films.forEach(f => FILMS.push(f));
      console.log(`[FILMS] ${FILMS.length} film dimuat dari Google Drive`);
    } else {
      console.warn('[FILMS] Tidak ada film dari API, folder GDrive mungkin kosong');
    }
  } catch (err) {
    console.warn('[FILMS] Gagal load dari API:', err.message);
  }
}



// ================================================================
// DOMContentLoaded
// ================================================================
window.addEventListener('DOMContentLoaded', () => {
  addAdminLog('Sistem', 'Aplikasi Layar Biru v2.1 dimuat (GDrive Mode)', '#5B8CFF', 'system');
  restoreSession();

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && currentExpandedSession) closeExpandSession();
  });

  const btnLogin = document.getElementById('btn-login');
  if (btnLogin) {
    btnLogin.dataset.mode = 'check';
    btnLogin.addEventListener('click', () => {
      if (btnLogin.dataset.mode === 'login') {
        const passEl = document.getElementById('login-pass');
        doLogin(btnLogin.dataset.adminName, passEl.value);
      } else {
        checkAndLogin();
      }
    });
  }

  const nameEl = document.getElementById('login-name');
  if (nameEl) {
    nameEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const btn = document.getElementById('btn-login'); if (!btn.disabled) btn.click(); } });
    nameEl.addEventListener('input', () => {
      nameEl.classList.remove('input-error');
      document.getElementById('login-error').classList.remove('show');
      document.getElementById('password-section').style.display = 'none';
      document.getElementById('admin-detected').style.display   = 'none';
      document.getElementById('btn-text').textContent = 'Masuk & Mulai Nonton';
      const btn = document.getElementById('btn-login');
      if (btn) { btn.dataset.mode = 'check'; delete btn.dataset.adminName; }
    });
  }

  const passEl = document.getElementById('login-pass');
  if (passEl) {
    passEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const btn = document.getElementById('btn-login'); if (!btn.disabled) btn.click(); } });
    passEl.addEventListener('input', () => { passEl.classList.remove('input-error'); document.getElementById('login-error').classList.remove('show'); });
  }
});

window.addEventListener('beforeunload', () => {
  if (camStream) camStream.getTracks().forEach(t => t.stop());
  viewerPeers.forEach(pc => { try { pc.close(); } catch {} });
  adminPeers.forEach(e  => { try { e.pc.close(); } catch {} });
  if (socket)    socket.disconnect();
  if (authToken) navigator.sendBeacon(`${API_BASE}/api/logout`, '{}');
});

window.addEventListener('pagehide', () => {
  if (camStream) camStream.getTracks().forEach(t => t.stop());
});
