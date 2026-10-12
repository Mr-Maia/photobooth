// Efeitos sonoros vintage, sintetizados com Web Audio (sem ficheiros de áudio).

let ctx, mestre, projetor;

// Tem de ser chamado dentro de um toque (o iOS só deixa ligar o som assim).
export function ativarSom() {
  if (!window.PHOTOBOOTH_CONFIG.som) return;
  try {
    // Safari 17+: toca mesmo com o interruptor de silêncio do iPad ligado
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (!mestre) {
      mestre = ctx.createGain();
      mestre.gain.value = 0.9;
      mestre.connect(ctx.destination);
    }
    if (ctx.state !== 'running') ctx.resume();
  } catch { ctx = null; }
}

const pronto = () => ctx && ctx.state === 'running';

function ruido(segundos) {
  const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * segundos), ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

// Rajada de ruído filtrado com envolvente rápida (cliques, estalos)
function estalo({ t = ctx.currentTime, dur = 0.03, freq = 3000, q = 1, tipo = 'bandpass', vol = 0.5 }) {
  const src = ctx.createBufferSource();
  src.buffer = ruido(dur + 0.02);
  const f = ctx.createBiquadFilter();
  f.type = tipo; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(mestre);
  src.start(t); src.stop(t + dur + 0.02);
}

function tom({ t = ctx.currentTime, freq, freqFim, dur, vol = 0.2, forma = 'sine', ataque = 0.005 }) {
  const o = ctx.createOscillator();
  o.type = forma;
  o.frequency.setValueAtTime(freq, t);
  if (freqFim) o.frequency.exponentialRampToValueAtTime(freqFim, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + ataque);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(mestre);
  o.start(t); o.stop(t + dur + 0.05);
}

// Zumbido contínuo de projetor de 16 mm: ruído abafado + 24 cliques por segundo
export function projetorLigar() {
  if (!pronto() || projetor) return;
  const sr = ctx.sampleRate;
  const b = ctx.createBuffer(1, sr, sr); // 1 s em loop
  const d = b.getChannelData(0);
  let lp = 0;
  for (let i = 0; i < sr; i++) {
    lp += 0.06 * ((Math.random() * 2 - 1) - lp);         // ruído grave (motor)
    const fase = (i % (sr / 24)) / sr;                    // posição dentro do fotograma
    const clique = fase < 0.004 ? (Math.random() * 2 - 1) * (1 - fase / 0.004) * 0.9 : 0;
    d[i] = lp * 0.9 + clique * 0.45;
  }
  const src = ctx.createBufferSource();
  src.buffer = b; src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = 2400;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.6);
  src.connect(f).connect(g).connect(mestre);
  src.start();
  projetor = { src, g };
}

export function projetorDesligar() {
  if (!projetor) return;
  const { src, g } = projetor;
  projetor = null;
  const t = ctx.currentTime;
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(g.gain.value, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
  src.playbackRate.setValueAtTime(1, t);
  src.playbackRate.linearRampToValueAtTime(0.55, t + 0.8); // abranda como um motor a parar
  src.stop(t + 0.85);
}

// Tique-taque do temporizador mecânico
export function tique(ultimo = false) {
  if (!pronto()) return;
  const t = ctx.currentTime;
  estalo({ t, dur: 0.025, freq: ultimo ? 4200 : 3200, q: 4, vol: 0.7 });
  tom({ t, freq: ultimo ? 1900 : 1400, dur: 0.06, vol: 0.12, forma: 'triangle' });
}

// Obturador "ka-chunk" + lâmpada de flash a rebentar + flash a recarregar
export function disparo() {
  if (!pronto()) return;
  const t = ctx.currentTime;
  estalo({ t, dur: 0.02, freq: 5000, q: 2, vol: 0.8 });                 // abre
  tom({ t, freq: 140, freqFim: 60, dur: 0.12, vol: 0.35, forma: 'sine' }); // corpo da máquina
  estalo({ t: t + 0.07, dur: 0.035, freq: 2500, q: 2, vol: 0.7 });       // fecha
  estalo({ t: t + 0.01, dur: 0.35, freq: 1800, q: 0.6, vol: 0.35 });      // "pop" do flash
  estalo({ t: t + 0.05, dur: 0.6, freq: 7000, tipo: 'highpass', vol: 0.08 }); // chiado
  tom({ t: t + 0.45, freq: 1800, freqFim: 7500, dur: 1.4, vol: 0.025, ataque: 0.3 }); // recarga
}

// Motor da máquina a revelar a tira (devolve função para parar)
export function revelacao() {
  if (!pronto()) return () => {};
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'sawtooth'; o.frequency.value = 52;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 7;
  const lfoG = ctx.createGain(); lfoG.gain.value = 6;
  lfo.connect(lfoG).connect(o.frequency);
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.12, t + 0.3);
  o.connect(f).connect(g).connect(mestre);
  o.start(t); lfo.start(t);
  const clunks = setInterval(() => pronto() && estalo({ dur: 0.05, freq: 700, q: 3, vol: 0.25 }), 520);
  return () => {
    clearInterval(clunks);
    const t2 = ctx.currentTime;
    g.gain.cancelScheduledValues(t2);
    g.gain.setValueAtTime(g.gain.value, t2);
    g.gain.exponentialRampToValueAtTime(0.0001, t2 + 0.3);
    o.stop(t2 + 0.35); lfo.stop(t2 + 0.35);
  };
}

// "Ding!" de campainha — a tira está pronta
export function campainha() {
  if (!pronto()) return;
  const t = ctx.currentTime;
  for (const [freq, vol, dur] of [[1568, 0.22, 1.8], [3136, 0.08, 1.2], [4700, 0.04, 0.7], [2093, 0.06, 1.5]]) {
    tom({ t, freq, dur, vol, ataque: 0.003 });
  }
}

// ── Câmara descartável ───────────────────────────────────────

// Clique de plástico do obturador + zumbido curto do flash a carregar
export function cliqueDescartavel() {
  if (!pronto()) return;
  const t = ctx.currentTime;
  estalo({ t, dur: 0.018, freq: 6000, q: 3, vol: 0.9 });
  estalo({ t: t + 0.012, dur: 0.05, freq: 1800, q: 1.5, vol: 0.5 });
  tom({ t, freq: 320, freqFim: 180, dur: 0.05, vol: 0.18, forma: 'square' });
  tom({ t: t + 0.25, freq: 2500, freqFim: 6000, dur: 0.9, vol: 0.02, ataque: 0.2 });
}

// Um "dente" da roda de avançar o rolo
export function catraca() {
  if (!pronto()) return;
  const t = ctx.currentTime;
  estalo({ t, dur: 0.012, freq: 3800 + Math.random() * 600, q: 5, vol: 0.45 });
}

// Rolo travado — pronto para a próxima foto
export function roloPronto() {
  if (!pronto()) return;
  const t = ctx.currentTime;
  estalo({ t, dur: 0.03, freq: 2200, q: 2, vol: 0.7 });
  tom({ t, freq: 220, freqFim: 120, dur: 0.06, vol: 0.15, forma: 'square' });
}

// ── Abrir a câmara pela primeira vez ─────────────────────────

// Um pedaço de cartão a rasgar (chamado várias vezes enquanto se arrasta)
export function rasgar() {
  if (!pronto()) return;
  const t = ctx.currentTime;
  estalo({ t, dur: 0.03 + Math.random() * 0.05, freq: 1400 + Math.random() * 2600, q: 0.8, vol: 0.28 + Math.random() * 0.2 });
}

// A tampa da caixa a soltar-se
export function tampaFora() {
  if (!pronto()) return;
  const t = ctx.currentTime;
  for (let i = 0; i < 7; i++) estalo({ t: t + i * 0.035, dur: 0.06, freq: 1200 + Math.random() * 3000, q: 0.7, vol: 0.4 });
  estalo({ t: t + 0.2, dur: 0.4, freq: 900, q: 0.5, vol: 0.12 });
}

// A câmara a sair da caixa / a ser pousada
export function pousar() {
  if (!pronto()) return;
  const t = ctx.currentTime;
  tom({ t, freq: 110, freqFim: 55, dur: 0.18, vol: 0.3 });
  estalo({ t, dur: 0.08, freq: 500, q: 1, tipo: 'lowpass', vol: 0.4 });
}

// Plástico a rodar na mão
export function virar() {
  if (!pronto()) return;
  const t = ctx.currentTime;
  estalo({ t, dur: 0.25, freq: 2500, q: 0.4, vol: 0.12 });
  estalo({ t: t + 0.22, dur: 0.03, freq: 1800, q: 2, vol: 0.4 });
}

// Flash a carregar enquanto se segura o botão: devolve { parar(ok) }
export function carregarFlash(segundos) {
  if (!pronto()) return { parar() {} };
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(900, t);
  o.frequency.exponentialRampToValueAtTime(7200, t + segundos);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.06, t + 0.15);
  o.connect(g).connect(mestre);
  o.start(t);
  return {
    parar(ok) {
      const t2 = ctx.currentTime;
      g.gain.cancelScheduledValues(t2);
      g.gain.setValueAtTime(g.gain.value, t2);
      if (!ok) { // largou cedo: o assobio cai
        o.frequency.cancelScheduledValues(t2);
        o.frequency.setValueAtTime(o.frequency.value, t2);
        o.frequency.exponentialRampToValueAtTime(300, t2 + 0.25);
      }
      g.gain.exponentialRampToValueAtTime(0.0001, t2 + (ok ? 0.6 : 0.25));
      o.stop(t2 + 0.7);
      if (ok) tom({ t: t2, freq: 2400, dur: 0.06, vol: 0.08, forma: 'square' });
    },
  };
}
