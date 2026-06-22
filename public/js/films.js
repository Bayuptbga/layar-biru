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
  film('Japannese Fm', 'Japan',       'https://www.xvideos.com/video.hoduidkedcf/b7', '#3d1f52', '#A855F7'),
  film('Japannese Moview', 'Japan',   'https://www.xvideos.com/video.ppbveh8097/av2631.part2', '#3d1f52', '#A855F7'),
  film('Japannese Family', 'Japan',   'https://www.xvideos.com/video.uellueb651a/kotone_kuroki_gets_an_asian_creampie_massage_leading_to_an_explosive_xxx_experience.', '#3d1f52', '#A855F7'),
  film('Japannese GB', 'Japan',       'https://www.xvideos.com/video.uukufdfe872/japanese_girl_aiko_nagai_got_gangbanged_uncensored', '#3d1f52', '#A855F7'),
  // Tambah film baru di sini ↓
  // film('Judul Film',  'Genre', 'https://...', '#warna1', '#warna2'),

];
