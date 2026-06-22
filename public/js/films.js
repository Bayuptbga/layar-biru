// ================================================================
// LAYAR BIRU — films.js
// Tambah film baru cukup copy satu baris di bawah ini:
//
//   film('Judul', 'Genre', 'https://link-embed', '#warna1', '#warna2'),
//
// ================================================================

function film(title, desc, embed, color1, color2) {
  film._id = (film._id || 0) + 1;
  return {
    id:       film._id,
    title,
    desc,
    embed,
    gradient: `linear-gradient(135deg, ${color1}, ${color2})`
  };
}

const FILMS = [

  film('Japannese',    'Drama Japan', 'https://www.xvideos.com/embedframe/okkbeedc45d', '#1c2b52', '#2E6FF2'),
  film('Japannese Fm', 'Japan',       'https://www.xvideos.com/embedframe/uellueb651a', '#3d1f52', '#A855F7'),
  film('Japannese Moview', 'Japan',   'https://www.xvideos.com/embedframe/udptlbbc307', '#3d1f52', '#A855F7'),
  film('Japannese Family', 'Japan',   'https://www.xvideos.com/embedframe/kvceumk9d12.', '#3d1f52', '#A855F7'),
  film('Japannese GB', 'Japan',       'https://www.xvideos.com/embedframe/oiopumb63e9', '#3d1f52', '#A855F7'),
  // Tambah film baru di sini ↓
  // film('Judul Film',  'Genre', 'https://...', '#warna1', '#warna2'),

];
