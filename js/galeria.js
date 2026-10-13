// Galeria privada dos noivos: login Google, cabine + câmaras descartáveis,
// filtrar por pessoa, dar mais fotos a uma câmara, descarregar tudo.
import { firebaseConfigurado, urlPublico } from './storage.js';
import { guardar } from './guardar.js';
import { listarTudo, atualizarCustos } from './custos.js';

const FB_VER = '10.12.2';
const cfg = window.PHOTOBOOTH_CONFIG;
const D = cfg.descartavel;
const $ = (s) => document.querySelector(s);
document.querySelectorAll('[data-nomes]').forEach((el) => (el.textContent = cfg.nomes));

const FICHEIROS = ['tira.jpg', 'foto-1.jpg', 'foto-2.jpg', 'foto-3.jpg', 'foto-4.jpg'];
const SESSOES_POR_ZIP = 40;  // ~150 MB por ZIP, para não rebentar a memória do browser
const FOTOS_POR_ZIP = 250;   // idem, para as descartáveis

let fb, sessoes = [];

// "261012113756-k3m9xq" → Date
function dataDe(id) {
  const [a, m, d, h, mi, s] = id.slice(0, 12).match(/../g).map(Number);
  return new Date(2000 + a, m - 1, d, h, mi, s);
}
const p2 = (n) => String(n).padStart(2, '0');
function nomePasta(id) {
  const d = dataDe(id);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}h${p2(d.getMinutes())}m${p2(d.getSeconds())}`;
}
const horaCurta = (id) => { const d = dataDe(id); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const url = (id, f) => urlPublico(`sessoes/${id}/${f}`);

// ── Arranque / login ─────────────────────────────────────────
async function iniciar() {
  if (!firebaseConfigurado) {
    $('#login').hidden = false;
    $('#entrar').disabled = true;
    erroLogin('O Firebase ainda não está configurado em js/config.js.');
    return;
  }
  const { initializeApp } = await import(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-app.js`);
  const auth = await import(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-auth.js`);
  const st = await import(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-storage.js`);
  const fs = await import(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-firestore.js`);
  const app = initializeApp(cfg.firebase, 'galeria');
  fb = { auth: auth.getAuth(app), storage: st.getStorage(app), db: fs.getFirestore(app), ...auth, ...st, ...fs };

  $('#entrar').addEventListener('click', async () => {
    try { await fb.signInWithPopup(fb.auth, new fb.GoogleAuthProvider()); }
    catch (e) { if (e.code !== 'auth/popup-closed-by-user') erroLogin(`Não foi possível entrar (${e.code}).`); }
  });
  $('#sair').addEventListener('click', () => fb.signOut(fb.auth));

  fb.onAuthStateChanged(fb.auth, async (user) => {
    $('#sair').hidden = !user;
    if (!user) { $('#login').hidden = false; $('#galeria').hidden = true; return; }
    let autorizado = false;
    try { autorizado = (await fb.getDoc(fb.doc(fb.db, 'acesso', user.email.toLowerCase()))).exists(); }
    catch (e) { console.error(e); }
    if (!autorizado) {
      $('#login').hidden = false; $('#galeria').hidden = true;
      erroLogin(`A conta ${user.email} não tem acesso a esta galeria.`);
      return;
    }
    $('#login').hidden = true; $('#galeria').hidden = false;
    await Promise.all([carregarTudo(), carregarAcesso()]);
  });
}

function erroLogin(msg) { const el = $('#login-erro'); el.hidden = false; el.textContent = msg; }

// Separadores
document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
  $('#tab-cabine').hidden = b.dataset.tab !== 'cabine';
  $('#tab-desc').hidden = b.dataset.tab !== 'desc';
  $('#tab-acesso').hidden = b.dataset.tab !== 'acesso';
}));

// ══ Acesso ═══════════════════════════════════════════════════
// Lista em Firestore (/acesso/<email>); as regras do Storage consultam-na.
async function carregarAcesso() {
  const eu = fb.auth.currentUser.email.toLowerCase();
  let docs;
  try { docs = (await fb.getDocs(fb.collection(fb.db, 'acesso'))).docs; }
  catch (e) { $('#acesso-msg').textContent = `Não foi possível ler a lista (${e.code || e.message}).`; return; }
  $('#n-acesso').textContent = `(${docs.length})`;
  const lista = $('#acesso-lista');
  lista.replaceChildren(...docs.sort((a, b) => a.id.localeCompare(b.id)).map((d) => {
    const li = document.createElement('li');
    const info = document.createElement('div');
    const email = document.createElement('span'); email.className = 'acesso-email'; email.textContent = d.id;
    const sub = document.createElement('small');
    const { adicionadoPor, em } = d.data();
    sub.textContent = d.id === eu ? 'és tu'
      : `adicionado por ${adicionadoPor || '—'}${em ? ` · ${em.toDate().toLocaleDateString('pt-PT')}` : ''}`;
    info.append(email, sub);
    li.append(info);
    if (d.id !== eu) {
      const tirar = document.createElement('button');
      tirar.className = 'btn sec'; tirar.textContent = 'Remover';
      tirar.addEventListener('click', async () => {
        if (!confirm(`Tirar o acesso a ${d.id}?`)) return;
        tirar.disabled = true;
        try { await fb.deleteDoc(d.ref); $('#acesso-msg').textContent = `✓ ${d.id} já não tem acesso.`; }
        catch (e) { $('#acesso-msg').textContent = `Não foi possível remover (${e.code || e.message}).`; }
        carregarAcesso();
      });
      li.append(tirar);
    }
    return li;
  }));
}

$('#acesso-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const email = $('#acesso-email').value.trim().toLowerCase();
  const botao = $('#acesso-form button');
  botao.disabled = true;
  try {
    await fb.setDoc(fb.doc(fb.db, 'acesso', email), { adicionadoPor: fb.auth.currentUser.email.toLowerCase(), em: fb.serverTimestamp() });
    $('#acesso-email').value = '';
    $('#acesso-msg').textContent = `✓ ${email} já pode entrar na galeria com a conta Google.`;
  } catch (e) {
    $('#acesso-msg').textContent = e.code === 'permission-denied'
      ? 'Não foi possível: confirma o email (ou essa pessoa já tem acesso).'
      : `Não foi possível adicionar (${e.code || e.message}).`;
  } finally {
    botao.disabled = false;
    carregarAcesso();
  }
});

// Lista os ficheiros da cabine e das descartáveis e atualiza os custos
let caminhosSessoes = [], caminhosDesc = [];
const token = () => fb.auth.currentUser.getIdToken();
async function carregarTudo() {
  await Promise.all([carregarSessoes(), carregarDescartaveis()]);
  atualizarCustos(await token(), [...caminhosSessoes, ...caminhosDesc]);
}

// ══ Cabine ═══════════════════════════════════════════════════
async function carregarSessoes() {
  try {
    caminhosSessoes = await listarTudo(await token(), 'sessoes/');
    sessoes = [...new Set(caminhosSessoes.map((c) => c.split('/')[1]))].filter((n) => /^[0-9]{12}-/.test(n)).sort().reverse();
  } catch (e) {
    $('#resumo').textContent = `Não foi possível ler as fotos (${e.code}). Confirma que este email está no separador Acesso.`;
    return;
  }
  const n = sessoes.length;
  $('#n-cabine').textContent = n ? `(${n})` : '';
  $('#resumo').textContent = n
    ? `${n} ${n === 1 ? 'sessão' : 'sessões'} · ${n * 4} fotos`
    : 'Ainda não há fotos. Quando a cabine começar a trabalhar, aparecem aqui.';
  $('#tudo-pasta').hidden = !('showDirectoryPicker' in window) || !n;

  const grelha = $('#sessoes');
  grelha.replaceChildren();
  let diaAnterior = '';
  for (const id of sessoes) {
    const dia = nomePasta(id).slice(0, 10);
    if (dia !== diaAnterior) {
      const h = document.createElement('h3');
      h.className = 'g-dia';
      h.textContent = dataDe(id).toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' });
      grelha.append(h);
      diaAnterior = dia;
    }
    const b = document.createElement('button');
    b.className = 'g-sessao';
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = `Sessão das ${horaCurta(id)}`;
    img.src = url(id, 'tira-mini.jpg');
    img.onerror = () => { img.onerror = null; img.src = url(id, 'tira.jpg'); };
    const legenda = document.createElement('span');
    legenda.textContent = horaCurta(id);
    b.append(img, legenda);
    b.addEventListener('click', () => abrirDetalhe(id));
    grelha.append(b);
  }
}

function abrirDetalhe(id) {
  $('#d-tira').src = url(id, 'tira.jpg');
  $('#d-hora').textContent = dataDe(id).toLocaleString('pt-PT', { dateStyle: 'long', timeStyle: 'short' });
  $('#d-fotos').replaceChildren(...FICHEIROS.slice(1).map((f) => {
    const a = document.createElement('a');
    a.href = url(id, f); a.target = '_blank'; a.rel = 'noopener';
    const img = document.createElement('img'); img.src = a.href; img.alt = f;
    a.append(img);
    return a;
  }));
  $('#d-apagar').dataset.id = id;
  $('#d-descarregar').onclick = () => zipSessoes([id], FICHEIROS, `${cfg.nomes} - ${nomePasta(id)}`);
  $('#detalhe').showModal();
}
$('#detalhe .fechar').addEventListener('click', () => $('#detalhe').close());
$('#detalhe').addEventListener('click', (e) => { if (e.target.id === 'detalhe') e.target.close(); });

// ══ Câmaras descartáveis ═════════════════════════════════════
// rolos: [{ pasta, id, nome, fotos: ['01.jpg', …], limite }]
let rolos = [], filtro = null, visiveis = [], atual = 0;
const nomeDoRolo = (pasta) => pasta.split('--').slice(1).join('--') || 'Anónimo';
const caminhoDesc = (r, f) => `descartavel/${r.pasta}/${f}`;

// As fotos só ficam públicas depois da revelação; até lá usamos links com autorização
const urls = new Map();
function urlDesc(caminho) {
  if (!urls.has(caminho)) urls.set(caminho, fb.getDownloadURL(fb.ref(fb.storage, caminho)));
  return urls.get(caminho);
}

async function lerLimite(id) {
  try {
    const r = await fetch(urlPublico(`descartavel-limites/${id}.json`), { cache: 'no-store' });
    if (r.ok) { const n = Number((await r.json()).fotos); if (n >= 1 && n <= 99) return n; }
  } catch { /* ignora */ }
  return D.fotos;
}

async function gravarLimite(rolo, n) {
  n = Math.max(1, Math.min(99, n));
  await fb.uploadString(
    fb.ref(fb.storage, `descartavel-limites/${rolo.id}.json`),
    JSON.stringify({ fotos: n, nome: rolo.nome, alterado: new Date().toISOString() }),
    'raw',
    { contentType: 'application/json', cacheControl: 'no-store' },
  );
  rolo.limite = n;
}

async function carregarDescartaveis() {
  $('#d-resumo').textContent = 'A carregar…';
  try {
    caminhosDesc = await listarTudo(await token(), 'descartavel/');
    const pastas = new Map();
    for (const c of caminhosDesc) {
      const [, pasta, f] = c.split('/');
      if (!pastas.has(pasta)) pastas.set(pasta, []);
      if (/^\d\d\.jpg$/.test(f)) pastas.get(pasta).push(f);
    }
    rolos = await Promise.all([...pastas].map(async ([pasta, fotos]) => {
      const id = pasta.split('--')[0];
      return { pasta, id, nome: nomeDoRolo(pasta), fotos: fotos.sort(), limite: await lerLimite(id) };
    }));
  } catch (e) {
    $('#d-resumo').textContent = `Não foi possível ler as câmaras (${e.code || e.message}).`;
    return;
  }
  rolos.sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
  const total = rolos.reduce((s, r) => s + r.fotos.length, 0);
  $('#n-desc').textContent = rolos.length ? `(${rolos.length})` : '';
  $('#d-resumo').textContent = rolos.length
    ? `${total} ${total === 1 ? 'foto' : 'fotos'} de ${rolos.length} ${rolos.length === 1 ? 'câmara' : 'câmaras'}`
    : 'Ainda ninguém usou as câmaras descartáveis.';
  if (filtro && !rolos.some((r) => r.pasta === filtro)) filtro = null;
  desenharPessoas();
  desenharFotos();
}

function desenharPessoas() {
  const cont = $('#pessoas');
  cont.replaceChildren();
  const chip = (texto, sub, pasta) => {
    const b = document.createElement('button');
    b.className = 'pessoa';
    b.setAttribute('aria-pressed', String(filtro === pasta));
    const n = document.createElement('span'); n.className = 'pessoa-nome'; n.textContent = texto;
    const s = document.createElement('small'); s.textContent = sub;
    b.append(n, s);
    b.addEventListener('click', () => { filtro = pasta; desenharPessoas(); desenharFotos(); });
    return b;
  };
  const total = rolos.reduce((s, r) => s + r.fotos.length, 0);
  cont.append(chip('Todas', `${total} ${total === 1 ? 'foto' : 'fotos'}`, null));
  for (const r of rolos) {
    const c = chip(r.nome, `${r.fotos.length}/${r.limite}`, r.pasta);
    if (r.fotos.length >= r.limite) c.classList.add('cheia');
    cont.append(c);
  }
  desenharPainel();
}

function desenharPainel() {
  const r = rolos.find((x) => x.pasta === filtro);
  $('#painel').hidden = !r;
  if (!r) return;
  $('#painel-nome').textContent = r.nome;
  const usadas = r.fotos.length;
  $('#painel-uso').textContent = usadas >= r.limite
    ? `Usou as ${r.limite} fotos — rolo terminado`
    : `${usadas} de ${r.limite} fotos usadas · faltam ${r.limite - usadas}`;
  $('#painel-barra').style.width = `${Math.min(100, (100 * usadas) / r.limite)}%`;
  $('#painel-msg').textContent = '';
}

async function mudarLimite(n, mensagem) {
  const r = rolos.find((x) => x.pasta === filtro);
  if (!r) return;
  const botoes = document.querySelectorAll('.painel-acoes button');
  botoes.forEach((b) => (b.disabled = true));
  try {
    await gravarLimite(r, n);
    desenharPessoas();
    $('#painel-msg').textContent = `${mensagem} O telemóvel de ${r.nome} atualiza sozinho em menos de um minuto.`;
  } catch (e) {
    $('#painel-msg').textContent = `Não foi possível gravar (${e.code || e.message}). Confirma as regras do Firebase.`;
  } finally {
    botoes.forEach((b) => (b.disabled = false));
  }
}
document.querySelectorAll('[data-mais]').forEach((b) => b.addEventListener('click', () => {
  const r = rolos.find((x) => x.pasta === filtro);
  const k = Number(b.dataset.mais);
  // Se já tinha terminado, as fotos extra contam a partir das que já tirou
  const base = Math.max(r.limite, r.fotos.length);
  mudarLimite(base + k, `✓ ${r.nome} tem agora ${base + k - r.fotos.length} ${base + k - r.fotos.length === 1 ? 'foto' : 'fotos'} por tirar.`);
}));
$('#painel-novo').addEventListener('click', () => {
  const r = rolos.find((x) => x.pasta === filtro);
  if (!confirm(`Dar um rolo novo a ${r.nome}? Fica com mais ${D.fotos} fotos (as que já tirou ficam guardadas).`)) return;
  mudarLimite(r.fotos.length + D.fotos, `✓ Rolo novo: ${r.nome} tem ${D.fotos} fotos por tirar.`);
});
$('#painel-zip').addEventListener('click', () => {
  const r = rolos.find((x) => x.pasta === filtro);
  zipDescartaveis([r], `${cfg.nomes} - câmara de ${r.nome}`);
});
$('#d-zip-tudo').addEventListener('click', () => zipDescartaveis(rolos, `${cfg.nomes} - câmaras descartáveis`));
$('#d-atualizar').addEventListener('click', carregarTudo);

// Miniaturas só carregam quando aparecem no ecrã
const observador = new IntersectionObserver((entradas) => {
  for (const e of entradas) {
    if (!e.isIntersecting) continue;
    observador.unobserve(e.target);
    const img = e.target, caminho = img.dataset.caminho;
    urlDesc(caminho.replace('.jpg', '-mini.jpg'))
      .catch(() => urlDesc(caminho))
      .then((u) => (img.src = u))
      .catch(() => img.classList.add('falhou'));
  }
}, { rootMargin: '400px' });

function desenharFotos() {
  const cont = $('#d-grelha');
  cont.replaceChildren();
  visiveis = [];
  for (const r of rolos) {
    if (filtro && r.pasta !== filtro) continue;
    for (const f of r.fotos) {
      const idx = visiveis.length;
      visiveis.push({ r, f });
      const b = document.createElement('button');
      b.className = 'd-foto';
      const img = document.createElement('img');
      img.alt = `${r.nome} ${f}`;
      img.dataset.caminho = caminhoDesc(r, f);
      observador.observe(img);
      b.append(img);
      if (!filtro) {
        const quem = document.createElement('span');
        quem.className = 'd-quem';
        quem.textContent = r.nome;
        b.append(quem);
      }
      b.addEventListener('click', () => abrirFoto(idx));
      cont.append(b);
    }
  }
}

async function abrirFoto(i) {
  atual = (i + visiveis.length) % visiveis.length;
  const { r, f } = visiveis[atual];
  $('#foto-legenda').textContent = `${r.nome} · foto ${Number(f.slice(0, 2))}`;
  $('#foto-img').removeAttribute('src');
  if (!$('#foto').open) $('#foto').showModal();
  $('#foto-img').src = await urlDesc(caminhoDesc(r, f));
}
$('#foto-ant').addEventListener('click', () => abrirFoto(atual - 1));
$('#foto-seg').addEventListener('click', () => abrirFoto(atual + 1));
$('#foto .fechar').addEventListener('click', () => $('#foto').close());
$('#foto-guardar').addEventListener('click', async () => {
  const { r, f } = visiveis[atual];
  guardar([{ url: await urlDesc(caminhoDesc(r, f)), nome: `${r.nome} - ${f}` }]);
});

// ══ Apagar ═══════════════════════════════════════════════════
// Só funciona para quem está na lista de acesso (regras do Storage). Não há caixote do lixo.
async function apagar(caminhos, pergunta) {
  if (!confirm(`${pergunta}\n\nNão dá para desfazer.`)) return false;
  let falhou = 0;
  for (let i = 0; i < caminhos.length; i += 8) {
    await Promise.all(caminhos.slice(i, i + 8).map((c) => fb.deleteObject(fb.ref(fb.storage, c))
      .catch((e) => { if (e.code !== 'storage/object-not-found') { falhou++; console.error(c, e); } })));
  }
  if (falhou) alert(`Não foi possível apagar ${falhou} ${falhou === 1 ? 'ficheiro' : 'ficheiros'}. Tenta outra vez.`);
  return true;
}

$('#d-apagar').addEventListener('click', async () => {
  const id = $('#d-apagar').dataset.id;
  const caminhos = caminhosSessoes.filter((c) => c.startsWith(`sessoes/${id}/`));
  if (await apagar(caminhos, `Apagar a sessão das ${horaCurta(id)} (${caminhos.length} ficheiros)?`)) {
    $('#detalhe').close();
    carregarTudo();
  }
});

$('#painel-apagar').addEventListener('click', async () => {
  const r = rolos.find((x) => x.pasta === filtro);
  const caminhos = caminhosDesc.filter((c) => c.startsWith(`descartavel/${r.pasta}/`));
  if (await apagar([...caminhos, `descartavel-limites/${r.id}.json`],
    `Apagar a câmara de ${r.nome} e as ${r.fotos.length} ${r.fotos.length === 1 ? 'foto' : 'fotos'}?`)) {
    filtro = null;
    carregarTudo();
  }
});

$('#foto-apagar').addEventListener('click', async () => {
  const { r, f } = visiveis[atual];
  const base = caminhoDesc(r, f);
  if (await apagar([base, base.replace('.jpg', '-mini.jpg')], `Apagar a foto ${Number(f.slice(0, 2))} de ${r.nome}?`)) {
    $('#foto').close();
    carregarTudo();
  }
});

// ══ Descargas ════════════════════════════════════════════════
function progresso(feito, total, texto) {
  const el = $('#progresso');
  el.hidden = feito >= total;
  el.querySelector('i').style.width = `${(100 * feito) / total}%`;
  el.querySelector('span').textContent = texto ?? `${feito} / ${total}`;
}

let ocupado = false;
async function tarefa(fn) {
  if (ocupado) return;
  ocupado = true;
  const botoes = document.querySelectorAll('.g-acoes button, #painel-zip, #d-descarregar');
  botoes.forEach((b) => (b.disabled = true));
  try { await fn(); }
  catch (e) {
    if (e?.name !== 'AbortError') {
      console.error(e);
      alert(e instanceof TypeError
        ? 'O browser bloqueou a descarga. Falta configurar o CORS do bucket (ver README).'
        : `Erro: ${e.message}`);
    }
  } finally {
    ocupado = false;
    $('#progresso').hidden = true;
    botoes.forEach((b) => (b.disabled = false));
  }
}

async function baixarZip(zip, nome) {
  const conteudo = await zip.generateAsync({ type: 'blob', compression: 'STORE' }); // JPEG já vem comprimido
  const a = document.createElement('a');
  a.href = URL.createObjectURL(conteudo);
  a.download = `${nome}.zip`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

async function obterBlob(u) {
  const r = await fetch(u);
  return r.ok ? r.blob() : null; // ficheiro ainda não chegou / sessão incompleta
}

function zipSessoes(ids, ficheiros, nome) {
  return tarefa(async () => {
    const partes = [];
    for (let i = 0; i < ids.length; i += SESSOES_POR_ZIP) partes.push(ids.slice(i, i + SESSOES_POR_ZIP));
    const total = ids.length * ficheiros.length;
    let feito = 0;
    for (let p = 0; p < partes.length; p++) {
      const zip = new JSZip();
      for (const id of partes[p]) {
        const pasta = ficheiros.length === 1 ? zip : zip.folder(nomePasta(id));
        await Promise.all(ficheiros.map(async (f) => {
          const blob = await obterBlob(url(id, f));
          if (blob) pasta.file(ficheiros.length === 1 ? `${nomePasta(id)}.jpg` : f, blob);
          progresso(++feito, total, `A juntar fotos… ${feito} / ${total}`);
        }));
      }
      progresso(feito, total + 1, partes.length > 1 ? `A criar o ZIP ${p + 1} de ${partes.length}…` : 'A criar o ZIP…');
      await baixarZip(zip, partes.length > 1 ? `${nome} (parte ${p + 1} de ${partes.length})` : nome);
    }
  });
}

function zipDescartaveis(lista, nome) {
  return tarefa(async () => {
    const todas = lista.flatMap((r) => r.fotos.map((f) => ({ r, f })));
    const partes = [];
    for (let i = 0; i < todas.length; i += FOTOS_POR_ZIP) partes.push(todas.slice(i, i + FOTOS_POR_ZIP));
    let feito = 0;
    for (let p = 0; p < partes.length; p++) {
      const zip = new JSZip();
      for (let i = 0; i < partes[p].length; i += 6) { // 6 de cada vez
        await Promise.all(partes[p].slice(i, i + 6).map(async ({ r, f }) => {
          const blob = await obterBlob(await urlDesc(caminhoDesc(r, f)));
          const destino = lista.length === 1 ? f : `${r.nome} (${r.id})/${f}`;
          if (blob) zip.file(destino, blob);
          progresso(++feito, todas.length, `A juntar fotos… ${feito} / ${todas.length}`);
        }));
      }
      progresso(feito, todas.length + 1, partes.length > 1 ? `A criar o ZIP ${p + 1} de ${partes.length}…` : 'A criar o ZIP…');
      await baixarZip(zip, partes.length > 1 ? `${nome} (parte ${p + 1} de ${partes.length})` : nome);
    }
  });
}

// Chrome/Edge no computador: escreve direto numa pasta, sem limite de tamanho.
// Se for interrompido, voltar a correr salta o que já lá está.
function guardarNumaPasta() {
  return tarefa(async () => {
    const raiz = await window.showDirectoryPicker({ mode: 'readwrite', id: 'photobooth' });
    const total = sessoes.length * FICHEIROS.length;
    let feito = 0;
    for (const id of sessoes) {
      const dir = await raiz.getDirectoryHandle(nomePasta(id), { create: true });
      for (const f of FICHEIROS) {
        const existe = await dir.getFileHandle(f).then((h) => h.getFile()).then((x) => x.size > 0).catch(() => false);
        if (!existe) {
          const blob = await obterBlob(url(id, f));
          if (blob) {
            const w = await (await dir.getFileHandle(f, { create: true })).createWritable();
            await w.write(blob); await w.close();
          }
        }
        progresso(++feito, total, `A guardar… ${feito} / ${total}`);
      }
    }
    alert(`Pronto! ${sessoes.length} sessões guardadas na pasta “${raiz.name}”.`);
  });
}

$('#tudo-pasta').addEventListener('click', guardarNumaPasta);
$('#tudo-zip').addEventListener('click', () => zipSessoes(sessoes, FICHEIROS, `${cfg.nomes} - photobooth`));
$('#tiras-zip').addEventListener('click', () => zipSessoes(sessoes, ['tira.jpg'], `${cfg.nomes} - tiras`));

iniciar();
