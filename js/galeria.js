// Galeria privada dos noivos: login Google, todas as sessões, descarregar tudo.
import { firebaseConfigurado, urlPublico } from './storage.js';

const FB_VER = '10.12.2';
const cfg = window.PHOTOBOOTH_CONFIG;
const $ = (s) => document.querySelector(s);
document.querySelectorAll('[data-nomes]').forEach((el) => (el.textContent = cfg.nomes));

const FICHEIROS = ['tira.jpg', 'foto-1.jpg', 'foto-2.jpg', 'foto-3.jpg', 'foto-4.jpg'];
const SESSOES_POR_ZIP = 40; // ~150 MB por ZIP, para não rebentar a memória do browser

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
  const app = initializeApp(cfg.firebase, 'galeria');
  fb = { auth: auth.getAuth(app), storage: st.getStorage(app), ...auth, ...st };

  $('#entrar').addEventListener('click', async () => {
    try { await fb.signInWithPopup(fb.auth, new fb.GoogleAuthProvider()); }
    catch (e) { if (e.code !== 'auth/popup-closed-by-user') erroLogin(`Não foi possível entrar (${e.code}).`); }
  });
  $('#sair').addEventListener('click', () => fb.signOut(fb.auth));

  fb.onAuthStateChanged(fb.auth, async (user) => {
    $('#sair').hidden = !user;
    if (!user) { $('#login').hidden = false; $('#galeria').hidden = true; return; }
    const autorizado = cfg.emailsNoivos.map((e) => e.toLowerCase()).includes(user.email?.toLowerCase());
    if (!autorizado) {
      $('#login').hidden = false; $('#galeria').hidden = true;
      erroLogin(`A conta ${user.email} não tem acesso a esta galeria.`);
      return;
    }
    $('#login').hidden = true; $('#galeria').hidden = false;
    await carregarSessoes();
  });
}

function erroLogin(msg) { const el = $('#login-erro'); el.hidden = false; el.textContent = msg; }

// ── Lista de sessões ─────────────────────────────────────────
async function carregarSessoes() {
  try {
    const res = await fb.listAll(fb.ref(fb.storage, 'sessoes'));
    sessoes = res.prefixes.map((p) => p.name).filter((n) => /^[0-9]{12}-/.test(n)).sort().reverse();
  } catch (e) {
    $('#resumo').textContent = `Não foi possível ler as fotos (${e.code}). Confirma os emails em storage.rules.`;
    return;
  }
  const n = sessoes.length;
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

// ── Detalhe ──────────────────────────────────────────────────
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
  $('#d-descarregar').onclick = () => descarregarZip([id], FICHEIROS, `${cfg.nomes} - ${nomePasta(id)}`);
  $('#detalhe').showModal();
}
$('#detalhe .fechar').addEventListener('click', () => $('#detalhe').close());
$('#detalhe').addEventListener('click', (e) => { if (e.target.id === 'detalhe') e.target.close(); });

// ── Descargas ────────────────────────────────────────────────
async function obter(id, f) {
  const r = await fetch(url(id, f));
  if (!r.ok) return null; // ficheiro ainda não chegou / sessão incompleta
  return r.blob();
}

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
  document.querySelectorAll('.g-acoes button').forEach((b) => (b.disabled = true));
  try { await fn(); }
  catch (e) {
    if (e?.name !== 'AbortError') {
      console.error(e);
      alert(e instanceof TypeError
        ? 'O browser bloqueou a descarga. Falta configurar o CORS do bucket (ver README, passo 5).'
        : `Erro: ${e.message}`);
    }
  } finally {
    ocupado = false;
    $('#progresso').hidden = true;
    document.querySelectorAll('.g-acoes button').forEach((b) => (b.disabled = false));
  }
}

function descarregarZip(ids, ficheiros, nome) {
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
          const blob = await obter(id, f);
          if (blob) pasta.file(ficheiros.length === 1 ? `${nomePasta(id)}.jpg` : f, blob);
          progresso(++feito, total, `A juntar fotos… ${feito} / ${total}`);
        }));
      }
      progresso(feito, total + 1, partes.length > 1 ? `A criar o ZIP ${p + 1} de ${partes.length}…` : 'A criar o ZIP…');
      const conteudo = await zip.generateAsync({ type: 'blob', compression: 'STORE' }); // JPEG já vem comprimido
      const a = document.createElement('a');
      a.href = URL.createObjectURL(conteudo);
      a.download = partes.length > 1 ? `${nome} (parte ${p + 1} de ${partes.length}).zip` : `${nome}.zip`;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
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
          const blob = await obter(id, f);
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
$('#tudo-zip').addEventListener('click', () => descarregarZip(sessoes, FICHEIROS, `${cfg.nomes} - photobooth`));
$('#tiras-zip').addEventListener('click', () => descarregarZip(sessoes, ['tira.jpg'], `${cfg.nomes} - tiras`));

iniciar();
