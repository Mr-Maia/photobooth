import { aplicarVintage, comporTira } from './effects.js?v=9';
import { enfileirar, processarFila, aoMudarEstado, firebaseConfigurado } from './storage.js?v=9';
import { iniciarLampadas } from './lampadas.js?v=9';
import * as som from './sons.js?v=9';

const cfg = window.PHOTOBOOTH_CONFIG;
const $ = (s) => document.querySelector(s);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Qualquer erro inesperado aparece no ecrã (em vez de "não acontece nada")
function mostrarErro(msg) {
  const el = $('#erro');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(mostrarErro.t);
  mostrarErro.t = setTimeout(() => (el.hidden = true), 12_000);
}
// Erros que o Safari lança por coisas normais (vídeo interrompido, etc.) — não interessam ao convidado
const inofensivo = (r) => ['AbortError', 'NotAllowedError'].includes(r?.name) || /play\(\)|interrupted|ResizeObserver/i.test(r?.message || String(r));
window.addEventListener('error', (e) => { if (!inofensivo(e.error || e)) mostrarErro(`Erro: ${e.message}`); });
window.addEventListener('unhandledrejection', (e) => { if (!inofensivo(e.reason)) mostrarErro(`Erro: ${e.reason?.message || e.reason}`); });

const video = $('#video');
const FOTO_W = 1600, FOTO_H = 1200; // resolução de cada foto guardada (4:3)
let aDecorrer = false;

document.querySelectorAll('[data-nomes]').forEach((el) => (el.textContent = cfg.nomes));
const redesenharLampadas = iniciarLampadas();

function mostrar(id) {
  document.querySelectorAll('.ecra').forEach((e) => e.classList.toggle('ativo', e.id === id));
  document.getElementById(id).scrollTo(0, 0);
  if (id === 'inicio') requestAnimationFrame(redesenharLampadas);
}

// ── Câmara ───────────────────────────────────────────────────
const comLimite = (p, ms, msg) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);

let pedidoCamara;
function ligarCamara() {
  if (video.srcObject?.active) return Promise.resolve();
  if (!navigator.mediaDevices?.getUserMedia) {
    return Promise.reject(new Error(location.protocol !== 'https:'
      ? 'A câmara só funciona com https://.'
      : 'Este browser não dá acesso à câmara. Abre o site no Safari.'));
  }
  pedidoCamara ??= navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1440 } },
  }).then((stream) => { video.srcObject = stream; })
    .finally(() => { pedidoCamara = undefined; });
  return pedidoCamara;
}

// Espera até haver imagem a sério no vídeo (o ecrã da câmara já tem de estar visível)
async function videoPronto() {
  video.play().catch(() => {});
  for (let i = 0; i < 100 && !(video.videoWidth && video.readyState >= 2); i++) await esperar(50);
  if (!video.videoWidth) throw new Error('A câmara não está a enviar imagem.');
}

function explicarErroCamara(e) {
  if (e?.name === 'NotAllowedError') {
    return 'O acesso à câmara foi recusado. No iPad: Definições → Apps → Safari → Câmara → Permitir. Depois recarrega a página.';
  }
  if (e?.name === 'NotReadableError') return 'A câmara está a ser usada por outra app. Fecha-a e tenta outra vez.';
  return e?.message || String(e);
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
const reiniciarAnimacao = (el, classe) => { el.classList.remove(classe); void el.offsetWidth; el.classList.add(classe); };

async function sessao(estilo) {
  if (aDecorrer) return;
  aDecorrer = true;
  som.ativarSom(); // ainda dentro do toque — o iOS exige isto para haver som
  const filtro = estilo === 'pb' ? 'grayscale(1) contrast(1.2) sepia(.12)' : 'saturate(.75) sepia(.22) contrast(1.05)';
  document.documentElement.style.setProperty('--filtro-previo', filtro);

  // Mostra logo o ecrã da câmara — o toque tem sempre resposta imediata
  const n = cfg.numeroFotos;
  $('#aviso').hidden = true;
  $('#pose').textContent = 'A preparar a câmara…';
  $('#luzes').replaceChildren(...Array.from({ length: n }, () => document.createElement('i')));
  $('#miniaturas').replaceChildren(...Array.from({ length: n }, () => document.createElement('div')));
  mostrar('camara');

  try {
    try {
      await comLimite(ligarCamara(), 20_000, 'A câmara não respondeu.');
      await videoPronto();
    } catch (e) {
      $('#aviso-txt').textContent = explicarErroCamara(e);
      $('#aviso').hidden = false;
      return;
    }

    const fotos = [];
    const contagem = $('#contagem'), numero = contagem.querySelector('span');
    som.projetorLigar();
    for (let i = 0; i < n; i++) {
      $('#pose').textContent = `Pose ${i + 1} de ${n}`;
      await esperar(i === 0 ? 1200 : 500);
      contagem.hidden = false;
      for (let s = cfg.segundosContagem; s > 0; s--) {
        numero.textContent = s;
        reiniciarAnimacao(contagem, 'tic');
        som.tique(s === 1);
        await esperar(1000);
      }
      contagem.hidden = true;
      const foto = capturar();
      som.disparo();
      reiniciarAnimacao($('#flash'), 'disparar');
      fotos.push(foto);
      $('#luzes').children[i].classList.add('acesa');

      const img = document.createElement('img');
      img.src = foto.toDataURL('image/jpeg', 0.5);
      img.style.filter = filtro;
      $('#miniaturas').children[i].replaceWith(img);
      await esperar(cfg.segundosEntreFotos * 1000);
    }

    som.projetorDesligar();
    mostrar('revelar');
    const pararMotor = som.revelacao();
    await esperar(80); // deixa o ecrã "a revelar" aparecer antes do trabalho pesado
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
    try {
      await enfileirar(ficheiros);
    } catch (e) {
      console.error(e);
      mostrarErro('Atenção: esta sessão pode não ter ficado guardada.');
    }

    await esperar(1200); // um bocadinho de suspense na máquina
    pararMotor();
    som.campainha();
    mostrarFinal(URL.createObjectURL(tiraBlob), id);
  } catch (e) {
    console.error(e);
    som.projetorDesligar();
    mostrarErro(`Algo correu mal: ${e?.message || e}`);
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
  const tick = () => { $('#segundos').textContent = `· ${s}`; if (s-- <= 0) voltarInicio(); };
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
$('#aviso-voltar').addEventListener('click', voltarInicio);

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
async function manterLigado() {
  try { await navigator.wakeLock?.request('screen'); } catch { /* ignora */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') manterLigado();
});
manterLigado();
ligarCamara().catch(() => {}); // pede já a autorização da câmara (sem bloquear nada)

// Impede o zoom com dois dedos (o scroll continua a funcionar se algum ecrã não couber)
document.addEventListener('gesturestart', (e) => e.preventDefault());

// Ao rodar o iPad: volta ao topo do ecrã ativo e redesenha o letreiro
window.addEventListener('orientationchange', () => setTimeout(() => {
  document.querySelector('.ecra.ativo')?.scrollTo(0, 0);
  redesenharLampadas();
}, 300));

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
