// Sürakarta kuralları: hem sunucu hem tarayıcı bunu kullanır.
// Tahta 6x6; 'b' üstte (satır 0-1), 'w' altta (satır 4-5) başlar.
(function (g) {
  // Daire yolları: 24 hücre, her 6 hücrede bir köşe halkası geçilir.
  // i=1 küçük halka, i=2 büyük halka.
  function build(i) {
    const j = 5 - i, a = [];
    for (let c = 0; c < 6; c++) a.push([i, c]);
    for (let r = 0; r < 6; r++) a.push([r, j]);
    for (let c = 5; c >= 0; c--) a.push([j, c]);
    for (let r = 5; r >= 0; r--) a.push([r, i]);
    return a;
  }
  const C = [build(1), build(2)], P = {};
  C.forEach((cy, k) => cy.forEach(([r, c], i) => (P[r * 6 + c] = P[r * 6 + c] || []).push([k, i])));

  const init = () => Array.from({ length: 6 }, (_, r) =>
    Array.from({ length: 6 }, () => (r < 2 ? 'b' : r > 3 ? 'w' : null)));

  // Bir taşın tüm hamleleri: [{to:[r,c], cap:boolean}]
  function moves(b, r, c) {
    const me = b[r][c], out = [], seen = {};
    for (let dr = -1; dr < 2; dr++)
      for (let dc = -1; dc < 2; dc++) {
        const y = r + dr, x = c + dc;
        if ((dr || dc) && y >= 0 && y < 6 && x >= 0 && x < 6 && !b[y][x]) out.push({ to: [y, x], cap: false });
      }
    (P[r * 6 + c] || []).forEach(([k, i0]) => {
      for (const d of [1, -1]) {
        let i = i0, loops = 0;
        for (let s = 0; s < 24; s++) {
          const n = (i + d + 24) % 24;
          if (d === 1 ? i % 6 === 5 : n % 6 === 5) loops++;
          i = n;
          const [y, x] = C[k][i], v = b[y][x];
          if (v && !(y === r && x === c)) {
            if (v !== me && loops > 0 && !seen[y * 6 + x]) { seen[y * 6 + x] = 1; out.push({ to: [y, x], cap: true }); }
            break;
          }
        }
      }
    });
    return out;
  }

  const apply = (b, f, t) => {
    const n = b.map(r => r.slice());
    n[t[0]][t[1]] = n[f[0]][f[1]];
    n[f[0]][f[1]] = null;
    return n;
  };
  const count = (b, p) => b.flat().filter(v => v === p).length;

  const R = { init, moves, apply, count };
  if (typeof module !== 'undefined') module.exports = R; else g.Rules = R;
})(this);
