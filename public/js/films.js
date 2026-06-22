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

  function film(title, desc, id) {
    _id++;
    return {
      id:       _id,
      title,
      desc,
      embed:    `https://www.videos.com/embedframe/${id}`,
      thumb:    `https://cdn77-pic.videos-cdn.com/videos/thumbs169poster/${id}/1.jpg`,
      gradient: gradients[(_id - 1) % gradients.length],
    };
  }

  return [
    // Japan
    film('Japannese 1', 'Japan', 'okkbeedc45d'),
    film('Japannese 2', 'Japan', 'uellueb651a'),
    film('Japannese 3', 'Japan', 'udptlbbc307'),
    film('Japannese 4', 'Japan', 'kvceumk9d12'),
    film('Japannese 5', 'Japan', 'oiopumb63e9'),

    // USA Romance
    film('Romance 1', 'USA Romance', 'oofpkhie377'),
    film('Romance 2', 'USA Romance', 'oofpkhbcb6d'),
    film('Romance 3', 'USA Romance', 'oovploe8868'),
    film('Romance 4', 'USA Romance', 'oovivca4f73'),
    film('Romance 5', 'USA Romance', 'oovidcvd0ba'),
  ];
})();
