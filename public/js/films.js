// ================================================================
// FILMS — Data film dari Google Drive
// Format embed: https://drive.google.com/file/d/FILE_ID/preview
// 
// Cara dapatkan FILE_ID:
//   Buka file di Google Drive → klik kanan → "Dapatkan link"
//   Link: https://drive.google.com/file/d/FILE_ID_INI/view?usp=sharing
//   Salin bagian FILE_ID_INI saja
// ================================================================

const FILMS = [];

// Films akan diisi otomatis dari server via loadFilmsFromAPI()
// Data default di bawah ini hanya sebagai fallback jika server tidak merespons

const FILMS_DEFAULT = [
  {
    id: 1,
    title: 'Japanese 1',
    desc: 'Japan',
    videoId: 'gdrive_1',
    thumb: 'https://lh3.googleusercontent.com/drive-storage/ANbEZu7gCBqrJ9DI1bDIGPZ7lgJPMFIJMjmEoXTG00hhFJXGzGfqDT2TfBdVVzXiImMGagJ_n73PniLLJJYCnT7mJiT9t4bTJzYxNDH_IlHSoaXwbFiC=s220',
    embed: 'https://drive.google.com/file/d/GANTI_DENGAN_FILE_ID_1/preview',
    gradient: 'linear-gradient(135deg,#1a1a2e,#16213e)',
    duration: '1h 30m'
  }
];

// Inisialisasi FILMS dengan data default jika kosong setelah load
function initFilmsDefault() {
  if (FILMS.length === 0) {
    FILMS_DEFAULT.forEach(f => FILMS.push(f));
  }
}
