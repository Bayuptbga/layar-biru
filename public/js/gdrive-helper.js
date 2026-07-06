// ================================================================
// GOOGLE DRIVE HELPER — gdrive-helper.js
// ================================================================
// Fungsi untuk mengakses Google Drive API dan mengambil video dari folder

const GDRIVE_API_KEY = 'AIzaSyB8MY-5lLPOirCFvXO8qEwHgY5zntv0m4c';
const GDRIVE_FOLDER_ID = '1RjxjqHRT6X9sU8rH87pfzz6hr-VlKet-';

// ================================================================
// FETCH VIDEOS DARI GOOGLE DRIVE
// ================================================================
async function getVideosFromGDrive() {
  try {
    const query = `'${GDRIVE_FOLDER_ID}' in parents and (mimeType='video/mp4' or mimeType='video/quicktime' or mimeType='video/x-msvideo' or mimeType='video/x-matroska' or mimeType='video/webm') and trashed=false`;
    
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&key=${GDRIVE_API_KEY}&fields=files(id,name,mimeType,size,createdTime,thumbnailLink)&pageSize=1000`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (!data.files) {
      console.error('No videos found or API error:', data);
      return [];
    }
    
    // Convert Google Drive files to FILMS format
    return data.files.map((file, index) => ({
      id: index + 1,
      title: file.name.replace(/\.[^.]+$/, ''), // Hapus extension
      desc: formatFileSize(file.size),
      videoId: file.id,
      thumb: file.thumbnailLink || 'https://via.placeholder.com/300x400?text=Video',
      gdriveFileId: file.id,
      embed: `https://drive.google.com/file/d/${file.id}/preview`, // Preview mode
      playUrl: `https://drive.google.com/uc?id=${file.id}&export=download`, // Download link
      streamUrl: `https://lh3.googleusercontent.com/d/${file.id}=w1920-h1080-rw`, // Stream attempt
      gradient: getRandomGradient(index),
      duration: 'Video'
    }));
  } catch (err) {
    console.error('Error fetching from Google Drive:', err);
    return [];
  }
}

// ================================================================
// FORMAT FILE SIZE
// ================================================================
function formatFileSize(bytes) {
  if (!bytes) return 'Unknown size';
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}

// ================================================================
// RANDOM GRADIENT
// ================================================================
function getRandomGradient(index) {
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
  return GRADIENTS_POOL[index % GRADIENTS_POOL.length];
}

// ================================================================
// GENERATE GDRIVE PREVIEW LINK
// ================================================================
function getGDrivePreviewLink(fileId) {
  return `https://drive.google.com/file/d/${fileId}/preview`;
}

// ================================================================
// GENERATE GDRIVE DOWNLOAD LINK
// ================================================================
function getGDriveDownloadLink(fileId) {
  return `https://drive.google.com/uc?id=${fileId}&export=download`;
}

// ================================================================
// GENERATE GDRIVE STREAM LINK (untuk embed)
// ================================================================
function getGDriveStreamLink(fileId) {
  return `https://drive.google.com/file/d/${fileId}/preview`;
}
