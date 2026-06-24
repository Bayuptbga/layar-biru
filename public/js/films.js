// ================================================================
// LAYAR BIRU — films.js (SUPER SEDERHANA UNTUK DEVELOPER)
// ================================================================
// 🎯 TUJUAN: Membuat penambahan video SANGAT MUDAH!
//
// CARA MENAMBAH VIDEO:
// 1. Copy salah satu baris film di DEFAULT_FILMS
// 2. Ganti: title, desc, videoId, thumb
// 3. Paste ke dalam array
// 4. SELESAI! ✓
//
// Semua field lain auto-generate otomatis!
// ================================================================

let FILMS = [];

// ╔═══════════════════════════════════════════════════════════════╗
// ║  DEFAULT_FILMS — EDIT DI SINI UNTUK TAMBAH/HAPUS VIDEO      ║
// ╚═══════════════════════════════════════════════════════════════╝

const DEFAULT_FILMS = [
  {
    title: 'Japannese 1',
    desc: 'Japan',
    videoId: 'okkbeedc45d',
    thumb: 'https://thumb-cdn77.xvideos-cdn.com/50fe30cb-814d-46ea-bbac-b476baa90f91/0/xv_3_t.jpg'
  },
  {
    title: 'Japannese 2',
    desc: 'Japan',
    videoId: 'uellueb651a',
    thumb: 'https://thumbs-gcore.xvideos-cdn.com/9a11ef1d-b5fd-44f1-b0cc-ac696c1d748a/0/xv_5_t.jpg'
  },
  {
    title: 'Japannese 3',
    desc: 'Japan',
    videoId: 'udptlbbc307',
    thumb: 'https://thumb-cdn77.xvideos-cdn.com/bf05f85c-e1da-4522-9ac3-fc349b90c19f/0/xv_4_t.jpg'
  },
  {
    title: 'Japannese 4',
    desc: 'Japan',
    videoId: 'kvceumk9d12',
    thumb: 'https://thumbs-gcore.xvideos-cdn.com/5c5c996e-8d49-40cc-9362-8950b6e6e2c0/0/xv_13_t.jpg'
  },
  {
    title: 'Japannese 5',
    desc: 'Japan',
    videoId: 'oiopumb63e9',
    thumb: 'https://thumbs-gcore.xvideos-cdn.com/5028e180-83a5-4770-ab9d-5917d4dd8e2a/0/xv_16_t.jpg'
  },
  {
    title: 'Romance 1',
    desc: 'USA Romance',
    videoId: 'oofpkhie377',
    thumb: 'https://thumb-cdn77.xvideos-cdn.com/f56dd1cb-b208-476a-8eac-b3122532f9a6/4/xv_30_t.jpg'
  },
  {
    title: 'Romance 2',
    desc: 'USA Romance',
    videoId: 'oofpkhbcb6d',
    thumb: 'https://thumb-cdn77.xvideos-cdn.com/46122ae9-d9e8-4526-9490-291910b347ce/4/xv_30_t.jpg'
  },
  {
    title: 'Romance 3',
    desc: 'USA Romance',
    videoId: 'oovploe8868',
    thumb: 'https://thumb-cdn77.xvideos-cdn.com/44b5c5e9-56ef-41be-af96-149b1e4c138c/3/xv_30_t.jpg'
  },
  {
    title: 'Romance 4',
    desc: 'USA Romance',
    videoId: 'oovivca4f73',
    thumb: 'https://thumb-cdn77.xvideos-cdn.com/af1621b4-9cbb-4e65-98e6-be8d55ec549f/3/xv_30_t.jpg'
  },
  {
    title: 'Romance 5',
    desc: 'USA Romance',
    videoId: 'oovidcvd0ba',
    thumb: 'https://thumb-cdn77.xvideos-cdn.com/aa9f4667-023d-419d-870f-00b436d83b30/3/xv_30_t.jpg'
  }
];

// ════════════════════════════════════════════════════════════════
// WARNA GRADIENT (Auto-dipakai untuk setiap film)
// ════════════════════════════════════════════════════════════════
const GRADIENTS = [
  'linear-gradient(135deg,#1a1a2e,#16213e)',    // Biru gelap
  'linear-gradient(135deg,#0f3460,#533483)',    // Biru ungu
  'linear-gradient(135deg,#e94560,#0f3460)',    // Merah biru
  'linear-gradient(135deg,#2c003e,#ad5cad)',    // Ungu magenta
  'linear-gradient(135deg,#1b1b2f,#e43f5a)',    // Biru merah
  'linear-gradient(135deg,#162447,#1f4068)',    // Biru navy
  'linear-gradient(135deg,#1b262c,#0f4c75)',    // Biru tua
  'linear-gradient(135deg,#2d132c,#ee4540)',    // Merah terang
  'linear-gradient(135deg,#0d0d0d,#3a0ca3)',    // Hitam biru
  'linear-gradient(135deg,#10002b,#e0aaff)',    // Ungu pastel
];

// ════════════════════════════════════════════════════════════════
// AUTO-FILL FUNCTION — Isi field yang kosong otomatis
// ════════════════════════════════════════════════════════════════
function autoFillFilmData(film, index) {
  return {
    // Fields yang HARUS diisi developer:
    title: film.title,
    desc: film.desc,
    videoId: film.videoId,
    thumb: film.thumb,
    
    // Fields yang AUTO-GENERATE (jangan perlu diisi):
    id: film.id || (index + 1),
    embed: `https://www.xvideos.com/embedframe/${film.videoId}`,
    gradient: film.gradient || GRADIENTS[index % GRADIENTS.length],
    duration: film.duration || '1h 30m'
  };
}

// ════════════════════════════════════════════════════════════════
// INISIALISASI — Auto-load dan fill semua field
// ════════════════════════════════════════════════════════════════
function initializeFilms() {
  FILMS = DEFAULT_FILMS.map((film, idx) => autoFillFilmData(film, idx));
  console.log(`✓ ${FILMS.length} film sudah dimuat`);
}

// Load saat page ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeFilms);
} else {
  initializeFilms();
}

// ════════════════════════════════════════════════════════════════
// QUICK REFERENCE — Cara menambah film
// ════════════════════════════════════════════════════════════════
/*

╔════════════════════════════════════════════════════════════════╗
║                    CARA MENAMBAH VIDEO BARU                   ║
╚════════════════════════════════════════════════════════════════╝

LANGKAH 1: Copy template ini
───────────────────────────────────────────────────────────────
{
  title: "Judul Film",
  desc: "Kategori/Deskripsi",
  videoId: "abc123def456",
  thumb: "https://link-gambar-cdn.com/xxx/xv_30_t.jpg"
}


LANGKAH 2: Isi ke DEFAULT_FILMS array
───────────────────────────────────────────────────────────────
const DEFAULT_FILMS = [
  { ... existing films ... },
  {
    title: "Judul Film Baru",      ← GANTI DI SINI
    desc: "Kategori Baru",         ← GANTI DI SINI
    videoId: "xxx123yyy456",       ← GANTI DI SINI
    thumb: "https://url.com/pic.jpg" ← GANTI DI SINI
  }
];


LANGKAH 3: Deploy
───────────────────────────────────────────────────────────────
Upload file ini ke server → Refresh browser → SELESAI! ✓


OPTIONAL: Custom warna atau durasi
───────────────────────────────────────────────────────────────
{
  title: "Film Khusus",
  desc: "Kategori",
  videoId: "xxx123yyy456",
  thumb: "https://url.com/pic.jpg",
  gradient: "linear-gradient(135deg,#e94560,#0f3460)",  ← Custom warna
  duration: "45m"  ← Custom durasi (default: 1h 30m)
}

═══════════════════════════════════════════════════════════════════

Tips:
  ✓ Pastikan videoId benar (dari xvideos.com)
  ✓ Thumbnail URL harus valid (https://)
  ✓ Gunakan kategori yang konsisten (Japan, USA, Romance, dll)
  ✓ Jangan lupa comma (,) di akhir setiap object
  ✓ Jangan hapus closing bracket ]

*/
