// Lâmpadas de letreiro antigo à volta de um elemento [data-lampadas].
export function porLampadas(el, espaco = 34) {
  el.querySelectorAll('.lampada').forEach((l) => l.remove());
  const w = el.offsetWidth, h = el.offsetHeight, m = 13; // m = distância à borda
  if (!w || !h) return;
  const pontos = [];
  const lado = (x0, y0, x1, y1) => {
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / espaco));
    for (let i = 0; i < n; i++) pontos.push([x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
  };
  lado(m, m, w - m, m);
  lado(w - m, m, w - m, h - m);
  lado(w - m, h - m, m, h - m);
  lado(m, h - m, m, m);
  const frag = document.createDocumentFragment();
  pontos.forEach(([x, y], i) => {
    const l = document.createElement('i');
    l.className = `lampada ${i % 2 ? 'b' : 'a'}`;
    l.style.left = `${x}px`;
    l.style.top = `${y}px`;
    frag.append(l);
  });
  el.append(frag);
}

export function iniciarLampadas() {
  const todas = () => document.querySelectorAll('[data-lampadas]').forEach((el) => porLampadas(el));
  todas();
  document.fonts?.ready.then(todas);
  let t;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(todas, 150); });
  return todas;
}
