// ================================================================
// LAYAR BIRU — films.js
// ================================================================

const img = new Image();
img.src = film.thumb;
img.onload = () => {
  posterEl.style.backgroundImage = `url('${film.thumb}')`;
};
img.onerror = () => {
  // fallback ke banner.svg kalau thumbnail diblokir
  posterEl.style.backgroundImage = `url('assets/banner.svg')`;
};

const FILMS = [

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
