import { aplicarVintage, comporTira } from './effects.js';
import { enfileirar, processarFila, aoMudarEstado, firebaseConfigurado } from './storage.js';

const cfg = window.PHOTOBOOTH_CONFIG;
const $ = (s) => document.querySelector(s);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const video = $('#video');
const FOTO_W = 1600, FOTO_H = 1200; // resolução de cada foto guardada (4:3)
const FRASES = ['Sorriam! 😄', 'Agora uma careta! 😜', 'Um beijinho! 💋', 'A última — a melhor! ✨', 'Mais uma! 📸'];
let aDecorrer = false;

document.querySelectorAll('[data-nomes]').forEach((el) => (el.textContent = cfg.nomes));
document.querySelectorAll('[data-data]').forEach((el) => (el.textContent = cfg.data));

function mostrar(id) {
  document.querySelectorAll('.ecra').forEach((e) => e.classList.toggle('ativo', e.id === id));
}

// ── Câmara ───────────────────────────────────────────────────
async function ligarCamara() {
  if (video.srcObject?.active) return;
  try {
    video.srcObject = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1440 }, aspectRatio: { ideal: 4 / 3 } },
    });
    await video.play().catch(() => {});
    $('#erro-camara').hidden = true;
  } catch (e) {
    const el = $('#erro-camara');
    el.hidden = false;
    el.textContent = location.protocol !== 'https:' && location.hostname !== 'localhost'
      ? 'A câmara só funciona com https:// — abre o site pelo endereço do GitHub Pages.'
      : `Não foi possível ligar a câmara (${e.name}). Verifica as permissões em Definições → Safari → Câmara.`;
    throw e;
  }
}

function capturar() {
  const c = document.createElement('canvas');
  c.width = FOTO_W; c.height = FOTO_H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const vw = video.videoWidth, vh = video.videoHeight;
  const alvo = FOTO_W / FOTO_H;
  let sw = vw, sh = vh, sx = 0, sy = 0;
  if (vw / vh > alvo) { sw = vh * alvo; sx = (vw - sw) / 2; } else { sh = vw / alvo; sy = (vh - sh) / 2; }
  if (cfg.espelharFotoFinal) { ctx.translate(FOTO_W, 0); ctx.scale(-1, 1); }
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, FOTO_W, FOTO_H);
  return c;
}

// ── Sessão ───────────────────────────────────────────────────
function novoId() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  const data = `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const rnd = crypto.getRandomValues(new Uint8Array(6));
  return `${data}-${[...rnd].map((b) => abc[b % abc.length]).join('')}`;
}

const paraBlob = (canvas, q = 0.9) => new Promise((r) => canvas.toBlob(r, 'image/jpeg', q));

async function sessao(estilo) {
  if (aDecorrer) return;
  aDecorrer = true;
  try {
    await ligarCamara();
    document.documentElement.style.setProperty('--filtro-previo',
      estilo === 'pb' ? 'grayscale(1) contrast(1.2)' : 'saturate(.75) sepia(.2)');
    mostrar('camara');
    const mini = $('#miniaturas');
    mini.replaceChildren(...Array.from({ length: cfg.numeroFotos }, () => document.createElement('div')));

    const fotos = [];
    for (let n = 0; n < cfg.numeroFotos; n++) {
      $('#mensagem').textContent = n === cfg.numeroFotos - 1 ? FRASES[3] : FRASES[n] ?? FRASES[4];
      await esperar(n === 0 ? 900 : 300);
      for (let s = cfg.segundosContagem; s > 0; s--) {
        const el = $('#contagem');
        el.textContent = s;
        el.classList.remove('pulsar'); void el.offsetWidth; el.classList.add('pulsar');
        await esperar(1000);
      }
      $('#contagem').textContent = '';
      const foto = capturar();
      const f = $('#flash');
      f.classList.remove('disparar'); void f.offsetWidth; f.classList.add('disparar');
      fotos.push(foto);

      const img = document.createElement('img');
      img.src = foto.toDataURL('image/jpeg', 0.5);
      img.style.filter = getComputedStyle(document.documentElement).getPropertyValue('--filtro-previo');
      mini.children[n].replaceWith(img);
      await esperar(cfg.segundosEntreFotos * 1000);
    }
    $('#mensagem').textContent = '';

    mostrar('revelar');
    await esperar(50); // deixa o ecrã "a revelar" aparecer antes do trabalho pesado
    await document.fonts.load('128px "Great Vibes"').catch(() => {});
    await document.fonts.load('600 40px "Cormorant Garamond"').catch(() => {});
    for (const f of fotos) aplicarVintage(f, estilo);
    const tira = comporTira(fotos, cfg);

    const id = novoId();
    const pasta = `sessoes/${id}`;
    const tiraBlob = await paraBlob(tira, 0.9);
    const ficheiros = [{ caminho: `${pasta}/tira.jpg`, blob: tiraBlob }];
    for (let i = 0; i < fotos.length; i++) {
      ficheiros.push({ caminho: `${pasta}/foto-${i + 1}.jpg`, blob: await paraBlob(fotos[i], 0.9) });
    }
    // Miniatura leve para a galeria dos noivos
    const mini = document.createElement('canvas');
    mini.width = 300; mini.height = 900;
    mini.getContext('2d').drawImage(tira, 0, 0, 300, 900);
    ficheiros.push({ caminho: `${pasta}/tira-mini.jpg`, blob: await paraBlob(mini, 0.8) });
    await enfileirar(ficheiros);

    await mostrarFinal(URL.createObjectURL(tiraBlob), id);
  } catch (e) {
    console.error(e);
    mostrar('inicio');
  } finally {
    aDecorrer = false;
  }
}

// ── Ecrã final ───────────────────────────────────────────────
let fimTimer;
function mostrarFinal(tiraUrl, id) {
  const img = $('#tira');
  const antigo = img.src;
  img.src = tiraUrl;
  if (antigo.startsWith('blob:')) URL.revokeObjectURL(antigo);

  const link = `${cfg.siteUrl}/fotos.html?s=${id}`;
  const qr = qrcode(0, 'M');
  qr.addData(link);
  qr.make();
  $('#qr').innerHTML = qr.createSvgTag({ cellSize: 8, margin: 0, scalable: true });
  $('#qr').title = link;
  console.info('Link da sessão:', link);

  mostrar('final');
  let s = cfg.segundosEcraFinal;
  const tick = () => { $('#segundos').textContent = `(${s})`; if (s-- <= 0) voltarInicio(); };
  clearInterval(fimTimer);
  tick();
  fimTimer = setInterval(tick, 1000);
}

function voltarInicio() {
  clearInterval(fimTimer);
  mostrar('inicio');
}

// ── Eventos ──────────────────────────────────────────────────
document.querySelectorAll('[data-estilo]').forEach((b) =>
  b.addEventListener('click', () => sessao(b.dataset.estilo)));
$('#terminar').addEventListener('click', voltarInicio);

// Indicador discreto de envios pendentes (canto inferior direito)
aoMudarEstado(({ pendentes, erro }) => {
  const el = $('#estado-envio');
  el.hidden = pendentes === 0 && !erro;
  el.classList.toggle('erro', Boolean(erro));
  el.textContent = erro
    ? `⚠︎ ${pendentes ? `${pendentes} por enviar — ` : ''}${erro}`
    : `☁︎ a enviar ${pendentes} ${pendentes === 1 ? 'ficheiro' : 'ficheiros'}…`;
});
if (!firebaseConfigurado) console.warn('Firebase por configurar em js/config.js — as fotos ficam guardadas só no iPad.');
processarFila(); // retoma envios que tenham ficado pendentes

// Ecrã sempre ligado (Safari 16.4+)
let wakeLock;
async function manterLigado() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* ignora */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { manterLigado(); ligarCamara().catch(() => {}); }
});
manterLigado();
ligarCamara().catch(() => {});

// Impede zoom/scroll acidental na cabine
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
