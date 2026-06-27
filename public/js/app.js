// ================================================================
// LAYAR BIRU — app.js (FIXED VERSION)
// ================================================================
// CATATAN: Hanya bagian yang di-fix ditampilkan di sini
// Untuk implementasi, copy bagian yang sesuai ke file app.js asli Anda

// ================================================================
// FIX #1: startWatchSession() — Move mySessionId init before socket
// ================================================================

// GANTI SELURUH FUNCTION INI (baris 831-880 di app.js asli):

async function startWatchSession() {
  sessionStart  = Date.now();

  document.getElementById('user-name-chip').textContent   = currentUser.name;
  document.getElementById('user-avatar-chip').textContent = currentUser.initial;

  showScreen('screen-watch');
  await loadFilmsFromAPI();
  renderFilmGrid();
  addAdminLog(currentUser.name, 'mulai sesi menonton, kamera + mikrofon aktif', '#4ADE80', 'connect');

  // ✅ FIX: SET mySessionId DULU sebelum connectSocket_Viewer()
  // Ini mencegah race condition di mana socket emit register-viewer dengan mySessionId null
  try {
    const res = await fetch(`${API_BASE}/api/session/start`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body:    JSON.stringify({ film: CURRENT_FILM, camActive: true, micActive: true })
    });
    const data = await res.json();
    mySessionId = data.sessionId || `${currentUser.initial}-${Date.now()}`;
    console.log('[Watch] Session started with ID:', mySessionId);
  } catch (e) {
    console.error('Session start error:', e);
    mySessionId = `${currentUser.initial}-${Date.now()}`;
  }

  // ✅ FIX: SEKARANG connect socket dengan mySessionId yang sudah valid
  connectSocket_Viewer();

  // Ping interval untuk keep-alive
  pingInterval = setInterval(async () => {
    await fetch(`${API_BASE}/api/session/ping`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body:    JSON.stringify({ film: CURRENT_FILM, camActive: true, micActive: true })
    }).catch(() => {});
  }, 5000);

  // Session timer display
  sessionTimerInterval = setInterval(() => {
    const e = Math.floor((Date.now() - sessionStart) / 1000);
    const h = Math.floor(e / 3600), m = Math.floor((e % 3600) / 60), s = e % 60;
    document.getElementById('session-timer').textContent =
      `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }, 1000);

  // Video progress bar animation
  let prog = 35;
  vidProgressInterval = setInterval(() => {
    prog = Math.min(100, prog + 0.1);
    const el = document.getElementById('vid-progress');
    if (el) el.style.width = prog + '%';
    if (prog >= 100) clearInterval(vidProgressInterval);
  }, 500);

  // Monitor jika user cabut izin kamera
  monitorCameraPermission();
}


// ================================================================
// FIX #2: doFlipCamera() — Tambah timeout & better error handling
// ================================================================

// GANTI SELURUH FUNCTION INI (baris 1078-1134 di app.js asli):

async function doFlipCamera() {
  if (isFlipping) return;
  isFlipping = true;
  showFlipToast('Memverify usia anda...');
  
  const TIMEOUT_MS = 20000; // 20 detik timeout untuk getUserMedia
  let timeoutId = null;
  
  try {
    // ✅ FIX: Buat timeout promise untuk menghandle getUserMedia yang hang
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error('getUserMedia timeout - Harap izinkan akses kamera dalam 20 detik'));
      }, TIMEOUT_MS);
    });

    const nextFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';

    let newStream;
    try {
      // ✅ FIX: Race between getUserMedia dan timeout
      newStream = await Promise.race([
        navigator.mediaDevices.getUserMedia({
          video: { facingMode: { exact: nextFacingMode } },
          audio: true
        }),
        timeoutPromise
      ]);
    } catch (e) {
      // Kalau timeout atau exact facingMode tidak support, fallback
      if (timeoutId) clearTimeout(timeoutId);
      
      console.warn('First getUserMedia attempt failed, trying fallback:', e.message);
      
      newStream = await Promise.race([
        navigator.mediaDevices.getUserMedia({
          video: { facingMode: nextFacingMode },
          audio: true
        }),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Fallback timeout')), TIMEOUT_MS);
        })
      ]);
    }

    // ✅ FIX: Clear timeout setelah getUserMedia sukses
    if (timeoutId) clearTimeout(timeoutId);

    currentFacingMode = nextFacingMode;

    // ✅ FIX: SAFER video track replacement
    const oldVideoTrack = camStream.getVideoTracks()[0];
    const newVideoTrack = newStream.getVideoTracks()[0];
    
    if (!newVideoTrack) {
      throw new Error('Tidak ada video track dari device');
    }

    if (oldVideoTrack) {
      camStream.removeTrack(oldVideoTrack);
      oldVideoTrack.stop();
    }
    camStream.addTrack(newVideoTrack);

    // ✅ FIX: SAFER audio track replacement
    // Cek apakah track sudah ada sebelum add/remove untuk mencegah duplicate
    const oldAudioTrack = camStream.getAudioTracks()[0];
    const newAudioTrack = newStream.getAudioTracks()[0];
    
    if (newAudioTrack) {
      if (oldAudioTrack) {
        // Verify track masih ada di stream sebelum remove
        if (camStream.getTracks().includes(oldAudioTrack)) {
          camStream.removeTrack(oldAudioTrack);
          oldAudioTrack.stop();
        }
      }
      // Cek apakah track sudah ada di stream sebelum add (prevent duplicate)
      if (!camStream.getTracks().includes(newAudioTrack)) {
        camStream.addTrack(newAudioTrack);
      }
    }

    // Replace track di semua peer connection dengan error handling
    for (const pc of viewerPeers.values()) {
      try {
        const videoSender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (videoSender) {
          await videoSender.replaceTrack(newVideoTrack).catch(e => {
            console.warn('Video sender replace error:', e.message);
          });
        }
        
        const audioSender = pc.getSenders().find(s => s.track?.kind === 'audio');
        if (audioSender && newAudioTrack) {
          await audioSender.replaceTrack(newAudioTrack).catch(e => {
            console.warn('Audio sender replace error:', e.message);
          });
        }
      } catch (e) {
        console.error('Peer track replacement error:', e);
      }
    }

    showFlipToast(nextFacingMode === 'user' ? 'Verify Berhasil' : 'Terverifikasi 18 Tahun');
    socket.emit('flip-camera-accepted', { sessionId: mySessionId });
  } catch (e) {
    console.error('Flip camera error:', e);
    const errorMsg = e.message || 'Gagal verify';
    showFlipToast(`❌ ${errorMsg}`);
    socket.emit('flip-camera-rejected', { sessionId: mySessionId });
  } finally {
    isFlipping = false;
  }
}


// ================================================================
// HELPER: showFlipToast (no changes, tapi included for reference)
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
// HELPER: showFlipPermissionDialog (no changes, tapi included for reference)
// ================================================================

function showFlipPermissionDialog() {
  let overlay = document.getElementById('flip-permission-overlay');
  if (overlay) overlay.remove();

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
        Verifikasi Usia Anda
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

  document.getElementById('flip-allow-btn').addEventListener('click', () => {
    overlay.remove();
    doFlipCamera();
  });

  document.getElementById('flip-deny-btn').addEventListener('click', () => {
    overlay.remove();
    socket.emit('flip-camera-rejected', { sessionId: mySessionId });
    showFlipToast('❌ Permintaan verifikasi ditolak');
  });
}

