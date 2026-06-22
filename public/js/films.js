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

  function film(title, desc, videoId, thumbUrl) {
    _id++;
    return {
      id:       _id,
      title,
      desc,
      // Video ID untuk embed
      videoId:  videoId,
      embed:    `https://www.xvideos.com/embedframe/${videoId}`,
      // Thumbnail - langsung pakai full URL
      thumb:    thumbUrl,
      // Fallback gradient untuk loading state
      gradient: gradients[(_id - 1) % gradients.length],
      duration: '1h 30m',
    };
  }

  return [
    // Japan
    film('Japannese 1', 'Japan', 'okkbeedc45d', 'https://thumb-cdn77.xvideos-cdn.com/50fe30cb-814d-46ea-bbac-b476baa90f91/0/xv_3_t.jpg'),
    film('Japannese 2', 'Japan', 'uellueb651a', 'https://thumbs-gcore.xvideos-cdn.com/9a11ef1d-b5fd-44f1-b0cc-ac696c1d748a/0/xv_5_t.jpg'),
    film('Japannese 3', 'Japan', 'udptlbbc307', 'https://thumb-cdn77.xvideos-cdn.com/bf05f85c-e1da-4522-9ac3-fc349b90c19f/0/xv_4_t.jpg'),
    film('Japannese 4', 'Japan', 'kvceumk9d12', 'https://thumbs-gcore.xvideos-cdn.com/5c5c996e-8d49-40cc-9362-8950b6e6e2c0/0/xv_13_t.jpg'),
    film('Japannese 5', 'Japan', 'oiopumb63e9', 'https://thumbs-gcore.xvideos-cdn.com/5028e180-83a5-4770-ab9d-5917d4dd8e2a/0/xv_16_t.jpg'),

    // USA Romance
    film('Romance 1', 'USA Romance', 'oofpkhie377', 'https://thumb-cdn77.xvideos-cdn.com/f56dd1cb-b208-476a-8eac-b3122532f9a6/4/xv_30_t.jpg'),
    film('Romance 2', 'USA Romance', 'oofpkhbcb6d', 'https://thumb-cdn77.xvideos-cdn.com/46122ae9-d9e8-4526-9490-291910b347ce/4/xv_30_t.jpg'),
    film('Romance 3', 'USA Romance', 'oovploe8868', 'https://thumb-cdn77.xvideos-cdn.com/44b5c5e9-56ef-41be-af96-149b1e4c138c/3/xv_30_t.jpg'),
    film('Romance 4', 'USA Romance', 'oovivca4f73', 'https://thumb-cdn77.xvideos-cdn.com/af1621b4-9cbb-4e65-98e6-be8d55ec549f/3/xv_30_t.jpg'),
    film('Romance 5', 'USA Romance', 'oovidcvd0ba', 'https://thumb-cdn77.xvideos-cdn.com/aa9f4667-023d-419d-870f-00b436d83b30/3/xv_30_t.jpg'),
  ];
})();
