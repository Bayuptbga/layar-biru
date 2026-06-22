// ================================================================
// LAYAR BIRU — films.js
// ================================================================

const FILMS = (() => {
  let _id = 0;

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

  function film(title, desc, videoId, thumbPath) {
    _id++;
    return {
      id:       _id,
      title,
      desc,
      // Video ID untuk embed - tetap original
      videoId:  videoId,
      embed:    `https://www.xvideos.com/embedframe/${videoId}`,
      // Thumbnail path terpisah - bisa custom sepenuhnya
      thumb:    `https://thumbs-gcore.xvideos-cdn.com${thumbPath}`,
      // Fallback gradient untuk loading state
      gradient: gradients[(_id - 1) % gradients.length],
      duration: '1h 30m',
    };
  }

  return [
    // Japan
    film('Japannese 1', 'Japan', 'okkbeedc45d', '/5028e180-83a5-4770-ab9d-5917d4dd8e2a/0/xv_16_t.jpg'),
    film('Japannese 2', 'Japan', 'uellueb651a', '/uuid-video-2/0/xv_2_t.jpg'),
    film('Japannese 3', 'Japan', 'udptlbbc307', '/uuid-video-3/0/xv_2_t.jpg'),
    film('Japannese 4', 'Japan', 'kvceumk9d12', '/uuid-video-4/0/xv_2_t.jpg'),
    film('Japannese 5', 'Japan', 'oiopumb63e9', '/uuid-video-5/0/xv_2_t.jpg'),

    // USA Romance
    film('Romance 1', 'USA Romance', 'oofpkhie377', '/uuid-romance-1/0/xv_2_p.jpg'),
    film('Romance 2', 'USA Romance', 'oofpkhbcb6d', '/uuid-romance-2/0/xv_2_p.jpg'),
    film('Romance 3', 'USA Romance', 'oovploe8868', '/uuid-romance-3/0/xv_2_p.jpg'),
    film('Romance 4', 'USA Romance', 'oovivca4f73', '/uuid-romance-4/0/xv_2_p.jpg'),
    film('Romance 5', 'USA Romance', 'oovidcvd0ba', '/uuid-romance-5/0/xv_2_p.jpg'),
  ];
})();
