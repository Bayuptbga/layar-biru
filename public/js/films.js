// ================================================================
// LAYAR BIRU — films.js
// ================================================================

function film(title, desc, id, color1, color2) {
  film._id = (film._id || 0) + 1;
  return {
    id: film._id,
    title,
    desc,
    embed: `https://www.xvideos.com/embedframe/${id}`,
    gradient: `linear-gradient(135deg, ${color1}, ${color2})`
  };
}

const FILMS = [

  // Japan
  film('Japannese 1', 'Japan', 'okkbeedc45d', '#1c2b52', '#2E6FF2'),
  film('Japannese 2', 'Japan', 'uellueb651a', '#3d1f52', '#A855F7'),
  film('Japannese 3', 'Japan', 'udptlbbc307', '#3d1f52', '#A855F7'),
  film('Japannese 4', 'Japan', 'kvceumk9d12', '#3d1f52', '#A855F7'),
  film('Japannese 5', 'Japan', 'oiopumb63e9', '#3d1f52', '#A855F7'),

  // USA Romance
  film('Romance 1', 'USA Romance', 'oofpkhie377', '#ff4d6d', '#ff8fa3'),
  film('Romance 2', 'USA Romance', 'oofpkhbcb6d', '#ff4d6d', '#ff8fa3'),
  film('Romance 3', 'USA Romance', 'oovploe8868', '#ff4d6d', '#ff8fa3'),
  film('Romance 4', 'USA Romance', 'oovivca4f73', '#ff4d6d', '#ff8fa3'),
  film('Romance 5', 'USA Romance', 'oovidcvd0ba', '#ff4d6d', '#ff8fa3'),

];
