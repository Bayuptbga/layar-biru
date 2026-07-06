// ================================================================
// SERVER.JS MODIFICATIONS — Google Drive API Endpoint
// ================================================================
// TAMBAHKAN KODE INI KE SERVER.JS ANDA
// Letakkan di bagian routes setelah route '/api/films' yang ada

const GDRIVE_API_KEY = process.env.GDRIVE_API_KEY || 'AIzaSyB8MY-5lLPOirCFvXO8qEwHgY5zntv0m4c';
const GDRIVE_FOLDER_ID = process.env.GDRIVE_FOLDER_ID || '1RjxjqHRT6X9sU8rH87pfzz6hr-VlKet-';

// ================================================================
// ENDPOINT 1: GET VIDEOS FROM GOOGLE DRIVE
// ================================================================
// Path: GET /api/gdrive/videos
// Returns: List of videos dari Google Drive folder

app.get('/api/gdrive/videos', async (req, res) => {
  try {
    const query = encodeURIComponent(
      `'${GDRIVE_FOLDER_ID}' in parents and ` +
      `(mimeType='video/mp4' or mimeType='video/quicktime' or mimeType='video/x-msvideo' or ` +
      `mimeType='video/x-matroska' or mimeType='video/webm' or mimeType='video/mpeg') and ` +
      `trashed=false`
    );
    
    const url = 
      `https://www.googleapis.com/drive/v3/files?q=${query}` +
      `&key=${GDRIVE_API_KEY}` +
      `&fields=files(id,name,mimeType,size,createdTime,thumbnailLink)` +
      `&pageSize=1000` +
      `&orderBy=createdTime desc`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.error) {
      return res.status(400).json({
        success: false,
        message: 'Google Drive API error',
        error: data.error.message
      });
    }
    
    // Format videos
    const videos = (data.files || []).map((file, index) => ({
      id: index + 1,
      title: file.name.replace(/\.[^.]+$/, ''),
      desc: formatFileSize(file.size),
      videoId: file.id,
      gdriveFileId: file.id,
      thumb: file.thumbnailLink || 'https://via.placeholder.com/300x400?text=Video',
      embed: `https://drive.google.com/file/d/${file.id}/preview`,
      playUrl: `https://drive.google.com/uc?id=${file.id}&export=download`,
      gradient: getGradient(index),
      duration: 'Google Drive',
      source: 'google-drive'
    }));
    
    res.json({
      success: true,
      count: videos.length,
      videos: videos
    });
    
    addServerLog('System', `Fetched ${videos.length} videos from Google Drive`, '#4CAF50', 'system');
    
  } catch (err) {
    console.error('[GDRIVE] Error:', err.message);
    res.status(500).json({
      success: false,
      message: 'Error fetching from Google Drive',
      error: err.message
    });
  }
});

// ================================================================
// ENDPOINT 2: GET SINGLE GOOGLE DRIVE VIDEO INFO
// ================================================================
// Path: GET /api/gdrive/video/:fileId
// Returns: Info tentang satu file dari Google Drive

app.get('/api/gdrive/video/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    
    const url = 
      `https://www.googleapis.com/drive/v3/files/${fileId}` +
      `?key=${GDRIVE_API_KEY}` +
      `&fields=id,name,mimeType,size,createdTime,thumbnailLink,webViewLink`;
    
    const response = await fetch(url);
    const file = await response.json();
    
    if (file.error) {
      return res.status(400).json({
        success: false,
        message: 'File not found or access denied'
      });
    }
    
    res.json({
      success: true,
      file: {
        id: file.id,
        name: file.name,
        size: formatFileSize(file.size),
        mimeType: file.mimeType,
        createdTime: file.createdTime,
        thumbnailLink: file.thumbnailLink,
        webViewLink: file.webViewLink,
        previewUrl: `https://drive.google.com/file/d/${file.id}/preview`,
        downloadUrl: `https://drive.google.com/uc?id=${file.id}&export=download`
      }
    });
    
  } catch (err) {
    console.error('[GDRIVE] Error:', err.message);
    res.status(500).json({
      success: false,
      message: 'Error fetching file info',
      error: err.message
    });
  }
});

// ================================================================
// ENDPOINT 3: SEARCH VIDEOS IN GOOGLE DRIVE
// ================================================================
// Path: POST /api/gdrive/search
// Body: { query: "search term" }
// Returns: Search results dari Google Drive

app.post('/api/gdrive/search', async (req, res) => {
  try {
    const { query = '' } = req.body;
    
    const searchQuery = encodeURIComponent(
      `'${GDRIVE_FOLDER_ID}' in parents and ` +
      `name contains '${query}' and ` +
      `(mimeType='video/mp4' or mimeType='video/quicktime' or mimeType='video/x-msvideo' or ` +
      `mimeType='video/x-matroska' or mimeType='video/webm' or mimeType='video/mpeg') and ` +
      `trashed=false`
    );
    
    const url = 
      `https://www.googleapis.com/drive/v3/files?q=${searchQuery}` +
      `&key=${GDRIVE_API_KEY}` +
      `&fields=files(id,name,mimeType,size,createdTime,thumbnailLink)` +
      `&pageSize=50`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    const videos = (data.files || []).map((file, index) => ({
      id: index + 1,
      title: file.name.replace(/\.[^.]+$/, ''),
      desc: formatFileSize(file.size),
      videoId: file.id,
      gdriveFileId: file.id,
      thumb: file.thumbnailLink || 'https://via.placeholder.com/300x400?text=Video',
      embed: `https://drive.google.com/file/d/${file.id}/preview`,
      gradient: getGradient(index),
      source: 'google-drive'
    }));
    
    res.json({
      success: true,
      query,
      count: videos.length,
      videos: videos
    });
    
  } catch (err) {
    console.error('[GDRIVE] Search error:', err.message);
    res.status(500).json({
      success: false,
      message: 'Error searching Google Drive',
      error: err.message
    });
  }
});

// ================================================================
// HELPER FUNCTIONS
// ================================================================

function formatFileSize(bytes) {
  if (!bytes) return 'Unknown';
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + ' ' + sizes[i];
}

function getGradient(index) {
  const gradients = [
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
  return gradients[index % gradients.length];
}

// ================================================================
// SOCKET.IO EVENT - Film dari Google Drive dipilih
// ================================================================
// Tambahkan ke io.on('connection') handler:
/*
socket.on('gdrive-film-selected', (data) => {
  const { film, fileId } = data;
  addServerLog('User', `Playing Google Drive video: ${film}`, '#FF6B6B', 'info');
  broadcastSessions(); // update admin panel
});
*/
