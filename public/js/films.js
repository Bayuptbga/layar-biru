// ================================================================
// LAYAR BIRU — films.js
// Tambah film baru cukup copy satu baris di bawah ini:
//
//   film('Judul', 'Genre', 'ID_VIDEO', '#warna1', '#warna2'),
//
// ================================================================

function film(title, desc, id, color1, color2) {
  film._id = (film._id || 0) + 1;
  return {
    id:       film._id,
    title,
    desc,
    // Embed URL otomatis dibuat dari ID
    embed:    `https://www.xvideos.com/embedframe/${id}`,
    gradient: `linear-gradient(135deg, ${color1}, ${color2})`
  };
}

const FILMS = [

  film('Japannese',    'Drama Japan', 'okkbeedc45d', '#1c2b52', '#2E6FF2'),
  film('Japannese Fm', 'Japan',       'uellueb651a', '#3d1f52', '#A855F7'),
  film('Japannese Moview', 'Japan',   'udptlbbc307', '#3d1f52', '#A855F7'),
  film('Japannese Family', 'Japan',   'kvceumk9d12', '#3d1f52', '#A855F7'),
  film('Japannese GB', 'Japan',       'oiopumb63e9', '#3d1f52', '#A855F7'),

  // Tambah film baru di sini ↓
  // film('Judul Film', 'Genre', 'ID_VIDEO', '#warna1', '#warna2'),

];
