// ================================================================
// FILMS DATA — films.js
// ================================================================
// File ini mendukung 2 mode:
// 1. DEFAULT FILMS - Video embed lokal (fallback)
// 2. GDRIVE FILMS - Video dari Google Drive (primary)

// Konfigurasi Google Drive
const GDRIVE_CONFIG = {
  API_KEY: 'AIzaSyB8MY-5lLPOirCFvXO8qEwHgY5zntv0m4c',
  FOLDER_ID: '1RjxjqHRT6X9sU8rH87pfzz6hr-VlKet-',
  ENABLED: true // Set ke false untuk pakai DEFAULT FILMS saja
};

// ================================================================
// DEFAULT FILMS (Fallback)
// ================================================================
const DEFAULT_FILMS = [
  {
    id: 1,
    title: 'Sample Video 1',
    desc: 'Example Video',
    videoId: 'sample1',
    thumb: 'https://via.placeholder.com/300x400?text=Video+1',
    embed: 'https://www.youtube.com/embed/dQw4w9WgXcQ', // Replace dengan URL embed Anda
    gradient: 'linear-gradient(135deg,#1a1a2e,#16213e)',
    duration: '1h 30m'
  },
  {
    id: 2,
    title: 'Sample Video 2',
    desc: 'Example Video',
    videoId: 'sample2',
    thumb: 'https://via.placeholder.com/300x400?text=Video+2',
    embed: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
    gradient: 'linear-gradient(135deg,#0f3460,#533483)',
    duration: '1h 30m'
  }
];

// FILMS array - akan diisi dari Google Drive atau DEFAULT
let FILMS = DEFAULT_FILMS.map(f => ({...f}));

// ================================================================
// FETCH VIDEOS DARI GOOGLE DRIVE
// ================================================================
async function loadGoogleDriveVideos() {
  if (!GDRIVE_CONFIG.ENABLED) {
    console.log('[FILMS] Google Drive disabled, using DEFAULT_FILMS');
    return;
  }

  try {
    console.log('[FILMS] Fetching videos from Google Drive...');
    
    // Query: cari file video di folder yang sudah di-share
    const query = encodeURIComponent(`'${GDRIVE_CONFIG.FOLDER_ID}' in parents and (mimeType='video/mp4' or mimeType='video/quicktime' or mimeType='video/x-msvideo' or mimeType='video/x-matroska' or mimeType='video/webm' or mimeType='video/mpeg') and trashed=false`);
    
    const url = `https://www.googleapis.com/drive/v3/files?q=${query}&key=${GDRIVE_CONFIG.API_KEY}&fields=files(id,name,mimeType,size,createdTime,thumbnailLink)&pageSize=1000&orderBy=createdTime desc`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (data.error) {
      console.error('[FILMS] Google Drive API error:', data.error);
      return;
    }
    
    if (!data.files || data.files.length === 0) {
      console.warn('[FILMS] Tidak ada video di Google Drive, menggunakan DEFAULT_FILMS');
      return;
    }
    
    // Clear FILMS dan isi dengan video dari Google Drive
    FILMS.length = 0;
    
    data.files.forEach((file, index) => {
      const title = file.name.replace(/\.[^.]+$/, ''); // Hapus extension
      const fileSize = formatFileSizeHelper(file.size);
      const gradient = GRADIENTS_POOL[index % GRADIENTS_POOL.length];
      
      FILMS.push({
        id: index + 1,
        title: title,
        desc: fileSize,
        videoId: file.id,
        gdriveFileId: file.id,
        thumb: file.thumbnailLink || 'https://via.placeholder.com/300x400?text=Video',
        
        // 3 jenis link untuk flexibility
        embed: `https://drive.google.com/file/d/${file.id}/preview`, // Preview (safest)
        playUrl: `https://drive.google.com/uc?id=${file.id}&export=download`, // Download
        streamUrl: `https://drive.google.com/file/d/${file.id}/preview`, // Stream
        
        gradient: gradient,
        duration: 'Google Drive'
      });
    });
    
    console.log(`[FILMS] Loaded ${FILMS.length} videos from Google Drive`);
    
  } catch (err) {
    console.error('[FILMS] Error loading from Google Drive:', err.message);
    console.log('[FILMS] Falling back to DEFAULT_FILMS');
    FILMS = DEFAULT_FILMS.map(f => ({...f}));
  }
}

// ================================================================
// HELPER FUNCTIONS
// ================================================================

function formatFileSizeHelper(bytes) {
  if (!bytes) return 'Unknown size';
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + ' ' + sizes[i];
}

const GRADIENTS_POOL = [
  'linear-gradient(135deg,#1a1a2e,#16213e)',
  'linear-gradient(135deg,#0f3460,#533483)',
  'linear-gradient(135deg,#e94560,#0f3460)',
  'linear-gradient(135deg,#2c003e,#ad5cad)',
  'linear-gradient(135deg,#1b1b2f,#e43f5a)',
  'linear-gradient(135deg,#162447,#1f4068)',
  'linear-gradient(135deg,#1b262c,#0f4c75)',
  'linear-gradient(135deg,#2d132c,#ee4540)',
  'linear-gradient(135deg,#0d0d0d,#3a0ca3)',
  'linear-gradient(135deg,#10002b,#e0aaff)',
];

// ================================================================
// INITIALIZE - Call ini saat page load
// ================================================================
// Panggil loadGoogleDriveVideos() di app.js atau HTML setelah script ini diload
