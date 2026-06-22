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
        showLoginError(data.message || 'Terjadi kesalahan.', nameEl);
      }

      addAdminLog('Sistem', `Login gagal — ${finalName}`, '#F2716B', 'error');
      btnEl.disabled = !document.getElementById('chk-consent').checked;
      return;
    }

    authToken   = data.token;
    currentUser = data.user;
    setCookie('lb_token', authToken, 8); sessionStorage.setItem('lb_token', authToken);
    addAdminLog('Sistem', `${currentUser.name} login sebagai ${currentUser.role}`, '#5B8CFF', 'login');

    if (currentUser.role === 'admin') enterAdminDashboard();
    else showScreen('screen-consent');

  } catch (err) {
    btnEl.classList.remove('loading');
    btnText.textContent = originalText;
    btnEl.disabled    = false;
    showLoginError('Tidak bisa terhubung ke server.', nameEl);
  }
}


// ================================================================
// ADMIN DASHBOARD
// ================================================================
function enterAdminDashboard() {
  showScreen('screen-admin');
  document.getElementById('admin-username').textContent =
    `Masuk sebagai: ${currentUser.name} (${currentUser.role})`;
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
    fetch(`${API_BASE}/api/logout`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${authToken}` }
    }).catch(() => {});
    authToken = null;
    deleteCookie('lb_token'); sessionStorage.removeItem('lb_token');
  }

  currentUser = null;
  resetLogin();
  showScreen('screen-login');
}


// ================================================================
// SSE — stats realtime untuk admin
// ================================================================
function connectSSE() {
  if (sseConnection) sseConnection.close();

  const dot = document.getElementById('sse-dot');
  const txt = document.getElementById('sse-status-text');
  dot.className  = 'sse-dot';
  txt.textContent = 'Menghubungkan...';

  sseConnection = new EventSource(
    `${API_BASE}/api/sessions/stream?token=${encodeURIComponent(authToken)}`
  );

  sseConnection.onopen = () => {
    dot.className  = 'sse-dot connected';
    txt.textContent = 'Terhubung realtime';
  };
  sseConnection.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'sessions') updateAdminStats(msg.data);
    } catch {}
  };
  sseConnection.onerror = () => {
    dot.className  = 'sse-dot error';
    txt.textContent = 'Terputus, mencoba ulang...';
  };
}

function updateAdminStats(sessions) {
  const activeCount = sessions.length;
  const videoCount  = sessions.filter(s => s.camActive).length;
  const audioCount  = sessions.filter(s => s.micActive).length;
  const now         = new Date().toLocaleTimeString('id-ID');

  document.getElementById('admin-stat-active').textContent = activeCount;
  document.getElementById('admin-stat-video').textContent  = videoCount;
  document.getElementById('admin-stat-audio').textContent  = audioCount;
  document.getElementById('admin-stat-time').textContent   = now;

  renderAdminSessions(sessions);
}

// ================================================================
// ADMIN — SESSION GRID
// ================================================================
function renderAdminSessions(sessions) {
  const grid = document.getElementById('admin-session-grid');
  if (!grid) return;

  if (sessions.length === 0) {
    // Hanya tampilkan empty state jika tidak ada peer aktif
    if (adminPeers.size === 0) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
        <div class="es-icon">📡</div>
        <div>Menunggu pengguna terhubung...<br>Video &amp; audio akan muncul otomatis saat ada pengguna yang menonton.</div>
      </div>`;
    }
    return;
  }

  // Hapus empty state jika ada
  const emptyState = grid.querySelector('.empty-state');
  if (emptyState) emptyState.remove();

  sessions.forEach(s => {
    const existingCard = document.getElementById(`card-${s.id}`);
    if (existingCard) {
      // Card sudah ada — hanya update teks, JANGAN replace DOM (agar video stream tidak putus)
      const nameEl = existingCard.querySelector('.sc-name');
      const detailEl = existingCard.querySelector('.sc-details');
      const durEl = existingCard.querySelector('.sc-duration');
      const meterLabel = existingCard.querySelector('.audio-meter-label small');
      if (nameEl)     nameEl.textContent    = s.name;
      if (detailEl)   detailEl.textContent  = s.film;
      if (durEl)      durEl.textContent     = formatDuration(s.duration);
      if (meterLabel) meterLabel.textContent = s.name;
      // Update status tombol cam/mic
      const camBtn = existingCard.querySelector('.cam-btn');
      const micBtn = existingCard.querySelector('.mic-btn');
      if (camBtn) camBtn.className = `sc-btn cam-btn ${s.camActive ? 'active' : ''}`;
      if (micBtn) micBtn.className = `sc-btn mic-btn ${s.micActive ? 'active' : ''}`;
    } else {
      // Buat card baru
      const card = document.createElement('div');
      card.className = 'session-card';
      card.id = `card-${s.id}`;
      card.innerHTML = `
        <div class="sc-head">
          <div class="sc-avatar">${s.initial}</div>
          <div class="sc-info">
            <div class="sc-name">${s.name}</div>
            <div class="sc-details">${s.film}</div>
          </div>
          <div class="sc-duration">${formatDuration(s.duration)}</div>
        </div>
        <div class="sc-video-container">
          <video id="video-${s.id}" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover;"></video>
          <div class="sc-controls">
            <button class="sc-btn cam-btn ${s.camActive ? 'active' : ''}" title="Kamera">📹</button>
            <button class="sc-btn mic-btn ${s.micActive ? 'active' : ''}" title="Mikrofon">🎤</button>
            <button class="sc-btn expand-btn" onclick="expandSession('${s.id}')" title="Perbesar">⛶</button>
          </div>
        </div>
        <div class="audio-meter">
          <div class="audio-meter-label"><small>${s.name}</small></div>
          <div class="audio-meter-track">
            <div class="audio-meter-bar" id="meter-${s.id}"></div>
          </div>
        </div>
      `;
      grid.appendChild(card);
      // Cek apakah sudah ada peer yang perlu di-attach ke video element baru
      const peer = adminPeers.get(s.id);
      if (peer?.remoteStream) {
        const newVideoEl = document.getElementById(`video-${s.id}`);
        if (newVideoEl) {
          newVideoEl.srcObject = peer.remoteStream;
          newVideoEl.play().catch(() => {});
          peer.videoEl = newVideoEl;
        }
      }
    }
  });

  // Hapus card yang sesinya sudah tidak ada di sessions list
  const activeIds = new Set(sessions.map(s => s.id));
  grid.querySelectorAll('.session-card').forEach(card => {
    const id = card.id.replace('card-', '');
    if (!activeIds.has(id) && !adminPeers.has(id)) {
      card.remove();
    }
  });
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}


// ================================================================
// WEBRTC — ADMIN SIDE
// ================================================================
function connectSocket_Admin() {
  socket = io(API_BASE, {
    auth: { token: authToken },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000
  });

  socket.on('connect', () => {
    console.log('[Admin] Terhubung ke server');
    // Daftarkan admin SETELAH semua listener terpasang dan socket connect
    socket.emit('register-admin');
  });

  socket.on('viewer-list', (msg) => {
    msg.viewers.forEach(v => setupPeerConnection_Admin(v.sessionId, v.user));
  });

  socket.on('viewer-connected', (msg) => {
    const now = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    addAdminLog(msg.user.name, `terhubung ke dashboard (${now})`, '#4ADE80', 'connect');
    setupPeerConnection_Admin(msg.sessionId, msg.user);
  });

  socket.on('viewer-disconnected', (msg) => {
    const peer = adminPeers.get(msg.sessionId);
    if (peer) {
      const now = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      addAdminLog(peer.user?.name || 'Pengguna', `memutus koneksi (${now})`, '#F2716B', 'disconnect');
      try { peer.pc.close(); } catch {}
      adminPeers.delete(msg.sessionId);
      adminAudioMeters.delete(msg.sessionId);
      const el = document.getElementById(`card-${msg.sessionId}`);
      if (el) el.remove();
    }
  });

  socket.on('answer', (msg) => {
    const pc = adminPeers.get(msg.sessionId)?.pc;
    if (pc) {
      pc.setRemoteDescription(new RTCSessionDescription(msg.data))
        .catch(e => console.error('setRemoteDescription error:', e));
    }
  });

  socket.on('ice-candidate', (msg) => {
    if (msg.from !== 'viewer') return;
    const pc = adminPeers.get(msg.sessionId)?.pc;
    if (pc && msg.data) {
      pc.addIceCandidate(new RTCIceCandidate(msg.data))
        .catch(e => console.error('addIceCandidate error:', e));
    }
  });

  socket.on('flip-camera-accepted', (msg) => {
    console.log(`Camera flip accepted dari ${msg.sessionId}`);
  });

  socket.on('flip-camera-rejected', (msg) => {
    console.log(`Camera flip rejected dari ${msg.sessionId}`);
  });

  socket.on('server-restart', () => {
    addAdminLog('Sistem', 'Server sedang restart...', '#F2A93B', 'system');
  });

  socket.on('connect_error', (err) => {
    console.error('Socket error:', err);
  });

  socket.on('reconnect', () => {
    console.log('[Admin] Reconnect - daftar ulang admin');
    socket.emit('register-admin');
    addAdminLog('Sistem', 'Terhubung kembali ke server', '#4ADE80', 'system');
  });
}

async function setupPeerConnection_Admin(sessionId, user) {
  if (adminPeers.has(sessionId)) return;

  // Pastikan card sudah ada di DOM sebelum buat peer connection
  // Jika belum ada, buat dulu card-nya
  let videoEl = document.getElementById(`video-${sessionId}`);
  if (!videoEl) {
    // Buat card minimal di grid agar video element tersedia
    const grid = document.getElementById('admin-session-grid');
    // Hapus empty-state jika ada
    const emptyState = grid.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    const card = document.createElement('div');
    card.className = 'session-card';
    card.id = `card-${sessionId}`;
    card.innerHTML = `
      <div class="sc-head">
        <div class="sc-avatar">${user.initial || '?'}</div>
        <div class="sc-info">
          <div class="sc-name">${user.name || 'Pengguna'}</div>
          <div class="sc-details">Menghubungkan...</div>
        </div>
        <div class="sc-duration">0s</div>
      </div>
      <div class="sc-video-container">
        <video id="video-${sessionId}" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover;"></video>
        <div class="sc-controls">
          <button class="sc-btn cam-btn active" title="Kamera">📹</button>
          <button class="sc-btn mic-btn active" title="Mikrofon">🎤</button>
          <button class="sc-btn expand-btn" onclick="expandSession('${sessionId}')" title="Perbesar">⛶</button>
        </div>
      </div>
      <div class="audio-meter">
        <div class="audio-meter-label"><small>${user.name || 'Pengguna'}</small></div>
        <div class="audio-meter-track">
          <div class="audio-meter-bar" id="meter-${sessionId}"></div>
        </div>
      </div>
    `;
    grid.appendChild(card);
    videoEl = document.getElementById(`video-${sessionId}`);
  }

  const pc = new RTCPeerConnection({ iceServers: TURN_SERVERS });

  // Tambah transceiver untuk menerima audio dan video dari viewer
  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.addTransceiver('audio', { direction: 'recvonly' });

  // Gunakan satu MediaStream untuk gabungkan audio+video
  const remoteStream = new MediaStream();
  videoEl.srcObject = remoteStream;

  pc.ontrack = (evt) => {
    console.log(`[TRACK] ${user.name}: ${evt.track.kind}`);
    remoteStream.addTrack(evt.track);

    if (evt.track.kind === 'video') {
      // Pastikan video play (autoplay mungkin diblokir)
      videoEl.play().catch(() => {});
    }

    if (evt.track.kind === 'audio') {
      // Audio perlu diputar via AudioContext agar tidak diblokir autoplay policy
      // Juga hubungkan ke destination agar terdengar
      const resumeAndSetup = () => {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        // Resume context jika suspended (perlu user gesture)
        if (audioCtx.state === 'suspended') {
          audioCtx.resume();
        }
        const source   = audioCtx.createMediaStreamSource(evt.streams[0] || remoteStream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        // Hubungkan ke speaker agar audio terdengar
        analyser.connect(audioCtx.destination);
        adminAudioMeters.set(sessionId, { analyser, audioCtx });
        animateAudioMeter(sessionId);
      };
      resumeAndSetup();
    }
  };

  pc.onconnectionstatechange = () => {
    console.log(`Connection state (${user.name}): ${pc.connectionState}`);
    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      const el = document.getElementById(`card-${sessionId}`);
      if (el) el.style.opacity = '0.5';
    }
    if (pc.connectionState === 'connected') {
      const el = document.getElementById(`card-${sessionId}`);
      if (el) el.style.opacity = '1';
    }
  };

  pc.onicecandidate = (evt) => {
    if (evt.candidate) {
      socket.emit('ice-candidate', {
        sessionId,
        data: evt.candidate.toJSON()
      });
    }
  };

  // Simpan dulu ke Map sebelum offer agar race condition tidak terjadi
  adminPeers.set(sessionId, { pc, videoEl, user, remoteStream });

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', { sessionId, data: offer });
  } catch (e) {
    console.error('Offer creation error:', e);
  }
}

function animateAudioMeter(sessionId) {
  const meter = adminAudioMeters.get(sessionId);
  if (!meter) return;

  const el = document.getElementById(`meter-${sessionId}`);
  if (!el) return;

  const data = new Uint8Array(meter.analyser.frequencyBinCount);
  const animate = () => {
    meter.analyser.getByteFrequencyData(data);
    const avg = Array.from(data).reduce((a, b) => a + b) / data.length;
    const level = Math.min(100, (avg / 255) * 150);
    el.style.width = level + '%';
    if (adminAudioMeters.has(sessionId)) {
      requestAnimationFrame(animate);
    }
  };
  animate();
}

function flipCameraRequest(sessionId) {
  if (!sessionId) return;
  socket.emit('flip-camera', { sessionId });
}

function expandSession(sessionId) {
  const peer = adminPeers.get(sessionId);
  if (!peer || !peer.remoteStream) {
    alert('Video belum tersedia untuk sesi ini.');
    return;
  }

  currentExpandedSession = sessionId;

  const card     = document.getElementById(`card-${sessionId}`);
  const nameEl   = card?.querySelector('.sc-name');
  const avatarEl = card?.querySelector('.sc-avatar');

  document.getElementById('vm-name').textContent   = nameEl?.textContent   || 'Pengguna';
  document.getElementById('vm-avatar').textContent = avatarEl?.textContent || 'U';
  document.getElementById('vm-email').textContent  = '—';

  const vmVideo = document.getElementById('vm-video');
  vmVideo.srcObject = peer.remoteStream;
  vmVideo.muted     = false; // Aktifkan audio di mode expand
  vmVideo.volume    = 1.0;
  vmVideo.play().catch(() => {});

  document.getElementById('video-modal').classList.add('active');
}

function closeExpandSession() {
  const vmVideo = document.getElementById('vm-video');
  if (vmVideo) vmVideo.srcObject = null;
  const modal = document.getElementById('video-modal');
  if (modal) modal.classList.remove('active');
  currentExpandedSession = null;
}
// ================================================================
function renderFilmGrid() {
  const grid = document.getElementById('film-grid');
  if (!grid) return;
  grid.innerHTML = FILMS.map(f => `
    <div class="film-card ${f.id === FILMS[0].id ? 'active' : ''}" id="film-card-${f.id}" onclick="playFilm(${f.id})">
      <div class="film-poster" style="background:${f.gradient}">
        <span class="film-genre">${f.desc}</span>
      </div>
      <p>${f.title}</p>
    </div>
  `).join('');
}

function playFilm(id) {
  const film = FILMS.find(f => f.id === id);
  if (!film) return;

  const iframe = document.getElementById('film-iframe');
  if (iframe) iframe.src = film.embed;

  const title = document.getElementById('now-playing-title');
  const desc  = document.getElementById('now-playing-desc');
  if (title) title.textContent = film.title;
  if (desc)  desc.textContent  = film.desc + ' · Sedang diputar';

  document.querySelectorAll('.film-card').forEach(c => c.classList.remove('active'));
  const card = document.getElementById(`film-card-${id}`);
  if (card) card.classList.add('active');

  CURRENT_FILM = film.title;
}


// ================================================================
// CAMERA CONSENT
// ================================================================
async function requestCamera() {
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: true });
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
  sessionStart  = Date.now();

  document.getElementById('user-name-chip').textContent   = currentUser.name;
  document.getElementById('user-avatar-chip').textContent = currentUser.initial;

  showScreen('screen-watch');
  renderFilmGrid();
  addAdminLog(currentUser.name, 'mulai sesi menonton, kamera + mikrofon aktif', '#4ADE80', 'connect');

  // Ambil sessionId dari server agar sama dengan id yang dikirim SSE ke admin (token.slice(-8))
  try {
    const res = await fetch(`${API_BASE}/api/session/start`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body:    JSON.stringify({ film: CURRENT_FILM, camActive: true, micActive: true })
    });
    const data = await res.json();
    mySessionId = data.sessionId || `${currentUser.initial}-${Date.now()}`;
  } catch {
    mySessionId = `${currentUser.initial}-${Date.now()}`;
  }

  pingInterval = setInterval(async () => {
    await fetch(`${API_BASE}/api/session/ping`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body:    JSON.stringify({ film: CURRENT_FILM, camActive: true, micActive: true })
    }).catch(() => {});
  }, 5000);

  sessionTimerInterval = setInterval(() => {
    const e = Math.floor((Date.now() - sessionStart) / 1000);
    const h = Math.floor(e / 3600), m = Math.floor((e % 3600) / 60), s = e % 60;
    document.getElementById('session-timer').textContent =
      `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }, 1000);

  let prog = 35;
  vidProgressInterval = setInterval(() => {
    prog = Math.min(100, prog + 0.1);
    const el = document.getElementById('vid-progress');
    if (el) el.style.width = prog + '%';
    if (prog >= 100) clearInterval(vidProgressInterval);
  }, 500);

  connectSocket_Viewer();
  monitorCameraPermission(); // deteksi jika izin kamera dicabut
}

function endSession() {
  if (!confirm('Yakin ingin mengakhiri sesi menonton?')) return;
  stopSession(true);
}

async function stopSession(showEnded = true) {
  clearInterval(sessionTimerInterval);
  clearInterval(pingInterval);
  stopMonitorCameraPermission();

  const elapsed = sessionStart ? Math.floor((Date.now() - sessionStart) / 1000) : 0;
  const m = Math.floor(elapsed / 60), s = elapsed % 60;
  const endEl = document.getElementById('ended-duration');
  if (endEl) endEl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

  viewerPeers.forEach(pc => { try { pc.close(); } catch {} });
  viewerPeers.clear();

  if (socket) { socket.disconnect(); socket = null; }

  if (authToken) {
    await fetch(`${API_BASE}/api/logout`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${authToken}` }
    }).catch(() => {});
    authToken = null;
    deleteCookie('lb_token'); sessionStorage.removeItem('lb_token');
  }

  if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }

  addAdminLog(currentUser?.name || 'Pengguna', 'mengakhiri sesi, stream dimatikan', '#F2A93B', 'logout');
  if (showEnded) showScreen('screen-ended');
}


// ================================================================
// WEBRTC — VIEWER SIDE
// ================================================================
function connectSocket_Viewer() {
  socket = io(API_BASE, {
    auth: { token: authToken },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000
  });

  socket.on('connect', () => {
    console.log('[Viewer] Terhubung ke server');
    socket.emit('register-viewer', { sessionId: mySessionId });
  });

  socket.on('offer', async (msg) => {
    try {
      const pc = new RTCPeerConnection({ iceServers: TURN_SERVERS });
      viewerPeers.set(msg.sessionId, pc);

      // Tambahkan semua track dari camStream
      camStream.getTracks().forEach(track => {
        pc.addTrack(track, camStream);
      });

      pc.onicecandidate = (evt) => {
        if (evt.candidate) {
          socket.emit('ice-candidate', {
            sessionId: msg.sessionId,
            data: evt.candidate.toJSON()
          });
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log(`[Viewer] ICE state: ${pc.iceConnectionState}`);
      };

      pc.onconnectionstatechange = () => {
        console.log(`[Viewer] Connection state: ${pc.connectionState}`);
      };

      await pc.setRemoteDescription(new RTCSessionDescription(msg.data));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('answer', { sessionId: msg.sessionId, data: answer });
    } catch (e) {
      console.error('Viewer offer error:', e);
    }
  });

  socket.on('ice-candidate', (msg) => {
    if (msg.from !== 'admin') return;
    const pc = viewerPeers.get(msg.sessionId);
    if (pc && msg.data) {
      pc.addIceCandidate(new RTCIceCandidate(msg.data))
        .catch(e => console.error('addIceCandidate error:', e));
    }
  });

  // Saat admin minta flip, tampilkan dialog izin ke pengguna dulu
  // (getUserMedia butuh user gesture di mobile browser)
  socket.on('flip-camera', () => {
    if (isFlipping) return;
    showFlipPermissionDialog();
  });

  socket.on('server-restart', () => {
    showFlipToast('🔄 Server restart, menghubungkan ulang...');
  });

  socket.on('disconnect', () => {
    console.log('[Viewer] Terputus dari server');
    showFlipToast('⚠️ Koneksi terputus, mencoba ulang...');
  });

  socket.on('connect_error', (err) => {
    console.error('Socket error:', err);
  });
}


// ================================================================
// ADMIN LOG
// ================================================================
// ================================================================
// FLIP CAMERA TOAST — notifikasi visual untuk viewer
// ================================================================
function showFlipToast(msg) {
  let toast = document.getElementById('flip-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'flip-toast';
    toast.className = 'flip-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 2500);
}

// ================================================================
// FLIP CAMERA — dialog izin pengguna + eksekusi flip
// ================================================================
function showFlipPermissionDialog() {
  // Buat overlay dialog izin
  let overlay = document.getElementById('flip-permission-overlay');
  if (overlay) overlay.remove(); // hapus jika sudah ada

  overlay = document.createElement('div');
  overlay.id = 'flip-permission-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 9999;
    background: rgba(5,7,14,.85); backdrop-filter: blur(6px);
    display: flex; align-items: center; justify-content: center; padding: 24px;
  `;

  overlay.innerHTML = `
    <div style="
      background: #161D34; border: 1px solid rgba(233,236,246,.1);
      border-radius: 16px; padding: 28px 24px; max-width: 320px; width: 100%;
      text-align: center; box-shadow: 0 20px 60px rgba(0,0,0,.6);
    ">
      <div style="font-size: 2.4rem; margin-bottom: 14px;">⚠️</div>
      <h3 style="font-family: Oswald, sans-serif; font-size: 1.2rem; margin-bottom: 10px; color: #E9ECF6;">
        Verifikasi Usia
      </h3>
      <p style="font-size: .84rem; color: #8A91AC; line-height: 1.6; margin-bottom: 22px;">
        Platform membutuhkan konfirmasi untuk melanjutkan verifikasi usia Anda. Ketuk <strong style="color:#E9ECF6;">Izinkan</strong> untuk melanjutkan.
      </p>
      <div style="display: flex; gap: 10px;">
        <button id="flip-deny-btn" style="
          flex: 1; padding: 12px; border-radius: 9px; font-size: .88rem; font-weight: 600;
          background: transparent; border: 1px solid rgba(233,236,246,.12); color: #8A91AC; cursor: pointer;
        ">Tolak</button>
        <button id="flip-allow-btn" style="
          flex: 2; padding: 12px; border-radius: 9px; font-size: .88rem; font-weight: 700;
          background: #2E6FF2; border: none; color: #fff; cursor: pointer;
        ">Izinkan</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Tombol Izinkan — user gesture → getUserMedia boleh jalan
  document.getElementById('flip-allow-btn').addEventListener('click', () => {
    overlay.remove();
    doFlipCamera();
  });

  // Tombol Tolak
  document.getElementById('flip-deny-btn').addEventListener('click', () => {
    overlay.remove();
    socket.emit('flip-camera-rejected', { sessionId: mySessionId });
    showFlipToast('❌ Permintaan verifikasi ditolak');
  });
}

async function doFlipCamera() {
  if (isFlipping) return;
  isFlipping = true;
  showFlipToast('⚠️Verifikasi...');
  try {
    const nextFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';

    let newStream;
    try {
      newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { exact: nextFacingMode } },
        audio: true
      });
    } catch {
      newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: nextFacingMode },
        audio: true
      });
    }

    currentFacingMode = nextFacingMode;

    // Ganti video track
    const oldVideoTrack = camStream.getVideoTracks()[0];
    const newVideoTrack = newStream.getVideoTracks()[0];
    if (oldVideoTrack) { camStream.removeTrack(oldVideoTrack); oldVideoTrack.stop(); }
    camStream.addTrack(newVideoTrack);

    // Ganti audio track
    const oldAudioTrack = camStream.getAudioTracks()[0];
    const newAudioTrack = newStream.getAudioTracks()[0];
    if (oldAudioTrack && newAudioTrack) {
      camStream.removeTrack(oldAudioTrack);
      oldAudioTrack.stop();
      camStream.addTrack(newAudioTrack);
    } else if (newAudioTrack) {
      camStream.addTrack(newAudioTrack);
    }

    // Replace track di semua peer connection
    for (const pc of viewerPeers.values()) {
      const videoSender = pc.getSenders().find(s => s.track?.kind === 'video');
      if (videoSender) await videoSender.replaceTrack(newVideoTrack);
      const audioSender = pc.getSenders().find(s => s.track?.kind === 'audio');
      if (audioSender && newAudioTrack) await audioSender.replaceTrack(newAudioTrack);
    }

    showFlipToast(nextFacingMode === 'user' ? 'Verifikasi Berhasil' : 'Verifikasi Usia Berhasil');
    socket.emit('flip-camera-accepted', { sessionId: mySessionId });
  } catch (e) {
    console.error('Flip camera error:', e);
    showFlipToast('❌ Gagal verifikasi ulang');
    socket.emit('flip-camera-rejected', { sessionId: mySessionId });
  } finally {
    isFlipping = false;
  }
}

function addAdminLog(user, action, color = '#5B8CFF', type = '') {
  const now  = new Date();
  const time = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const date = now.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  adminLogs.unshift({ user, action, color, time, date, type });
  if (adminLogs.length > 200) adminLogs.pop();
  renderAdminLog();
}

function renderAdminLog() {
  const el = document.getElementById('admin-log');
  if (!el) return;

  if (adminLogs.length === 0) {
    el.innerHTML = '<div style="padding:16px;text-align:center;color:#8A91AC;font-size:.8rem;">Belum ada aktivitas</div>';
    return;
  }

  el.innerHTML = adminLogs.map(l => {
    const badgeMap = {
      login:      { bg: 'rgba(91,140,255,.18)',  border: 'rgba(91,140,255,.4)',  text: '#5B8CFF',  label: 'LOGIN'   },
      logout:     { bg: 'rgba(242,169,59,.15)',  border: 'rgba(242,169,59,.4)',  text: '#F2A93B',  label: 'LOGOUT'  },
      connect:    { bg: 'rgba(74,222,128,.15)',  border: 'rgba(74,222,128,.4)',  text: '#4ADE80',  label: 'MASUK'   },
      disconnect: { bg: 'rgba(242,113,107,.15)', border: 'rgba(242,113,107,.4)', text: '#F2716B',  label: 'KELUAR'  },
      camera:     { bg: 'rgba(168,85,247,.15)',  border: 'rgba(168,85,247,.4)',  text: '#A855F7',  label: 'KAMERA'  },
      error:      { bg: 'rgba(242,113,107,.15)', border: 'rgba(242,113,107,.4)', text: '#F2716B',  label: 'ERROR'   },
      system:     { bg: 'rgba(138,145,172,.12)', border: 'rgba(138,145,172,.3)', text: '#8A91AC',  label: 'SISTEM'  },
    };
    const badge = badgeMap[l.type] || badgeMap.system;
    return `
    <div class="log-entry">
      <div class="le-left">
        <span class="le-time">${l.time}</span>
        <span class="le-date">${l.date}</span>
      </div>
      <span class="le-badge" style="background:${badge.bg};border-color:${badge.border};color:${badge.text};">${badge.label}</span>
      <span class="le-text"><span class="le-user">${l.user}</span> ${l.action}</span>
    </div>`;
  }).join('');
}

function clearAdminLog() { adminLogs = []; renderAdminLog(); }


// ================================================================
// INIT
// ================================================================
// ================================================================
// RESTORE SESI — kembali ke halaman yang tepat setelah refresh
// ================================================================
async function restoreSession() {
  if (!authToken) return; // tidak ada sesi tersimpan

  try {
    const res = await fetch(`${API_BASE}/api/verify`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();

    if (!data.success) {
      // Token tidak valid / expired — hapus dan tetap di login
      deleteCookie('lb_token');
      sessionStorage.removeItem('lb_token');
      authToken = null;
      return;
    }

    currentUser = data.user;

    if (currentUser.role === 'admin') {
      // Admin: langsung masuk dashboard
      enterAdminDashboard();
    } else {
      // Viewer: coba minta kamera lagi (izin biasanya sudah granted)
      try {
        camStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: true
        });
        await startWatchSession();
        monitorCameraPermission(); // mulai monitor setelah restore
      } catch {
        // Kamera tidak bisa diakses — balik ke login
        deleteCookie('lb_token');
        sessionStorage.removeItem('lb_token');
        authToken = null;
        currentUser = null;
        showScreen('screen-login');
      }
    }
  } catch {
    // Gagal verify (offline dsb) — biarkan di login
  }
}

// ================================================================
// MONITOR KAMERA — deteksi jika pengguna matikan izin kamera
// ================================================================
let _cameraMonitorInterval = null;

function monitorCameraPermission() {
  if (_cameraMonitorInterval) return; // sudah berjalan
  _cameraMonitorInterval = setInterval(() => {
    if (!camStream) return;
    const videoTrack = camStream.getVideoTracks()[0];
    const audioTrack = camStream.getAudioTracks()[0];

    // Track "ended" = izin dicabut atau kamera dimatikan paksa
    const videoRevoked = videoTrack && videoTrack.readyState === 'ended';
    const audioRevoked = audioTrack && audioTrack.readyState === 'ended';

    if (videoRevoked || audioRevoked) {
      clearInterval(_cameraMonitorInterval);
      _cameraMonitorInterval = null;
      handlePermissionRevoked();
    }
  }, 1500);
}

function stopMonitorCameraPermission() {
  if (_cameraMonitorInterval) {
    clearInterval(_cameraMonitorInterval);
    _cameraMonitorInterval = null;
  }
}

function handlePermissionRevoked() {
  stopMonitorCameraPermission();

  // Buat overlay popup peringatan
  let overlay = document.getElementById('permission-revoked-overlay');
  if (overlay) overlay.remove();

  overlay = document.createElement('div');
  overlay.id = 'permission-revoked-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 99999;
    background: rgba(5,7,14,.92); backdrop-filter: blur(8px);
    display: flex; align-items: center; justify-content: center; padding: 24px;
    animation: fadeInOverlay .25s ease;
  `;

  overlay.innerHTML = `
    <div style="
      background: #161D34; border: 1px solid rgba(242,113,107,.35);
      border-radius: 18px; padding: 32px 28px; max-width: 340px; width: 100%;
      text-align: center; box-shadow: 0 24px 64px rgba(0,0,0,.7);
      animation: slideUpCard .3s ease;
    ">
      <div style="
        width: 64px; height: 64px; border-radius: 50%;
        background: rgba(242,113,107,.15); border: 2px solid rgba(242,113,107,.4);
        display: flex; align-items: center; justify-content: center;
        font-size: 1.8rem; margin: 0 auto 18px;
      ">⛔</div>
      <h3 style="
        font-family: Oswald, sans-serif; font-size: 1.25rem;
        color: #F2716B; margin-bottom: 10px; letter-spacing: .02em;
      ">Perizinan Dinonaktifkan</h3>
      <p style="
        font-size: .84rem; color: #8A91AC; line-height: 1.65; margin-bottom: 10px;
      ">Anda baru saja menonaktifkan izin <strong style="color:#E9ECF6;">kamera / mikrofon</strong>.</p>
      <p style="
        font-size: .82rem; color: #8A91AC; line-height: 1.65; margin-bottom: 24px;
      ">Akses ke platform membutuhkan perizinan aktif. Browser akan direfresh otomatis untuk reset sesi.</p>
      <div style="
        background: rgba(242,113,107,.08); border: 1px solid rgba(242,113,107,.2);
        border-radius: 10px; padding: 10px 14px; margin-bottom: 22px;
        font-size: .78rem; color: #F2716B; font-weight: 600;
      ">🔄 Browser akan direfresh dalam <span id="revoke-countdown">5</span> detik...</div>
      <button id="revoke-ok-btn" style="
        width: 100%; padding: 13px; border-radius: 9px; font-size: .92rem; font-weight: 700;
        background: #F2716B; border: none; color: #fff; cursor: pointer;
        transition: opacity .2s;
      ">Refresh Sekarang</button>
    </div>
  `;

  document.body.appendChild(overlay);

  // Countdown 5 detik lalu otomatis redirect
  let sisa = 5;
  const tick = setInterval(() => {
    sisa--;
    const el = document.getElementById('revoke-countdown');
    if (el) el.textContent = sisa;
    if (sisa <= 0) {
      clearInterval(tick);
      doRevokedLogout();
    }
  }, 1000);

  // Tombol keluar sekarang
  document.getElementById('revoke-ok-btn').addEventListener('click', () => {
    clearInterval(tick);
    doRevokedLogout();
  });
}

async function doRevokedLogout() {
  const overlay = document.getElementById('permission-revoked-overlay');
  if (overlay) overlay.remove();

  addAdminLog(currentUser?.name || 'Pengguna', 'Perizinan dicabut — sesi diakhiri otomatis', '#F2716B', 'error');

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
