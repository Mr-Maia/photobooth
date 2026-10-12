// Câmara descartável nos telemóveis dos convidados.
// Cada pessoa tem N fotos, não as vê nem apaga; tudo é revelado à hora marcada.
import { filmeDescartavel } from './effects.js';
import { enfileirar, processarFila, aoMudarEstado, firebase, urlPublico } from './storage.js';
import { iniciarLampadas } from './lampadas.js';
import { guardar } from './guardar.js';
import * as som from './sons.js';

const cfg = window.PHOTOBOOTH_CONFIG;
const D = cfg.descartavel;
const $ = (s) => document.querySelector(s);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const revelacao = new Date(D.revelacao);

function mostrarErro(msg) {
  const el = $('#erro');
  el.textContent = msg; el.hidden = false;
  clearTimeout(mostrarErro.t);
  mostrarErro.t = setTimeout(() => (el.hidden = true), 10_000);
}
window.addEventListener('unhandledrejection', (e) => mostrarErro(`Erro: ${e.reason?.message || e.reason}`));

// Textos
document.querySelectorAll('[data-nomes]').forEach((el) => (el.textContent = cfg.nomes));
document.querySelectorAll('[data-fotos]').forEach((el) => (el.textContent = D.fotos));
const quandoRevela = revelacao.toLocaleString('pt-PT', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
  .replace(',', ' às');
document.querySelectorAll('[data-revelacao]').forEach((el) => (el.textContent = quandoRevela));
if (!D.pedirNome) $('#campo-nome').hidden = true;

function mostrar(id) {
  document.querySelectorAll('.ecra-d').forEach((e) => e.classList.toggle('ativo', e.id === id));
  window.scrollTo(0, 0);
}

// ── Estado do rolo (fica no telemóvel) ───────────────────────
const CHAVE = 'descartavel-rolo';
function lerEstado() {
  try { return JSON.parse(localStorage.getItem(CHAVE)) || null; } catch { return null; }
}
function gravarEstado() {
  try { localStorage.setItem(CHAVE, JSON.stringify(rolo)); } catch { /* modo privado: o rolo só dura esta visita */ }
}
// Para testes: descartavel.html?reiniciar começa um rolo novo neste telemóvel
if (new URLSearchParams(location.search).has('reiniciar')) {
  try { localStorage.removeItem(CHAVE); } catch { /* ignora */ }
  history.replaceState(null, '', location.pathname);
}
let rolo = lerEstado();

function novoRolo(nome) {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const id = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => abc[b % abc.length]).join('');
  const limpo = nome.normalize('NFC').replace(/[/#[\]*?\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30);
  return { id, nome: limpo || 'Anónimo', tiradas: 0, porAvancar: false };
}
const pastaDoRolo = (r) => `${r.id}--${r.nome}`;

// Limite de fotos desta câmara: 5 por defeito, mas os noivos podem dar mais na galeria
let limite = D.fotos;
const restantes = () => Math.max(0, limite - rolo.tiradas);
async function atualizarLimite() {
  if (!rolo) return;
  try {
    const r = await fetch(urlPublico(`descartavel-limites/${rolo.id}.json`), { cache: 'no-store' });
    if (!r.ok) return; // ainda ninguém mexeu nesta câmara
    const n = Number((await r.json()).fotos);
    if (n >= 1 && n <= 99) limite = n;
  } catch { /* sem rede ou Firebase por configurar: fica o limite que já sabíamos */ }
}

// ── Câmara ───────────────────────────────────────────────────
const video = $('#video');
let lado = 'environment';

async function ligarCamara() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este browser não dá acesso à câmara. Abre o link no Safari ou no Chrome.');
  video.srcObject?.getTracks().forEach((t) => t.stop());
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: lado }, width: { ideal: 1920 }, height: { ideal: 1920 } },
  });
  video.srcObject = stream;
  $('.visor-d').classList.toggle('selfie', lado === 'user');
  video.play().catch(() => {});
  for (let i = 0; i < 100 && !(video.videoWidth && video.readyState >= 2); i++) await esperar(50);
  if (!video.videoWidth) throw new Error('A câmara não está a enviar imagem.');
}

async function abrirCamara() {
  $('#aviso').hidden = true;
  try {
    await ligarCamara();
  } catch (e) {
    $('#aviso-txt').textContent = e?.name === 'NotAllowedError'
      ? 'Precisamos da câmara! Dá autorização quando o telemóvel perguntar. Se já recusaste: no iPhone, Definições → Safari → Câmara → Permitir.'
      : e?.message || String(e);
    $('#aviso').hidden = false;
  }
}

// Captura exatamente o que se vê no visor, com o lado maior a 1600 px
function capturar() {
  const visor = $('.visor-d');
  const aspeto = visor.clientWidth / visor.clientHeight;
  const W = aspeto >= 1 ? 1600 : Math.round(1600 * aspeto);
  const H = aspeto >= 1 ? Math.round(1600 / aspeto) : 1600;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const vw = video.videoWidth, vh = video.videoHeight;
  let sw = vw, sh = vh, sx = 0, sy = 0;
  if (vw / vh > aspeto) { sw = vh * aspeto; sx = (vw - sw) / 2; } else { sh = vw / aspeto; sy = (vh - sh) / 2; }
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, W, H);
  return c;
}

const paraBlob = (canvas, q) => new Promise((r) => canvas.toBlob(r, 'image/jpeg', q));

async function revelarEEnviar(canvas, numero, quando) {
  await esperar(30); // deixa a animação do disparo correr antes do trabalho pesado
  filmeDescartavel(canvas, quando);
  const mini = document.createElement('canvas');
  const k = 400 / Math.max(canvas.width, canvas.height);
  mini.width = Math.round(canvas.width * k); mini.height = Math.round(canvas.height * k);
  mini.getContext('2d').drawImage(canvas, 0, 0, mini.width, mini.height);
  const nn = String(numero).padStart(2, '0');
  const pasta = `descartavel/${pastaDoRolo(rolo)}`;
  await enfileirar([
    { caminho: `${pasta}/${nn}.jpg`, blob: await paraBlob(canvas, 0.86) },
    { caminho: `${pasta}/${nn}-mini.jpg`, blob: await paraBlob(mini, 0.7) },
  ]);
}

// ── Interface da máquina ─────────────────────────────────────
function atualizarControlos() {
  const el = $('#restantes');
  el.textContent = restantes();
  $('.contador').classList.remove('mudou'); void el.offsetWidth; $('.contador').classList.add('mudou');
  $('#disparar').classList.toggle('bloqueado', rolo.porAvancar);
  $('#roda').classList.toggle('avancar', rolo.porAvancar);
  const dica = $('#dica');
  dica.classList.toggle('avancar', rolo.porAvancar);
  dica.textContent = rolo.porAvancar
    ? 'Avança o rolo — roda para baixo ➜'
    : restantes() === 1 ? 'Última foto! Faz valer a pena' : 'Aponta e carrega no botão';
}

let aDisparar = false;
async function disparar() {
  if (aDisparar) return;
  som.ativarSom();
  if (rolo.porAvancar) {
    const r = $('#roda');
    r.classList.remove('abanar'); void r.offsetWidth; r.classList.add('abanar');
    return;
  }
  if (!video.videoWidth || restantes() <= 0) return;
  aDisparar = true;
  try {
    const canvas = capturar();
    som.cliqueDescartavel();
    navigator.vibrate?.(30);
    const f = $('#flash');
    f.classList.remove('disparar'); void f.offsetWidth; f.classList.add('disparar');

    rolo.tiradas += 1;
    rolo.porAvancar = rolo.tiradas < limite;
    gravarEstado();
    atualizarControlos();
    await revelarEEnviar(canvas, rolo.tiradas, new Date());

    if (rolo.tiradas >= limite) {
      await esperar(900);
      terminarRolo();
    }
  } finally {
    aDisparar = false;
  }
}

// Roda de avançar o rolo: arrastar para baixo (ou tocar)
const DENTE = 16, VOLTA = 150;
let arrasto = null, deslocar = 0;
function avancarDente() {
  deslocar += DENTE / 2;
  $('#dentes').style.setProperty('--deslocar', `${deslocar}px`);
  som.catraca();
  navigator.vibrate?.(4);
}
function rolarPronto() {
  rolo.porAvancar = false;
  gravarEstado();
  som.roloPronto();
  atualizarControlos();
}
const roda = $('#roda');
roda.addEventListener('pointerdown', (e) => {
  som.ativarSom();
  if (!rolo.porAvancar) return;
  arrasto = { y: e.clientY, x: e.clientX, acumulado: 0, dente: 0, moveu: false };
  roda.setPointerCapture(e.pointerId);
});
roda.addEventListener('pointermove', (e) => {
  if (!arrasto) return;
  const d = Math.abs(e.clientY - arrasto.y) + Math.abs(e.clientX - arrasto.x) * 0.5;
  arrasto.y = e.clientY; arrasto.x = e.clientX;
  arrasto.acumulado += d; arrasto.dente += d;
  if (arrasto.acumulado > 6) arrasto.moveu = true;
  while (arrasto.dente >= DENTE) { arrasto.dente -= DENTE; avancarDente(); }
  if (arrasto.acumulado >= VOLTA) { arrasto = null; rolarPronto(); }
});
roda.addEventListener('pointerup', async () => {
  if (!arrasto) return;
  const tocou = !arrasto.moveu;
  arrasto = null;
  if (tocou && rolo.porAvancar) { // toque simples: a roda avança sozinha
    for (let i = 0; i < 9; i++) { avancarDente(); await esperar(55); }
    rolarPronto();
  }
});
roda.addEventListener('pointercancel', () => (arrasto = null));

// ── Fim do rolo ──────────────────────────────────────────────
let contagemTimer;
function terminarRolo() {
  video.srcObject?.getTracks().forEach((t) => t.stop());
  mostrar('fim');
  const tick = () => {
    const ms = revelacao - Date.now();
    if (ms <= 0) { clearInterval(contagemTimer); location.reload(); return; }
    const h = Math.floor(ms / 3.6e6), m = Math.floor((ms % 3.6e6) / 6e4), s = Math.floor((ms % 6e4) / 1000);
    $('#falta').textContent = h >= 48
      ? `Faltam ${Math.round(h / 24)} dias`
      : `Faltam ${h} h ${String(m).padStart(2, '0')} min ${String(s).padStart(2, '0')} s`;
  };
  tick();
  clearInterval(contagemTimer);
  contagemTimer = setInterval(tick, 1000);
  $('#mais').hidden = true;
  clearInterval(maisTimer);
  maisTimer = setInterval(async () => {
    await atualizarLimite();
    if (restantes() > 0) {
      clearInterval(maisTimer);
      $('#mais-txt').textContent = restantes() === 1
        ? '🎉 Os noivos deram-te mais 1 foto!'
        : `🎉 Os noivos deram-te mais ${restantes()} fotos!`;
      $('#mais').hidden = false;
    }
  }, 15_000);
}
let maisTimer;

aoMudarEstado(({ pendentes, erro }) => {
  const el = $('#envio');
  el.hidden = pendentes === 0;
  el.textContent = erro ? `⏳ ${pendentes} à espera de rede…` : `☁︎ a enviar ${pendentes}…`;
  $('#envio-fim').textContent = pendentes
    ? `A enviar as últimas fotos (${pendentes})… não feches já esta página.`
    : 'Tudo enviado ✓ Já podes fechar.';
});

// ── Revelação: galeria de todos os rolos ─────────────────────
const nomeDoRolo = (pasta) => pasta.split('--').slice(1).join('--') || 'Anónimo';
let lista = [], atual = 0;

async function mostrarRevelacao() {
  mostrar('revelacao');
  iniciarLampadas();
  let rolos;
  try {
    const fb = await firebase();
    const raiz = await fb.listAll(fb.ref(fb.storage, 'descartavel'));
    rolos = await Promise.all(raiz.prefixes.map(async (p) => {
      const r = await fb.listAll(p);
      const fotos = r.items.map((i) => i.name).filter((n) => /^\d\d\.jpg$/.test(n)).sort();
      return { pasta: p.name, nome: nomeDoRolo(p.name), fotos };
    }));
  } catch (e) {
    $('#rev-resumo').textContent = e?.code === 'storage/unauthorized'
      ? 'O laboratório ainda está a trabalhar… volta mais logo!'
      : `Não foi possível abrir as fotos (${e?.code || e?.message}).`;
    return;
  }
  rolos = rolos.filter((r) => r.fotos.length);
  const meu = rolo && pastaDoRolo(rolo);
  rolos.sort((a, b) => (b.pasta === meu) - (a.pasta === meu) || a.nome.localeCompare(b.nome, 'pt'));
  const total = rolos.reduce((s, r) => s + r.fotos.length, 0);
  $('#rev-resumo').textContent = total
    ? `${total} fotografias de ${rolos.length} ${rolos.length === 1 ? 'convidado' : 'convidados'}`
    : 'Ainda ninguém usou a câmara.';

  const cont = $('#rolos');
  cont.replaceChildren();
  for (const r of rolos) {
    const sec = document.createElement('section');
    sec.className = `rolo${r.pasta === meu ? ' meu' : ''}`;
    const topo = document.createElement('div');
    topo.className = 'rolo-topo';
    const h = document.createElement('h3');
    h.textContent = r.pasta === meu ? `${r.nome} (o teu rolo)` : r.nome;
    const info = document.createElement('small');
    info.textContent = `${r.fotos.length} fotos`;
    const zip = document.createElement('button');
    zip.className = 'rolo-zip';
    zip.textContent = 'Descarregar rolo';
    zip.addEventListener('click', () => descarregarRolo(r, zip));
    const titulo = document.createElement('div');
    titulo.append(h, info);
    topo.append(titulo, zip);

    const grelha = document.createElement('div');
    grelha.className = 'contactos';
    for (const f of r.fotos) {
      const idx = lista.length;
      const caminho = `descartavel/${r.pasta}/${f}`;
      lista.push({ url: urlPublico(caminho), nome: `${r.nome} - ${f}`, legenda: `${r.nome} · ${f.slice(0, 2)}` });
      const b = document.createElement('button');
      const img = document.createElement('img');
      img.loading = 'lazy'; img.alt = '';
      img.src = urlPublico(caminho.replace('.jpg', '-mini.jpg'));
      img.onerror = () => { img.onerror = null; img.src = urlPublico(caminho); };
      b.append(img);
      b.addEventListener('click', () => abrirFoto(idx));
      grelha.append(b);
    }
    sec.append(topo, grelha);
    cont.append(sec);
  }
}

function abrirFoto(i) {
  atual = (i + lista.length) % lista.length;
  const f = lista[atual];
  $('#foto-img').src = f.url;
  $('#foto-legenda').textContent = f.legenda;
  if (!$('#foto').open) $('#foto').showModal();
}
$('#foto-ant').addEventListener('click', () => abrirFoto(atual - 1));
$('#foto-seg').addEventListener('click', () => abrirFoto(atual + 1));
$('#foto .fechar').addEventListener('click', () => $('#foto').close());
$('#foto-guardar').addEventListener('click', () => guardar([lista[atual]]));

async function descarregarRolo(r, botao) {
  const texto = botao.textContent;
  botao.disabled = true;
  try {
    const zip = new JSZip();
    let n = 0;
    await Promise.all(r.fotos.map(async (f) => {
      const resp = await fetch(urlPublico(`descartavel/${r.pasta}/${f}`));
      if (resp.ok) zip.file(f, await resp.blob());
      botao.textContent = `A juntar… ${++n}/${r.fotos.length}`;
    }));
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${cfg.nomes} - rolo de ${r.nome}.zip`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  } catch (e) {
    mostrarErro(`Não foi possível descarregar (${e.message}).`);
  } finally {
    botao.disabled = false;
    botao.textContent = texto;
  }
}

// ── Arranque ─────────────────────────────────────────────────
$('#abrir').addEventListener('click', async () => {
  som.ativarSom();
  if (!rolo) {
    rolo = novoRolo($('#nome').value);
    gravarEstado();
  }
  entrarNaMaquina();
});
$('#nome').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#abrir').click(); });
$('#disparar').addEventListener('click', disparar);
$('#virar').addEventListener('click', () => {
  lado = lado === 'user' ? 'environment' : 'user';
  abrirCamara();
});
$('#aviso-repetir').addEventListener('click', abrirCamara);
$('#mais-continuar').addEventListener('click', () => { som.ativarSom(); entrarNaMaquina(); });

function entrarNaMaquina() {
  clearInterval(maisTimer); clearInterval(contagemTimer);
  $('#dono').textContent = rolo.nome;
  mostrar('corpo');
  atualizarControlos();
  abrirCamara();
}

processarFila(); // envia fotos que tenham ficado por enviar numa visita anterior

// Sabe o limite atual antes de decidir o ecrã (no máximo 3 s à espera)
await Promise.race([atualizarLimite(), esperar(3000)]);

if (Date.now() >= revelacao) {
  mostrarRevelacao();
} else if (rolo && restantes() <= 0) {
  terminarRolo();
} else if (rolo) {
  $('#nome').value = rolo.nome;
  $('#campo-nome').hidden = true;
  $('#abrir').textContent = `Continuar (${restantes()} fotos)`;
  mostrar('caixa');
} else {
  mostrar('caixa');
}
