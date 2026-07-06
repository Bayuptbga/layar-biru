// ================================================================
// APP.JS MODIFICATIONS — Untuk Google Drive Support
// ================================================================
// TAMBAHKAN KODE INI KE APP.JS ANDA
// Letakkan setelah DOM ready dan sebelum renderFilmGrid()

// ================================================================
// 1. LOAD GOOGLE DRIVE VIDEOS SAAT INISIALISASI
// ================================================================
// Tambahkan ini di window load event (dalam DOMContentLoaded)

async function initializeFilms() {
  // Load films dari Google Drive
  await loadGoogleDriveVideos();
  
  // Render film grid
  renderFilmGrid();
  
  // Jika sudah login, load dari API juga
  if (authToken) {
    await loadFilmsFromAPI();
  }
}

// ================================================================
// 2. MODIFY SELECTFILM FUNCTION
// ================================================================
// GANTI function selectFilm di app.js dengan yang ini:

function selectFilm(film) {
  if (!camStream) {
    alert('Kamera tidak aktif!');
    return;
  }
  
  CURRENT_FILM = film.title;
  
  // Determine video source
  let videoSource = film.embed || film.playUrl || '';
  
  // Jika dari Google Drive, gunakan preview link
  if (film.gdriveFileId) {
    videoSource = `https://drive.google.com/file/d/${film.gdriveFileId}/preview`;
  }
  
  // Set iframe src
  const iframe = document.getElementById('film-iframe');
  if (iframe) {
    iframe.src = videoSource;
    
    // Tambah sandbox attribute untuk Google Drive preview
    if (film.gdriveFileId) {
      iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-popups allow-forms');
    }
  }
  
  // Update title dan desc
  document.getElementById('now-playing-title').textContent = film.title;
  document.getElementById('now-playing-desc').textContent = film.desc;
  
  // Notify server
  if (socket) {
    socket.emit('film-selected', {
      film: film.title,
      videoId: film.videoId,
      source: film.gdriveFileId ? 'google-drive' : 'embedded'
    });
  }
  
  addAdminLog(currentUser?.name || 'User', `Menonton: ${film.title}`, '#2E6FF2', 'info');
}

// ================================================================
// 3. ALTERNATIVE: HTML5 VIDEO PLAYER (untuk direct playback)
// ================================================================
// Jika ingin playback langsung tanpa iframe, gunakan ini:

function selectFilmWithHTML5(film) {
  if (!camStream) {
    alert('Kamera tidak aktif!');
    return;
  }
  
  CURRENT_FILM = film.title;
  
  // Create/update video element
  let videoContainer = document.getElementById('video-player-container');
  if (!videoContainer) {
    videoContainer = document.createElement('div');
    videoContainer.id = 'video-player-container';
    videoContainer.style.cssText = 'width:100%;height:100%;background:black;display:flex;align-items:center;justify-content:center;';
    
    const iframeEl = document.getElementById('film-iframe');
    if (iframeEl) {
      iframeEl.parentElement.appendChild(videoContainer);
    }
  }
  
  // Untuk Google Drive, gunakan preview dalam iframe
  if (film.gdriveFileId) {
    const previewUrl = `https://drive.google.com/file/d/${film.gdriveFileId}/preview`;
    
    // Create iframe
    const iframe = document.createElement('iframe');
    iframe.src = previewUrl;
    iframe.style.cssText = 'width:100%;height:100%;border:none;';
    iframe.setAttribute('allowfullscreen', 'true');
    iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-popups allow-forms');
    
    videoContainer.innerHTML = '';
    videoContainer.appendChild(iframe);
  }
  
  // Update title
  document.getElementById('now-playing-title').textContent = film.title;
  document.getElementById('now-playing-desc').textContent = film.desc;
  
  // Notify server
  if (socket) {
    socket.emit('film-selected', {
      film: film.title,
      videoId: film.videoId,
      source: 'google-drive'
    });
  }
  
  addAdminLog(currentUser?.name || 'User', `Menonton: ${film.title}`, '#2E6FF2', 'info');
}

// ================================================================
// 4. SUBMIT ADD FILM - SUPPORT GOOGLE DRIVE
// ================================================================
// MODIFY submitAddFilm() dengan ini:

async function submitAddFilm() {
  const title   = document.getElementById('af-title').value.trim();
  const desc    = document.getElementById('af-desc').value.trim();
  const videoId = document.getElementById('af-videoid').value.trim();
  const thumb   = document.getElementById('af-thumb').value.trim();
  const source  = document.getElementById('af-source')?.value || 'embedded'; // New field
  const errEl   = document.getElementById('af-error');
  const btn     = document.getElementById('af-submit-btn');

  errEl.style.display = 'none';

  if (!title || !desc || !videoId || !thumb) {
    errEl.textContent = 'Semua field wajib diisi.';
    errEl.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Menyimpan...';

  try {
    let filmData = { title, desc, videoId, thumb, source };
    
    // Jika Google Drive, format URL-nya
    if (source === 'google-drive') {
      filmData.gdriveFileId = videoId;
      filmData.embed = `https://drive.google.com/file/d/${videoId}/preview`;
      filmData.playUrl = `https://drive.google.com/uc?id=${videoId}&export=download`;
    }
    
    const res  = await fetch(`${API_BASE}/api/films`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body:    JSON.stringify(filmData)
    });
    const data = await res.json();

    if (!data.success) {
      errEl.textContent = data.message || 'Gagal menyimpan film.';
      errEl.style.display = 'block';
      return;
    }

    FILMS.push(data.film);
    renderFilmGrid();
    closeAddFilmModal();
    addAdminLog('Admin', `Film ditambahkan: ${title}`, '#5B8CFF', 'info');

  } catch (err) {
    errEl.textContent = 'Tidak bisa terhubung ke server.';
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Tambah Film';
  }
}

// ================================================================
// 5. CALL INISIALISASI DI DOMContentLoaded
// ================================================================
// Tambahkan ini di bagian event listeners (dekat dengan yang lain):
/*
document.addEventListener('DOMContentLoaded', async () => {
  // ... kode lain ...
  
  // TAMBAHKAN INI:
  await initializeFilms();
  
  // ... kode lain ...
});
*/

// ================================================================
// 6. UPDATE OPENADDFILMMODAL (Optional - add source selector)
// ================================================================
// Tambahkan HTML untuk memilih sumber di modal:
/*
<div class="form-group">
  <label>Sumber Video</label>
  <select id="af-source">
    <option value="embedded">URL Embed</option>
    <option value="google-drive">Google Drive</option>
  </select>
</div>
*/
