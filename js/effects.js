// Efeitos "photobooth vintage" e composição da tira de fotos.

export const PALETA = {
  papel: '#f6efe1',
  turquesa: '#1f9e9e',
  turquesaEscuro: '#157575',
  dourado: '#c39a45',
  douradoEscuro: '#9c7731',
  rosa: '#e79bb0',
  rosaClaro: '#f6d5de',
};

// Curva em S (contraste "película") pré-calculada.
function curvaS(forca) {
  const lut = new Uint8ClampedArray(256);
  const lo = 1 / (1 + Math.exp(forca * 0.5));
  const hi = 1 / (1 + Math.exp(-forca * 0.5));
  for (let i = 0; i < 256; i++) {
    const s = 1 / (1 + Math.exp(-forca * (i / 255 - 0.5)));
    lut[i] = ((s - lo) / (hi - lo)) * 255;
  }
  return lut;
}
const CURVA_PB = curvaS(6.5);
const CURVA_COR = curvaS(4.5);

// Aplica o filtro diretamente no canvas.
// estilo: 'pb' (preto e branco clássico, tom prata quente) | 'cor' (cores desbotadas, anos 70)
export function aplicarVintage(canvas, estilo) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const cx = w / 2, cy = h / 2;
  const raio = Math.hypot(cx, cy);
  const grao = estilo === 'pb' ? 26 : 18;

  for (let y = 0; y < h; y++) {
    const dy = (y - cy) / raio;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let r = d[i], g = d[i + 1], b = d[i + 2];
      const dx = (x - cx) / raio;
      const dist = dx * dx + dy * dy;
      const vinheta = 1 - 0.55 * Math.pow(dist, 1.25);
      const ruido = (Math.random() - 0.5) * grao;

      if (estilo === 'pb') {
        let l = 0.3 * r + 0.59 * g + 0.11 * b;
        l = CURVA_PB[l | 0] * vinheta + ruido;
        l = 14 + l * 0.9;                     // pretos ligeiramente levantados
        r = l + 10; g = l + 4; b = l - 8;     // tom quente de papel fotográfico
      } else {
        const l = 0.3 * r + 0.59 * g + 0.11 * b;
        r = l + (r - l) * 0.72;               // menos saturação
        g = l + (g - l) * 0.72;
        b = l + (b - l) * 0.72;
        r = CURVA_COR[Math.max(0, Math.min(255, r)) | 0];
        g = CURVA_COR[Math.max(0, Math.min(255, g)) | 0];
        b = CURVA_COR[Math.max(0, Math.min(255, b)) | 0];
        r = 24 + r * 0.88 * 1.04;             // desbotado + quente
        g = 18 + g * 0.88;
        b = 30 + b * 0.82;
        r = r * vinheta + ruido;
        g = g * vinheta + ruido;
        b = b * vinheta + ruido;
      }
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function textura(ctx, w, h, intensidade) {
  // Grão subtil do papel
  const n = Math.floor((w * h) / 90);
  for (let k = 0; k < n; k++) {
    const a = Math.random() * intensidade;
    ctx.fillStyle = Math.random() < 0.5 ? `rgba(120,95,60,${a})` : `rgba(255,255,255,${a})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
  }
}

function coracao(ctx, x, y, s, cor) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s / 32, s / 32);
  ctx.beginPath();
  ctx.moveTo(0, 10);
  ctx.bezierCurveTo(-26, -8, -12, -30, 0, -14);
  ctx.bezierCurveTo(12, -30, 26, -8, 0, 10);
  ctx.closePath();
  ctx.fillStyle = cor;
  ctx.fill();
  ctx.restore();
}

function ornamento(ctx, cx, y, largura) {
  ctx.save();
  ctx.strokeStyle = PALETA.dourado;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  const gap = 34;
  ctx.beginPath();
  ctx.moveTo(cx - largura / 2, y); ctx.lineTo(cx - gap, y);
  ctx.moveTo(cx + gap, y); ctx.lineTo(cx + largura / 2, y);
  ctx.stroke();
  // pontinhos dourados nas pontas
  ctx.fillStyle = PALETA.dourado;
  for (const px of [cx - largura / 2 - 12, cx + largura / 2 + 12]) {
    ctx.beginPath(); ctx.arc(px, y, 5, 0, Math.PI * 2); ctx.fill();
  }
  coracao(ctx, cx, y + 4, 34, PALETA.rosa);
  ctx.restore();
}

// Desenha `src` no retângulo, cortando para preencher (object-fit: cover).
function desenharCover(ctx, src, x, y, w, h) {
  const sr = src.width / src.height, dr = w / h;
  let sw = src.width, sh = src.height, sx = 0, sy = 0;
  if (sr > dr) { sw = sh * dr; sx = (src.width - sw) / 2; }
  else { sh = sw / dr; sy = (src.height - sh) / 2; }
  ctx.drawImage(src, sx, sy, sw, sh, x, y, w, h);
}

// Monta a tira clássica 2×6" (1200×3600 px) com as fotos já filtradas.
export function comporTira(fotos, cfg) {
  const W = 1200, H = 3600;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');

  ctx.fillStyle = PALETA.papel;
  ctx.fillRect(0, 0, W, H);
  textura(ctx, W, H, 0.07);

  // Fio turquesa à volta + fio dourado fino por dentro
  ctx.strokeStyle = PALETA.turquesa;
  ctx.lineWidth = 10;
  ctx.strokeRect(22, 22, W - 44, H - 44);
  ctx.strokeStyle = PALETA.dourado;
  ctx.lineWidth = 3;
  ctx.strokeRect(38, 38, W - 76, H - 76);

  const margem = 90, gap = 34;
  const fw = W - margem * 2;           // 1020
  const fh = Math.round(fw * 0.75);    // 765 (4:3)
  let y = margem;
  for (const f of fotos) {
    ctx.fillStyle = '#1b1712';
    ctx.fillRect(margem - 4, y - 4, fw + 8, fh + 8);
    desenharCover(ctx, f, margem, y, fw, fh);
    y += fh + gap;
  }

  // Rodapé
  const cx = W / 2;
  const topo = y - gap;               // fim da última foto (~3252)

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = PALETA.turquesaEscuro;
  ctx.font = '128px "Great Vibes", "Snell Roundhand", cursive';
  ctx.fillText(cfg.nomes, cx, topo + 140);

  ornamento(ctx, cx, topo + 182, 520);

  ctx.fillStyle = PALETA.douradoEscuro;
  ctx.font = '600 40px "Cormorant Garamond", Georgia, serif';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '10px';
  const linha = [cfg.data, cfg.hashtag].filter(Boolean).join('   ·   ');
  ctx.fillText(linha, cx + 5, topo + 250);

  return c;
}
