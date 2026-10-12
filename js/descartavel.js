// Câmara descartável nos telemóveis dos convidados.
// Cada pessoa tem N fotos, não as vê nem apaga; tudo é revelado à hora marcada.
import { filmeDescartavel } from './effects.js';
import { enfileirar, processarFila, aoMudarEstado, firebase, urlPublico, firebaseConfigurado } from './storage.js';
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
// Erros que o Safari lança por coisas normais (vídeo interrompido, etc.) — não interessam ao convidado
const inofensivo = (r) => ['AbortError', 'NotAllowedError'].includes(r?.name) || /play\(\)|interrupted|ResizeObserver/i.test(r?.message || String(r));
window.addEventListener('unhandledrejection', (e) => { if (!inofensivo(e.reason)) mostrarErro(`Erro: ${e.reason?.message || e.reason}`); });

// Ecrãs que têm de caber inteiros (abertura e máquina): depois de rodar o telemóvel
// ou de fechar o teclado, o iPhone às vezes deixa a página deslocada — voltar ao topo.
function realinhar() {
  if (document.activeElement?.tagName === 'INPUT') return; // a escrever: não mexer
  const ativo = document.querySelector('.ecra-d.ativo')?.id;
  if (ativo === 'abertura' || ativo === 'corpo') {
    window.scrollTo(0, 0);
    // o foco no campo do nome pode deslocar a própria secção (mesmo com overflow: hidden)
    for (const el of document.querySelectorAll('#abertura, #palco, #corpo, .maquina-d')) el.scrollTop = el.scrollLeft = 0;
  }
}
window.addEventListener('orientationchange', () => setTimeout(realinhar, 350));
window.addEventListener('resize', () => setTimeout(realinhar, 100));

// Textos
document.querySelectorAll('[data-nomes]').forEach((el) => (el.textContent = cfg.nomes));
$('#cinta-txt').textContent = Array(6).fill(`${cfg.nomes} — ${cfg.data} — cor 400 — ${D.fotos} exp. — `).join('');
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
  // Câmara nova: o contador está em "S" e é preciso rodar o rolo pela primeira vez
  return { id, nome: limpo || 'Anónimo', tiradas: 0, porAvancar: true, primeiro: true };
}
const pastaDoRolo = (r) => `${r.id}--${r.nome}`;

// Limite de fotos desta câmara: 5 por defeito, mas os noivos podem dar mais na galeria
let limite = D.fotos;
const restantes = () => Math.max(0, limite - rolo.tiradas);
async function atualizarLimite() {
  if (!rolo || !firebaseConfigurado) return;
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
  el.textContent = rolo.primeiro ? 'S' : restantes();
  $('.contador').classList.remove('mudou'); void el.offsetWidth; $('.contador').classList.add('mudou');
  $('#disparar').classList.toggle('bloqueado', rolo.porAvancar);
  $('#roda').classList.toggle('avancar', rolo.porAvancar);
  const dica = $('#dica');
  dica.classList.toggle('avancar', rolo.porAvancar);
  dica.textContent = rolo.primeiro
    ? 'primeira vez: roda o rolo até travar ↓'
    : rolo.porAvancar
    ? 'roda o rolo para baixo →'
    : restantes() === 1 ? 'última fotografia.' : 'aponta e dispara';
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
    try {
      await revelarEEnviar(canvas, rolo.tiradas, new Date());
    } catch (e) {
      // nunca deixar a câmara encravada por causa do envio
      console.error('Não foi possível preparar/guardar a foto', e);
    }

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
const volta = () => (rolo.primeiro ? VOLTA * 2.2 : VOLTA);
function rolarPronto() {
  rolo.porAvancar = false;
  rolo.primeiro = false;
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
  if (arrasto.acumulado >= volta()) { arrasto = null; rolarPronto(); }
});
roda.addEventListener('pointerup', async () => {
  if (!arrasto) return;
  const tocou = !arrasto.moveu;
  arrasto = null;
  if (tocou && rolo.porAvancar) { // toque simples: a roda avança sozinha
    for (let i = 0; i < volta() / DENTE; i++) { avancarDente(); await esperar(55); }
    rolarPronto();
  }
});
roda.addEventListener('pointercancel', () => (arrasto = null));

// ── Fim do rolo ──────────────────────────────────────────────
let contagemTimer;
function terminarRolo() {
  video.srcObject?.getTracks().forEach((t) => t.stop());
  $('#env-nome').textContent = rolo.nome;
  $('#env-exp').textContent = rolo.tiradas;
  // Número de envelope estável, tirado do id da câmara
  const num = [...rolo.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 10000, 7);
  $('#env-num').textContent = `Nº ${String(num).padStart(4, '0')}`;
  mostrar('fim');
  const tick = () => {
    const ms = revelacao - Date.now();
    if (ms <= 0) { clearInterval(contagemTimer); location.reload(); return; }
    const h = Math.floor(ms / 3.6e6), m = Math.floor((ms % 3.6e6) / 6e4), s = Math.floor((ms % 6e4) / 1000);
    $('#falta').textContent = h >= 48
      ? `faltam ${Math.round(h / 24)} dias`
      : `faltam ${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
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
        ? 'Os noivos deram-te mais 1 fotografia.'
        : `Os noivos deram-te mais ${restantes()} fotografias.`;
      $('#mais').hidden = false;
    }
  }, 15_000);
}
let maisTimer;

aoMudarEstado(({ pendentes, erro }) => {
  const el = $('#envio');
  el.hidden = pendentes === 0;
  el.textContent = erro ? `${pendentes} à espera de rede` : `a enviar ${pendentes}…`;
  $('#envio-fim').textContent = pendentes
    ? `a enviar ${pendentes} ${pendentes === 1 ? 'ficheiro' : 'ficheiros'}… não feches já.`
    : 'tudo entregue. podes fechar.';
});

// ── Revelação: galeria de todos os rolos ─────────────────────
const nomeDoRolo = (pasta) => pasta.split('--').slice(1).join('--') || 'Anónimo';
let lista = [], atual = 0;

async function mostrarRevelacao() {
  mostrar('revelacao');
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
      ? 'o laboratório ainda está a revelar. volta mais logo.'
      : `Não foi possível abrir as fotos (${e?.code || e?.message}).`;
    return;
  }
  rolos = rolos.filter((r) => r.fotos.length);
  const meu = rolo && pastaDoRolo(rolo);
  rolos.sort((a, b) => (b.pasta === meu) - (a.pasta === meu) || a.nome.localeCompare(b.nome, 'pt'));
  const total = rolos.reduce((s, r) => s + r.fotos.length, 0);
  $('#rev-resumo').textContent = total
    ? `${rolos.length} ${rolos.length === 1 ? 'rolo' : 'rolos'} · ${total} fotografias`
    : 'nenhum rolo entregue.';

  const cont = $('#rolos');
  cont.replaceChildren();
  for (const r of rolos) {
    const sec = document.createElement('section');
    sec.className = `rolo${r.pasta === meu ? ' meu' : ''}`;
    const topo = document.createElement('div');
    topo.className = 'rolo-topo';
    const h = document.createElement('h3');
    h.textContent = r.nome;
    const info = document.createElement('small');
    info.textContent = `${r.pasta === meu ? 'o teu rolo · ' : ''}${r.fotos.length} exp.`;
    const zip = document.createElement('button');
    zip.className = 'rolo-zip';
    zip.textContent = 'descarregar rolo';
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

// ── Abertura: a primeira vez que se abre a câmara ────────────
function passo(n, txt) {
  $('#passo-n').textContent = String(n).padStart(2, '0');
  $('#passo-txt').textContent = txt;
}

// 1. Rasgar a fita da caixa (arrastar para a direita; um toque também serve)
function iniciarAbertura() {
  mostrar('abertura');
  passo(1, 'puxa a fita para abrir a caixa');
  const tira = $('#tira-rasgar');
  let arr = null, rasgado = 0, ultimoSom = 0, aberta = false;
  function definir(p) {
    rasgado = Math.max(rasgado, Math.min(100, p));
    tira.style.setProperty('--rasgado', `${rasgado}%`);
    $('#pack-tampa').style.transform = `rotate(${-rasgado * 0.05}deg)`;
    if (rasgado - ultimoSom > 4) { ultimoSom = rasgado; som.rasgar(); navigator.vibrate?.(3); }
    if (rasgado >= 96 && !aberta) { aberta = true; abrirCaixa(); }
  }
  const posicao = (x) => { const r = tira.getBoundingClientRect(); return ((x - r.left) / r.width) * 100; };
  tira.addEventListener('pointerdown', (e) => {
    som.ativarSom();
    $('#pack').classList.add('a-rasgar');
    // Se o dedo começa perto da parte já rasgada, o rasgão segue o dedo; senão conta só o arrasto
    arr = { x0: e.clientX, base: rasgado, seguir: posicao(e.clientX) <= rasgado + 18, moveu: false };
    tira.setPointerCapture(e.pointerId);
  });
  tira.addEventListener('pointermove', (e) => {
    if (!arr || aberta) return;
    const dx = e.clientX - arr.x0;
    if (Math.abs(dx) > 4) arr.moveu = true;
    const r = tira.getBoundingClientRect();
    definir(Math.max(arr.base + (dx / r.width) * 100, arr.seguir ? posicao(e.clientX) : 0));
  });
  // Ao largar: um toque, ou já mais de metade rasgada, acaba de rasgar sozinho
  const acabar = async () => { for (let p = rasgado; p <= 100 && !aberta; p += 5) { definir(p); await esperar(28); } };
  tira.addEventListener('pointerup', () => {
    const tocou = arr && !arr.moveu;
    arr = null;
    if (tocou || rasgado >= 55) acabar();
  });
  tira.addEventListener('pointercancel', () => (arr = null));
}

// A tampa salta, a câmara sai da caixa e a caixa cai
async function abrirCaixa() {
  const palco = $('#palco');
  $('#pack-tampa').style.transform = '';
  som.tampaFora();
  palco.classList.add('rasgada');
  await esperar(450);
  som.virar();
  palco.classList.add('a-sair');
  await esperar(750);
  palco.classList.add('fora');
  await esperar(650);
  som.pousar();
  navigator.vibrate?.(15);
  if (D.pedirNome) passoNome();
  else { rolo = novoRolo(''); gravarEstado(); passoFlash(); }
}

// 2. Escrever o nome na etiqueta da câmara
function passoNome() {
  passo(2, 'escreve o teu nome na etiqueta da câmara');
  const et = $('#campo-nome'), input = $('#nome'), ok = $('#passo-ok');
  et.classList.add('chamar');
  ok.hidden = false;
  input.addEventListener('focus', () => et.classList.remove('chamar'), { once: true });
  const confirmar = () => {
    if (!input.value.trim()) { input.focus(); return; }
    input.blur();
    input.readOnly = true;
    setTimeout(realinhar, 300); // o teclado fecha
    ok.hidden = true;
    rolo = novoRolo(input.value);
    gravarEstado();
    passoFlash();
  };
  ok.onclick = confirmar;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmar(); });
}

// 3. Carregar o flash: segurar o botão até a luz acender
function passoFlash() {
  passo(3, 'carrega no botão do flash e segura até a luz acender');
  const b = $('#btn-flash'), led = $('#led');
  const SEG = 1.8;
  let carga = null;
  b.classList.add('chamar');
  b.oncontextmenu = (e) => e.preventDefault();
  b.onpointerdown = (e) => {
    e.preventDefault();
    som.ativarSom();
    b.setPointerCapture(e.pointerId);
    b.classList.add('premido');
    b.classList.remove('chamar');
    const t0 = performance.now();
    carga = { s: som.carregarFlash(SEG), raf: 0 };
    const tick = () => {
      const p = Math.min(1, (performance.now() - t0) / (SEG * 1000));
      led.style.setProperty('--carga', p);
      if (p >= 1) {
        carga.s.parar(true);
        carga = null;
        b.onpointerdown = b.onpointerup = b.onpointercancel = null;
        b.classList.remove('premido');
        led.classList.add('aceso');
        navigator.vibrate?.(25);
        flashPronto();
        return;
      }
      carga.raf = requestAnimationFrame(tick);
    };
    carga.raf = requestAnimationFrame(tick);
  };
  const soltar = () => {
    if (!carga) return;
    cancelAnimationFrame(carga.raf);
    carga.s.parar(false);
    carga = null;
    b.classList.remove('premido');
    b.classList.add('chamar');
    led.style.setProperty('--carga', 0);
    passo(3, 'tens de segurar até a luz acender. outra vez.');
  };
  b.onpointerup = soltar;
  b.onpointercancel = soltar;
}

// 4. Virar a câmara: daqui em diante é a máquina, vista por trás
async function flashPronto() {
  passo(4, 'flash pronto. agora vira a câmara.');
  await esperar(1000);
  som.virar();
  $('#cf').classList.add('virar');
  await esperar(400);
  entrarNaMaquina(true);
}

// ── Arranque ─────────────────────────────────────────────────
document.addEventListener('pointerdown', () => som.ativarSom()); // o iOS só deixa haver som depois de um toque
$('#disparar').addEventListener('click', disparar);
$('#virar').addEventListener('click', () => {
  lado = lado === 'user' ? 'environment' : 'user';
  abrirCamara();
});
$('#aviso-repetir').addEventListener('click', abrirCamara);
$('#mais-continuar').addEventListener('click', () => { som.ativarSom(); entrarNaMaquina(); });

function entrarNaMaquina(virada = false) {
  clearInterval(maisTimer); clearInterval(contagemTimer);
  $('#dono').textContent = rolo.nome;
  $('#corpo').classList.toggle('entrar-virada', virada);
  mostrar('corpo');
  atualizarControlos();
  abrirCamara();
}

processarFila(); // envia fotos que tenham ficado por enviar numa visita anterior

// Sabe o limite atual antes de decidir o ecrã (no máximo 3 s à espera)
await Promise.race([atualizarLimite(), esperar(3000)]);

if (Date.now() >= revelacao) {
  mostrarRevelacao();
} else if (rolo && !rolo.primeiro && restantes() <= 0) {
  terminarRolo();
} else if (rolo) {
  entrarNaMaquina();
} else {
  iniciarAbertura();
}
