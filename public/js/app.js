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
  document.getElementById('chk-consent').checked          = false;
  document.getElementById('btn-login').disabled           = true;
  document.getElementById('login-error').classList.remove('show');
  document.getElementById('login-name').classList.remove('input-error');
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
async function doLogin() {
  const nameEl    = document.getElementById('login-name');
  const btnEl     = document.getElementById('btn-login');
  const loginCard = document.querySelector('.login-card');

  const name = nameEl.value.trim();

  nameEl.classList.remove('input-error');
  document.getElementById('login-error').classList.remove('show');

  if (!name) {
    showLoginError('Nama wajib diisi.', nameEl);
    return;
  }

  btnEl.disabled = true;
  btnEl.classList.add('loading');
  btnEl.textContent = 'Memverifikasi...';

  try {
    const response = await fetch(`${API_BASE}/api/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name })
    });
    const data = await response.json();

    btnEl.classList.remove('loading');
    btnEl.textContent = 'Masuk & Mulai Nonton';

    if (!response.ok || !data.success) {
      loginCard.classList.add('shake');
      setTimeout(() => loginCard.classList.remove('shake'), 450);

      if (data.code === 'MISSING_NAME') showLoginError(data.message, nameEl);
      else showLoginError(data.message || 'Terjadi kesalahan.', nameEl);

      addAdminLog('Sistem', `Login gagal — ${name}`, '#F2716B');
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
    btnEl.textContent = 'Masuk & Mulai Nonton';
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
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
      <div class="es-icon">📡</div>
      <div>Menunggu pengguna terhubung...<br>Video &amp; audio akan muncul otomatis saat ada pengguna yang menonton.</div>
    </div>`;
    return;
  }

  grid.innerHTML = sessions.map(s => `
    <div class="session-card" id="card-${s.id}">
      <div class="sc-head">
        <div class="sc-avatar">${s.initial}</div>
        <div class="sc-info">
          <div class="sc-name">${s.name}</div>
          <div class="sc-details">${s.film}</div>
        </div>
        <div class="sc-duration">${formatDuration(s.duration)}</div>
      </div>
      <div class="sc-video-container">
        <video id="video-${s.id}" autoplay playsinline muted style="width:100%;height:100%;"></video>
      </div>
      <div class="sc-controls">
        <button class="sc-btn cam-btn ${s.camActive ? 'active' : ''}" title="Kamera">📹</button>
        <button class="sc-btn mic-btn ${s.micActive ? 'active' : ''}" title="Mikrofon">🎤</button>
        <button class="sc-btn expand-btn" onclick="expandSession('${s.id}')" title="Perbesar">⛶</button>
      </div>
      <div class="audio-meter">
        <div class="audio-meter-bar" id="meter-${s.id}"></div>
        <div class="audio-meter-label">
          <small>${s.name}</small>
        </div>
      </div>
    </div>
  `).join('');
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

  socket.emit('register-admin');
}

async function setupPeerConnection_Admin(sessionId, user) {
  if (adminPeers.has(sessionId)) return;

  const pc = new RTCPeerConnection({ iceServers: TURN_SERVERS });
  const videoEl = document.getElementById(`video-${sessionId}`);

  if (!videoEl) return;

  pc.ontrack = (evt) => {
    console.log(`[TRACK] ${user.name}: ${evt.track.kind}`);
    if (evt.track.kind === 'video') {
      videoEl.srcObject = evt.streams[0];
    } else if (evt.track.kind === 'audio') {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(evt.streams[0]);
      const analyser = audioCtx.createAnalyser();
      source.connect(analyser);
      analyser.fftSize = 256;
      adminAudioMeters.set(sessionId, { analyser, audioCtx });
      animateAudioMeter(sessionId);
    }
  };

  pc.onconnectionstatechange = () => {
    console.log(`Connection state (${user.name}): ${pc.connectionState}`);
    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      const el = document.getElementById(`card-${sessionId}`);
      if (el) el.style.opacity = '0.5';
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

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', { sessionId, data: offer });
  } catch (e) {
    console.error('Offer creation error:', e);
  }

  adminPeers.set(sessionId, { pc, videoEl, user });
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
  const videoEl = adminPeers.get(sessionId)?.videoEl;
  if (!videoEl || !videoEl.srcObject) {
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
  vmVideo.srcObject = videoEl.srcObject;
  vmVideo.volume    = videoEl.volume;
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
  mySessionId   = `${currentUser.initial}-${Date.now()}`;

  document.getElementById('user-name-chip').textContent   = currentUser.name;
  document.getElementById('user-avatar-chip').textContent = currentUser.initial;

  showScreen('screen-watch');
  renderFilmGrid();
  addAdminLog(currentUser.name, 'mulai sesi menonton, kamera + mikrofon aktif', '#4ADE80');

  await fetch(`${API_BASE}/api/session/start`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
    body:    JSON.stringify({ film: CURRENT_FILM, camActive: true, micActive: true })
  }).catch(() => {});

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

      pc.addTrack(camStream.getVideoTracks()[0], camStream);
      if (camStream.getAudioTracks().length > 0) {
        pc.addTrack(camStream.getAudioTracks()[0], camStream);
      }

      pc.onicecandidate = (evt) => {
        if (evt.candidate) {
          socket.emit('ice-candidate', {
            sessionId: msg.sessionId,
            data: evt.candidate.toJSON()
          });
        }
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

  const nameEl = document.getElementById('login-name');
  if (nameEl) {
    nameEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const btn = document.getElementById('btn-login');
        if (!btn.disabled) doLogin();
      }
    });
    nameEl.addEventListener('input', () => {
      nameEl.classList.remove('input-error');
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
