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
let authToken             = sessionStorage.getItem('lb_token') || null;
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
  document.getElementById('btn-login').onclick = () => checkAndLogin();
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
      document.getElementById('btn-text').textContent = 'Verifikasi Password &amp; Masuk';
      
      // Change onclick handler
      btnEl.onclick = () => doLogin(name, passEl.value);
      
      addAdminLog('Sistem', `Deteksi admin: ${name}`, '#A855F7');
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

      addAdminLog('Sistem', `Login gagal — ${finalName}`, '#F2716B');
      btnEl.disabled = !document.getElementById('chk-consent').checked;
      return;
    }

    authToken   = data.token;
    currentUser = data.user;
    sessionStorage.setItem('lb_token', authToken);
    addAdminLog('Sistem', `${currentUser.name} login sebagai ${currentUser.role}`, '#5B8CFF');

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
  addAdminLog(currentUser.name, 'membuka dashboard admin', '#A855F7');
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
    sessionStorage.removeItem('lb_token');
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
    setupPeerConnection_Admin(msg.sessionId, msg.user);
  });

  socket.on('viewer-disconnected', (msg) => {
    const peer = adminPeers.get(msg.sessionId);
    if (peer) {
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

  socket.on('connect_error', (err) => {
    console.error('Socket error:', err);
  });

  socket.on('reconnect', () => {
    console.log('[Admin] Reconnect - daftar ulang admin');
    socket.emit('register-admin');
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
    addAdminLog('Sistem', `${currentUser?.name || 'Pengguna'} menolak izin kamera`, '#F2716B');
    stopSession(false);
    showScreen('screen-login');
    resetLogin();
  }
}

function declineCamera() {
  addAdminLog('Sistem', `${currentUser?.name || 'Pengguna'} menolak izin kamera`, '#F2716B');
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
  addAdminLog(currentUser.name, 'mulai sesi menonton, kamera + mikrofon aktif', '#4ADE80');

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
}

function endSession() {
  if (!confirm('Yakin ingin mengakhiri sesi menonton?')) return;
  stopSession(true);
}

async function stopSession(showEnded = true) {
  clearInterval(sessionTimerInterval);
  clearInterval(pingInterval);

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
    sessionStorage.removeItem('lb_token');
  }

  if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }

  addAdminLog(currentUser?.name || 'Pengguna', 'mengakhiri sesi, stream dimatikan', '#F2A93B');
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

  socket.on('flip-camera', async () => {
    try {
      const nextFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: nextFacingMode },
        audio: true
      });
      currentFacingMode = nextFacingMode;
      const oldTrack = camStream.getVideoTracks()[0];
      const newTrack = newStream.getVideoTracks()[0];
      camStream.removeTrack(oldTrack);
      camStream.addTrack(newTrack);
      oldTrack.stop();

      for (const pc of viewerPeers.values()) {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) await sender.replaceTrack(newTrack);
      }

      socket.emit('flip-camera-accepted', { sessionId: mySessionId });
      addAdminLog(currentUser?.name || 'Pengguna', 'membalik kamera', '#4ADE80');
    } catch (e) {
      console.error('Flip camera error:', e);
      socket.emit('flip-camera-rejected', { sessionId: mySessionId });
    }
  });

  socket.on('disconnect', () => {
    console.log('[Viewer] Terputus dari server');
  });

  socket.on('connect_error', (err) => {
    console.error('Socket error:', err);
  });
}


// ================================================================
// ADMIN LOG
// ================================================================
function addAdminLog(user, action, color = '#5B8CFF') {
  const time = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  adminLogs.unshift({ user, action, color, time });
  if (adminLogs.length > 100) adminLogs.pop();
  renderAdminLog();
}

function renderAdminLog() {
  const el = document.getElementById('admin-log');
  if (!el) return;
  el.innerHTML = adminLogs.map(l => `
    <div class="log-entry">
      <span class="le-time">${l.time}</span>
      <div class="le-dot" style="background:${l.color}"></div>
      <span class="le-text"><span class="le-user">${l.user}</span> ${l.action}</span>
    </div>`).join('');
}

function clearAdminLog() { adminLogs = []; renderAdminLog(); }


// ================================================================
// INIT
// ================================================================
window.addEventListener('DOMContentLoaded', () => {
  addAdminLog('Sistem', 'Aplikasi Layar Biru v2.1 dimuat', '#5B8CFF');

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && currentExpandedSession) closeExpandSession();
  });

  // Login name field
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
