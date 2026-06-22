// ================================================================
// LAYAR BIRU — films.js (DYNAMIC)
// ================================================================

// Array yang akan di-populate dari server
let FILMS = [];

// Default fallback jika server tidak respond
const DEFAULT_FILMS = [
  {
    id: 1,
    title: 'Japannese 1',
    desc: 'Japan',
    videoId: 'okkbeedc45d',
    embed: 'https://www.xvideos.com/embedframe/okkbeedc45d',
    thumb: 'https://thumb-cdn77.xvideos-cdn.com/50fe30cb-814d-46ea-bbac-b476baa90f91/0/xv_3_t.jpg',
    gradient: 'linear-gradient(135deg,#1a1a2e,#16213e)',
    duration: '1h 30m'
  },
  {
    id: 2,
    title: 'Japannese 2',
    desc: 'Japan',
    videoId: 'uellueb651a',
    embed: 'https://www.xvideos.com/embedframe/uellueb651a',
    thumb: 'https://thumbs-gcore.xvideos-cdn.com/9a11ef1d-b5fd-44f1-b0cc-ac696c1d748a/0/xv_5_t.jpg',
    gradient: 'linear-gradient(135deg,#0f3460,#533483)',
    duration: '1h 30m'
  },
  {
    id: 3,
    title: 'Japannese 3',
    desc: 'Japan',
    videoId: 'udptlbbc307',
    embed: 'https://www.xvideos.com/embedframe/udptlbbc307',
    thumb: 'https://thumb-cdn77.xvideos-cdn.com/bf05f85c-e1da-4522-9ac3-fc349b90c19f/0/xv_4_t.jpg',
    gradient: 'linear-gradient(135deg,#e94560,#0f3460)',
    duration: '1h 30m'
  }
];

const GRADIENTS = [
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

// Load films dari server
async function loadFilmsFromServer() {
  try {
    const API_BASE = (
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1'
    ) ? 'http://localhost:3000' : '';
    
    const response = await fetch(`${API_BASE}/api/videos`);
    const data = await response.json();
    
    if (data.success && Array.isArray(data.videos)) {
      FILMS = data.videos.map((v, idx) => ({
        id: v.id || idx + 1,
        title: v.title,
        desc: v.desc,
        videoId: v.videoId,
        embed: `https://www.xvideos.com/embedframe/${v.videoId}`,
        thumb: v.thumb,
        gradient: GRADIENTS[idx % GRADIENTS.length],
        duration: v.duration || '1h 30m'
      }));
      
      console.log(`✓ Loaded ${FILMS.length} films dari server`);
      return true;
    } else {
      throw new Error('Invalid response format');
    }
  } catch (err) {
    console.warn('Error loading films from server, using defaults:', err);
    FILMS = [...DEFAULT_FILMS];
    return false;
  }
}

// Initialize films saat page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadFilmsFromServer);
} else {
  loadFilmsFromServer();
}
