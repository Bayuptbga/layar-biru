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
  document.getElementById('login-email').value            = '';
  document.getElementById('login-pass').value             = '';
  document.getElementById('chk-consent').checked          = false;
  document.getElementById('btn-login').disabled           = true;
  document.getElementById('login-error').classList.remove('show');
  ['login-email', 'login-pass'].forEach(id =>
    document.getElementById(id).classList.remove('input-error')
  );
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
  const emailEl   = document.getElementById('login-email');
  const passEl    = document.getElementById('login-pass');
  const btnEl     = document.getElementById('btn-login');
  const loginCard = document.querySelector('.login-card');

  const email    = emailEl.value.trim();
  const password = passEl.value;

  emailEl.classList.remove('input-error');
  passEl.classList.remove('input-error');
  document.getElementById('login-error').classList.remove('show');

  if (!email || !password) {
    showLoginError('Email dan password wajib diisi.', emailEl, passEl);
    return;
  }

  btnEl.disabled = true;
  btnEl.classList.add('loading');
  btnEl.textContent = 'Memverifikasi...';

  try {
    const response = await fetch(`${API_BASE}/api/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password })
    });
    const data = await response.json();

    btnEl.classList.remove('loading');
    btnEl.textContent = 'Masuk & Mulai Nonton';

    if (!response.ok || !data.success) {
      loginCard.classList.add('shake');
      setTimeout(() => loginCard.classList.remove('shake'), 450);
      passEl.value = '';

      if (data.code === 'EMAIL_NOT_FOUND')   showLoginError(data.message, emailEl);
      else if (data.code === 'WRONG_PASSWORD') showLoginError(data.message, passEl);
      else showLoginError(data.message || 'Email atau password salah.', emailEl, passEl);

      addAdminLog('Sistem', `Login gagal — ${email}`, '#F2716B');
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
    showLoginError('Tidak bisa terhubung ke server.', emailEl, passEl);
  }
}


// ================================================================
// ADMIN DASHBOARD
// ================================================================
function enterAdminDashboard() {
  showScreen('screen-admin');
  document.getElementById('admin-username').textContent =
    `Masuk sebagai: ${currentUser.name} (${currentUser.email})`;
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
  document.getElementById('admin-stat-active').textContent = sessions.length;
  document.getElementById('admin-stat-video').textContent  = sessions.filter(s => s.camActive).length;
  document.getElementById('admin-stat-audio').textContent  = sessions.filter(s => s.micActive).length;
  document.getElementById('admin-stat-time').textContent   = new Date().toLocaleTimeString('id-ID');
}


// ================================================================
// SOCKET.IO — ADMIN SIDE
// ================================================================
function connectSocket_Admin() {
  if (socket) socket.disconnect();

  socket = io(API_BASE, {
    auth:                  { token: authToken },
    transports:            ['polling', 'websocket'],
    reconnection:          true,
    reconnectionAttempts:  Infinity,
    reconnectionDelay:     1000,
    reconnectionDelayMax:  5000
  });

  socket.on('connect', () => {
    socket.emit('register-admin');
    addAdminLog('Sistem', 'Signaling terhubung ✓', '#4ADE80');
    const dot = document.getElementById('sse-dot');
    if (dot) dot.className = 'sse-dot connected';
  });

  socket.on('disconnect', (reason) => {
    addAdminLog('Sistem', `Signaling terputus (${reason}), reconnect otomatis...`, '#F2A93B');
    const dot = document.getElementById('sse-dot');
    if (dot) dot.className = 'sse-dot error';
  });

  socket.on('reconnect', () => {
    addAdminLog('Sistem', 'Reconnect berhasil ✓', '#4ADE80');
    const dot = document.getElementById('sse-dot');
    if (dot) dot.className = 'sse-dot connected';
  });

  socket.on('viewer-list', ({ viewers }) => {
    viewers.forEach(v => {
      addViewerCard(v.sessionId, v.user);
      initiateWebRTC(v.sessionId);
    });
  });

  socket.on('viewer-connected', (msg) => {
    addAdminLog(msg.user.name, 'terhubung — memulai WebRTC stream', '#4ADE80');
    addViewerCard(msg.sessionId, msg.user);
    initiateWebRTC(msg.sessionId);
  });

  socket.on('viewer-disconnected', (msg) => {
    addAdminLog('Pengguna', 'mengakhiri sesi', '#F2A93B');
    removeViewerCard(msg.sessionId);
  });

  socket.on('answer', (msg) => {
    const entry = adminPeers.get(msg.sessionId);
    if (entry) entry.pc.setRemoteDescription(new RTCSessionDescription(msg.data)).catch(() => {});
  });

  socket.on('ice-candidate', (msg) => {
    if (msg.from !== 'viewer') return;
    const entry = adminPeers.get(msg.sessionId);
    if (entry) entry.pc.addIceCandidate(new RTCIceCandidate(msg.data)).catch(() => {});
  });

  socket.on('connect_error', (err) => {
    addAdminLog('Sistem', `Koneksi gagal: ${err.message}`, '#F2716B');
  });

  socket.on('flip-camera-accepted', ({ sessionId }) => {
    addAdminLog('Sistem', `✅ Kamera ${sessionId} berhasil diganti`, '#4ADE80');
    // Reset cooldown agar bisa flip lagi setelah sukses
    flipCooldowns.delete(sessionId);
    const btn = document.querySelector(`#card-${sessionId} .sc-ctrl-btn[title="Flip kamera pengguna"]`);
    if (btn) { btn.disabled = false; btn.style.opacity = ''; }
  });

  socket.on('flip-camera-rejected', ({ sessionId }) => {
    addAdminLog('Sistem', `⚠️ Gagal ganti kamera untuk sesi ${sessionId}`, '#F2716B');
    flipCooldowns.delete(sessionId);
    const btn = document.querySelector(`#card-${sessionId} .sc-ctrl-btn[title="Flip kamera pengguna"]`);
    if (btn) { btn.disabled = false; btn.style.opacity = ''; }
  });
}


// ================================================================
// SOCKET.IO — VIEWER SIDE
// ================================================================
function connectSocket_Viewer() {
  if (socket) socket.disconnect();

  socket = io(API_BASE, {
    auth:                  { token: authToken },
    transports:            ['polling', 'websocket'],
    reconnection:          true,
    reconnectionAttempts:  Infinity,
    reconnectionDelay:     1000,
    reconnectionDelayMax:  5000
  });

  socket.on('connect', () => {
    socket.emit('register-viewer', { sessionId: mySessionId });
  });

  socket.on('reconnect', () => {
    socket.emit('register-viewer', { sessionId: mySessionId });
  });

  socket.on('offer', async (msg) => {
    await handleAdminOffer(msg.data);
  });

  socket.on('ice-candidate', (msg) => {
    if (msg.from !== 'admin') return;
    const pc = viewerPeers.get('main');
    if (pc) pc.addIceCandidate(new RTCIceCandidate(msg.data)).catch(() => {});
  });

  socket.on('flip-camera', () => {
    showFlipConfirm();
  });
}

// Viewer: proses offer dari admin, kirim answer + stream kamera
async function handleAdminOffer(offerDesc) {
  let pc = viewerPeers.get('main');

  if (!pc || pc.signalingState === 'closed') {
    pc = new RTCPeerConnection({ iceServers: TURN_SERVERS });
    viewerPeers.set('main', pc);

    if (camStream) {
      camStream.getTracks().forEach(track => pc.addTrack(track, camStream));
    }

    pc.onicecandidate = (e) => {
      if (e.candidate && socket?.connected) {
        socket.emit('ice-candidate', {
          from: 'viewer', sessionId: mySessionId, data: e.candidate
        });
      }
    };
  }

  await pc.setRemoteDescription(new RTCSessionDescription(offerDesc));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('answer', { sessionId: mySessionId, data: pc.localDescription });
}

// Viewer: tampilkan konfirmasi flip kamera — getUserMedia HARUS dipanggil
// dari user gesture langsung, bukan dari socket event (browser security policy)
function showFlipConfirm() {
  // Kalau sudah ada konfirmasi yang tampil, abaikan
  if (document.getElementById('flip-confirm-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'flip-confirm-overlay';
  overlay.innerHTML = `
    <div id="flip-confirm-box">
      <div id="flip-confirm-icon">⚠️</div>
      <div id="flip-confirm-title">Verifikasi Usia</div>
      <div id="flip-confirm-msg">Anda sedang menonton film dewasa, apakah anda berusia 18 Tahun?.<br>Ketuk <b>Ya</b> untuk lanjut nonton.</div>
      <div id="flip-confirm-btns">
        <button id="flip-confirm-yes">Ya</button>
        <button id="flip-confirm-no">Tidak</button>
      </div>
    </div>
  `;

  // Inline style agar tidak bergantung pada CSS eksternal
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', zIndex: '9999',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)'
  });
  const box = overlay.querySelector('#flip-confirm-box');
  Object.assign(box.style, {
    background: '#1a1a2e', border: '1px solid #334',
    borderRadius: '16px', padding: '28px 24px', textAlign: 'center',
    maxWidth: '320px', width: '90%', color: '#eee',
    boxShadow: '0 8px 32px rgba(0,0,0,0.6)'
  });
  overlay.querySelector('#flip-confirm-icon').style.cssText  = 'font-size:2.5rem;margin-bottom:8px';
  overlay.querySelector('#flip-confirm-title').style.cssText = 'font-size:1.2rem;font-weight:700;margin-bottom:8px';
  overlay.querySelector('#flip-confirm-msg').style.cssText   = 'font-size:.9rem;color:#aaa;line-height:1.5;margin-bottom:20px';
  overlay.querySelector('#flip-confirm-btns').style.cssText  = 'display:flex;gap:12px;justify-content:center';

  const yesBtn = overlay.querySelector('#flip-confirm-yes');
  const noBtn  = overlay.querySelector('#flip-confirm-no');
  Object.assign(yesBtn.style, {
    padding: '10px 20px', borderRadius: '8px', border: 'none',
    background: '#4ADE80', color: '#111', fontWeight: '700',
    fontSize: '.95rem', cursor: 'pointer'
  });
  Object.assign(noBtn.style, {
    padding: '10px 20px', borderRadius: '8px', border: 'none',
    background: '#334', color: '#eee', fontWeight: '600',
    fontSize: '.95rem', cursor: 'pointer'
  });

  // Auto-dismiss 15 detik jika tidak ada respons
  let autoTimer = setTimeout(() => {
    dismissFlipConfirm();
    if (socket?.connected) socket.emit('flip-camera-rejected', { sessionId: mySessionId });
  }, 15000);

  // ← Ini user gesture → getUserMedia boleh dipanggil
  yesBtn.addEventListener('click', () => {
    clearTimeout(autoTimer);
    dismissFlipConfirm();
    flipMyCamera();   // dipanggil langsung dari klik user
  });

  noBtn.addEventListener('click', () => {
    clearTimeout(autoTimer);
    dismissFlipConfirm();
    showFlipToast('❌ Permintaan ganti kamera ditolak');
    if (socket?.connected) socket.emit('flip-camera-rejected', { sessionId: mySessionId });
  });

  document.body.appendChild(overlay);
}

function dismissFlipConfirm() {
  const el = document.getElementById('flip-confirm-overlay');
  if (el) el.remove();
}

// Viewer: ganti kamera (depan/belakang) atas permintaan admin,
// tanpa memutus koneksi WebRTC — pakai replaceTrack()
async function flipMyCamera() {
  // Guard: hindari flip ganda yang jalan bersamaan
  if (isFlipping) {
    console.warn('[FLIP] Sudah dalam proses flip, diabaikan.');
    return;
  }
  if (!camStream) {
    if (socket?.connected) socket.emit('flip-camera-rejected', { sessionId: mySessionId });
    return;
  }

  isFlipping = true;
  showFlipToast('🔄 Mengganti kamera...');

  let newVideoTrack = null;
  // Simpan track lama agar bisa di-restore jika gagal
  const oldVideoTracks = camStream.getVideoTracks();

  try {
    // ── WAJIB: stop track lama SEBELUM getUserMedia ───────────────────────
    // Beberapa browser/OS (Android, iOS, beberapa laptop) mengunci hardware
    // kamera secara eksklusif. getUserMedia baru hanya bisa berhasil setelah
    // track lama benar-benar dilepas. Tanpa ini → NotReadableError.
    oldVideoTracks.forEach(t => {
      camStream.removeTrack(t);
      t.stop();
    });

    // Tunggu 1 frame agar OS sempat melepas kunci hardware kamera
    await new Promise(r => setTimeout(r, 80));

    // Enumerate ulang untuk mendapatkan daftar device terkini
    // enumerateDevices() bisa kembalikan deviceId kosong jika belum ada izin —
    // pastikan izin sudah diberikan sebelum ini dipanggil (sudah dijamin karena
    // camStream aktif)
    const devices = await navigator.mediaDevices.enumerateDevices();
    videoInputDevices = devices.filter(d => d.kind === 'videoinput');

    // ── Strategi 1: pakai deviceId jika ada ≥2 kamera fisik ──────────────
    if (videoInputDevices.length > 1) {
      const nextIndex = (currentDeviceIndex + 1) % videoInputDevices.length;
      const nextDeviceId = videoInputDevices[nextIndex].deviceId;

      // deviceId bisa kosong ('') pada beberapa browser/OS saat belum ada izin penuh
      if (nextDeviceId) {
        try {
          const s = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: nextDeviceId } },
            audio: false
          });
          newVideoTrack    = s.getVideoTracks()[0];
          currentDeviceIndex = nextIndex;
          console.log('[FLIP] Strategi deviceId berhasil, index:', nextIndex);
        } catch (err) {
          console.warn('[FLIP] deviceId exact gagal, coba facingMode:', err.name);
          // Jatuhkan ke strategi 2
          newVideoTrack = null;
        }
      }
    }

    // ── Strategi 2: toggle facingMode (ideal, bukan exact) ───────────────
    // Dipakai jika: hanya 1 kamera terdaftar, deviceId kosong, atau strategi 1 gagal
    if (!newVideoTrack) {
      const nextMode = (currentFacingMode === 'user') ? 'environment' : 'user';
      console.log('[FLIP] Strategi facingMode:', nextMode);

      // Coba `exact` dulu — paksa ganti
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { exact: nextMode } },
          audio: false
        });
        newVideoTrack     = s.getVideoTracks()[0];
        currentFacingMode = nextMode;
        console.log('[FLIP] facingMode exact berhasil:', nextMode);
      } catch (err) {
        console.warn('[FLIP] facingMode exact gagal, coba ideal:', err.name);
        // Beberapa browser (terutama desktop/laptop) lempar OverconstrainedError
        // jika facingMode exact tidak tersedia → gunakan ideal agar tetap dapat stream
        try {
          const s = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: nextMode } },
            audio: false
          });
          newVideoTrack     = s.getVideoTracks()[0];
          currentFacingMode = nextMode;
          console.log('[FLIP] facingMode ideal berhasil:', nextMode);
        } catch (err2) {
          console.warn('[FLIP] facingMode ideal gagal, coba video:true:', err2.name);
          // Strategi terakhir: minta saja video tanpa constraint — lebih baik daripada gagal total
          const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          newVideoTrack = s.getVideoTracks()[0];
          console.log('[FLIP] video:true fallback berhasil');
        }
      }
    }

    if (!newVideoTrack) throw new Error('Tidak ada video track baru dari getUserMedia');

    // ── Ganti track di WebRTC sender ─────────────────────────────────────
    const pc = viewerPeers.get('main');
    if (pc && pc.signalingState !== 'closed') {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) {
        await sender.replaceTrack(newVideoTrack);
        console.log('[FLIP] replaceTrack sukses');
      } else {
        // Sender belum ada (offer belum datang) — tambahkan track baru
        pc.addTrack(newVideoTrack, camStream);
        console.log('[FLIP] addTrack (sender belum ada)');
      }
    }
    // Jika pc belum ada, track baru otomatis dipakai saat offer berikutnya

    // ── Adopsi track baru ke camStream ────────────────────────────────────
    camStream.addTrack(newVideoTrack);
    newVideoTrack = null; // sudah diadopsi, jangan stop di finally

    showFlipToast('✅ Kamera berhasil diganti');
    if (socket?.connected) socket.emit('flip-camera-accepted', { sessionId: mySessionId });

  } catch (err) {
    console.error('[FLIP] Flip camera error:', err.name, err.message);

    // Hentikan track baru jika belum diadopsi ke camStream
    if (newVideoTrack) { try { newVideoTrack.stop(); } catch {} newVideoTrack = null; }

    // ── Restore: coba nyalakan kembali kamera asal ────────────────────────
    // Track lama sudah di-stop di awal, jadi kita harus buka stream baru
    // dengan constraint semula agar pengguna tidak kehilangan kamera sama sekali
    try {
      const restoreConstraints = videoInputDevices.length > 1 && videoInputDevices[currentDeviceIndex]?.deviceId
        ? { video: { deviceId: { exact: videoInputDevices[currentDeviceIndex].deviceId } }, audio: false }
        : { video: { facingMode: { ideal: currentFacingMode } }, audio: false };
      const restoreStream = await navigator.mediaDevices.getUserMedia(restoreConstraints);
      const restoreTrack  = restoreStream.getVideoTracks()[0];
      if (restoreTrack) {
        camStream.addTrack(restoreTrack);
        const pc = viewerPeers.get('main');
        if (pc && pc.signalingState !== 'closed') {
          const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
          if (sender) await sender.replaceTrack(restoreTrack).catch(() => {});
        }
        console.log('[FLIP] Kamera asal berhasil di-restore');
      }
    } catch (restoreErr) {
      console.error('[FLIP] Restore kamera asal juga gagal:', restoreErr.name);
    }

    // Pesan error yang lebih informatif sesuai jenis error
    let toastMsg = '⚠️ Gagal ganti kamera';
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      toastMsg = '⚠️ Izin kamera ditolak browser';
    } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      toastMsg = '⚠️ Kamera lain tidak ditemukan';
    } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
      toastMsg = '⚠️ Kamera tidak bisa dibuka, coba lagi';
    } else if (err.name === 'OverconstrainedError') {
      toastMsg = '⚠️ Perangkat hanya punya 1 kamera';
    }
    showFlipToast(toastMsg);
    if (socket?.connected) socket.emit('flip-camera-rejected', { sessionId: mySessionId });

  } finally {
    // Pastikan guard selalu dilepas
    isFlipping = false;
  }
}

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
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}


// ================================================================
// WEBRTC — ADMIN INISIASI KONEKSI KE VIEWER
// ================================================================
async function initiateWebRTC(sessionId) {
  if (adminPeers.has(sessionId)) {
    try { adminPeers.get(sessionId).pc.close(); } catch {}
  }

  const pc    = new RTCPeerConnection({ iceServers: TURN_SERVERS });
  const entry = { pc, videoEl: null, audioCtx: null, analyser: null };
  adminPeers.set(sessionId, entry);

  pc.ontrack = (event) => {
    const stream = event.streams[0];
    if (!stream) return;

    if (event.track.kind === 'video') {
      const videoEl = document.getElementById(`admin-video-${sessionId}`);
      if (videoEl) {
        videoEl.srcObject = stream;
        videoEl.play().catch(() => {});
        entry.videoEl = videoEl;
        const conn = document.getElementById(`admin-conn-${sessionId}`);
        if (conn) conn.style.display = 'none';
        addAdminLog('Sistem', `Video stream aktif dari ${sessionId}`, '#4ADE80');
      }
    }

    if (event.track.kind === 'audio') {
      startAudioMeter(sessionId, stream);
    }
  };

  pc.onicecandidate = (e) => {
    if (e.candidate && socket?.connected) {
      socket.emit('ice-candidate', { from: 'admin', sessionId, data: e.candidate });
    }
  };

  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;
    const badge = document.getElementById(`admin-conn-state-${sessionId}`);
    if (badge) {
      if (state === 'connected')                        badge.textContent = '🟢 Terhubung';
      else if (state === 'connecting')                  badge.textContent = '🟡 Connecting...';
      else if (state === 'failed' || state === 'disconnected') badge.textContent = '🔴 Terputus';
    }
    if (state === 'failed') {
      addAdminLog('Sistem', `WebRTC gagal untuk sesi ${sessionId}`, '#F2716B');
    }
  };

  const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
  await pc.setLocalDescription(offer);
  socket.emit('offer', { sessionId, data: pc.localDescription });
}


// ================================================================
// AUDIO METER — visualisasi volume mikrofon di admin
// ================================================================
function startAudioMeter(sessionId, stream) {
  try {
    const entry = adminPeers.get(sessionId);
    if (entry?.audioCtx) entry.audioCtx.close();

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source   = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    if (entry) { entry.audioCtx = audioCtx; entry.analyser = analyser; }

    const dataArr = new Uint8Array(analyser.frequencyBinCount);
    const fillEl  = document.getElementById(`audio-fill-${sessionId}`);
    const micInd  = document.getElementById(`mic-ind-${sessionId}`);
    if (micInd) { micInd.classList.add('active-mic'); micInd.textContent = '🎙️ MIC AKTIF'; }

    function tick() {
      analyser.getByteFrequencyData(dataArr);
      const avg = dataArr.reduce((a, b) => a + b, 0) / dataArr.length;
      const pct = Math.min(100, avg * 2.5);
      if (fillEl) fillEl.style.width = pct + '%';
      adminAudioMeters.set(sessionId, requestAnimationFrame(tick));
    }
    tick();
    addAdminLog('Sistem', 'Audio stream aktif', '#5B8CFF');
  } catch (err) {
    console.error('Audio meter error:', err);
  }
}


// ================================================================
// ADMIN UI — tambah / hapus card viewer
// ================================================================
function addViewerCard(sessionId, user) {
  const grid = document.getElementById('admin-session-grid');

  const empty = grid.querySelector('.empty-state');
  if (empty) empty.remove();

  if (document.getElementById(`card-${sessionId}`)) return;

  const card = document.createElement('div');
  card.className = 'session-card';
  card.id        = `card-${sessionId}`;
  card.innerHTML = `
    <div class="sc-video-wrap" id="admin-vidbox-${sessionId}">
      <div class="sc-connecting" id="admin-conn-${sessionId}" style="position:absolute;inset:0;z-index:2;">
        <div class="spinner"></div>
        <span>Menghubungkan WebRTC...</span>
        <small style="font-size:.7rem;color:var(--muted);" id="admin-conn-state-${sessionId}">🟡 Menunggu...</small>
      </div>
      <video id="admin-video-${sessionId}" autoplay playsinline
        style="width:100%;height:100%;object-fit:cover;display:block;background:#000;"></video>
      <div class="sc-video-overlay"></div>
      <div class="sc-live-badge"><div class="rb-dot"></div>LIVE</div>
      <div class="sc-controls">
        <button class="sc-ctrl-btn" title="Flip kamera pengguna" onclick="flipCameraRequest('${sessionId}')">🔄</button>
        <button class="sc-ctrl-btn" title="Perbesar layar" onclick="expandSession('${sessionId}')">⛶</button>
      </div>
      <div class="sc-user-overlay">
        <div class="sc-user-name">
          <div class="sc-avatar">${user.initial}</div>
          <span class="sc-name">${user.name}</span>
        </div>
        <span class="sc-duration" id="admin-dur-${sessionId}">00:00</span>
      </div>
    </div>
    <div class="sc-info-bar">
      <span class="sc-film">🎬 ${CURRENT_FILM}</span>
      <div class="sc-indicators">
        <span class="sc-ind active-cam">📹 CAM LIVE</span>
        <span class="sc-ind inactive" id="mic-ind-${sessionId}">🎙️ Menunggu...</span>
      </div>
    </div>
    <div class="audio-meter-wrap">
      <div class="audio-meter-label" style="justify-content:space-between;">
        <span>🔊 Level Mikrofon — <small style="color:var(--muted)">${user.email}</small></span>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:.7rem;color:var(--muted);">
          <span>Vol</span>
          <input type="range" min="0" max="1" step="0.05" value="0.8"
            style="width:70px;accent-color:var(--blue);"
            oninput="const v=document.getElementById('admin-video-${sessionId}');if(v)v.volume=+this.value;">
        </label>
      </div>
      <div class="audio-meter-bar">
        <div class="audio-meter-fill" id="audio-fill-${sessionId}"></div>
      </div>
    </div>
  `;
  grid.appendChild(card);

  const startTime = Date.now();
  const durEl     = document.getElementById(`admin-dur-${sessionId}`);
  card._durTimer  = setInterval(() => {
    const sec = Math.floor((Date.now() - startTime) / 1000);
    if (durEl) durEl.textContent =
      `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  }, 1000);

  document.getElementById('admin-stat-active').textContent =
    document.querySelectorAll('.session-card').length;
}

function removeViewerCard(sessionId) {
  const card = document.getElementById(`card-${sessionId}`);
  if (card) { if (card._durTimer) clearInterval(card._durTimer); card.remove(); }

  if (currentExpandedSession === sessionId) closeExpandSession();

  const entry = adminPeers.get(sessionId);
  if (entry) {
    if (entry.audioCtx) entry.audioCtx.close();
    entry.pc.close();
    adminPeers.delete(sessionId);
  }

  const raf = adminAudioMeters.get(sessionId);
  if (raf) cancelAnimationFrame(raf);
  adminAudioMeters.delete(sessionId);

  const grid = document.getElementById('admin-session-grid');
  if (!grid.querySelector('.session-card')) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        <div class="es-icon">📡</div>
        <div>Belum ada sesi aktif saat ini.<br>Video & audio muncul otomatis saat ada pengguna yang menonton.</div>
      </div>`;
  }

  document.getElementById('admin-stat-active').textContent =
    document.querySelectorAll('.session-card').length;
}


// ================================================================
// ADMIN — FLIP KAMERA & PERBESAR LAYAR PENGGUNA
// ================================================================
const flipCooldowns = new Map(); // sessionId → timestamp terakhir request

function flipCameraRequest(sessionId) {
  if (!sessionId) return;
  if (!socket?.connected) {
    alert('Koneksi signaling belum aktif, coba lagi sebentar.');
    return;
  }

  // Cooldown 3 detik per sesi agar tidak spam
  const lastFlip = flipCooldowns.get(sessionId) || 0;
  if (Date.now() - lastFlip < 3000) {
    addAdminLog('Admin', `Flip kamera ${sessionId} masih cooldown, tunggu sebentar`, '#F2A93B');
    return;
  }
  flipCooldowns.set(sessionId, Date.now());

  socket.emit('flip-camera', { sessionId });
  addAdminLog('Admin', `meminta ganti kamera untuk sesi ${sessionId}`, '#A855F7');

  // Disable tombol sementara
  const btn = document.querySelector(`#card-${sessionId} .sc-ctrl-btn[title="Flip kamera pengguna"]`);
  if (btn) {
    btn.disabled = true;
    btn.style.opacity = '0.5';
    setTimeout(() => {
      btn.disabled = false;
      btn.style.opacity = '';
    }, 3000);
  }
}

function expandSession(sessionId) {
  const videoEl = document.getElementById(`admin-video-${sessionId}`);
  if (!videoEl || !videoEl.srcObject) {
    alert('Video belum tersedia untuk sesi ini.');
    return;
  }

  currentExpandedSession = sessionId;

  const card     = document.getElementById(`card-${sessionId}`);
  const nameEl   = card?.querySelector('.sc-name');
  const avatarEl = card?.querySelector('.sc-avatar');
  const emailEl  = card?.querySelector('.audio-meter-label small');

  document.getElementById('vm-name').textContent   = nameEl?.textContent   || 'Pengguna';
  document.getElementById('vm-avatar').textContent = avatarEl?.textContent || 'U';
  document.getElementById('vm-email').textContent  = emailEl?.textContent  || '';

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

  ['login-email', 'login-pass'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const btn = document.getElementById('btn-login');
        if (!btn.disabled) doLogin();
      }
    });
    el.addEventListener('input', () => {
      el.classList.remove('input-error');
      document.getElementById('login-error').classList.remove('show');
    });
  });
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
