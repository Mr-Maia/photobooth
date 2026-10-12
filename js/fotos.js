import { urlPublico } from './storage.js';
import { iniciarLampadas } from './lampadas.js';

const cfg = window.PHOTOBOOTH_CONFIG;
const $ = (s) => document.querySelector(s);
document.querySelectorAll('[data-nomes]').forEach((el) => (el.textContent = cfg.nomes));
document.querySelectorAll('[data-data]').forEach((el) => (el.textContent = cfg.data));

const id = new URLSearchParams(location.search).get('s') || '';
const valido = /^[0-9]{12}-[a-z0-9]{6}$/.test(id);
const pasta = `sessoes/${id}`;
const nomeBase = `${cfg.nomes.replace(/[^A-Za-z0-9]+/g, '-')}-${id}`;

const ficheiros = [
  { url: urlPublico(`${pasta}/tira.jpg`), nome: `${nomeBase}-tira.jpg` },
  ...[1, 2, 3, 4].map((n) => ({ url: urlPublico(`${pasta}/foto-${n}.jpg`), nome: `${nomeBase}-foto-${n}.jpg` })),
];

const carregar = (url) => new Promise((res, rej) => {
  const img = new Image();
  img.onload = () => res(img);
  img.onerror = rej;
  img.src = url;
});

// As fotos podem ainda estar a subir do iPad quando o QR é lido: tenta durante uns minutos.
async function esperarPor(url, tentativas = 60) {
  for (let i = 0; i < tentativas; i++) {
    try { return await carregar(i ? `${url}&t=${Date.now()}` : url); }
    catch { await new Promise((r) => setTimeout(r, 3000)); }
  }
  throw new Error('timeout');
}

async function iniciar() {
  if (!valido) { $('#espera-txt').textContent = 'Este link não parece certo. Volta a ler o código QR.'; return; }
  try {
    const tira = await esperarPor(ficheiros[0].url);
    $('#tira').src = tira.src;
    $('#espera').hidden = true;
    $('#conteudo').hidden = false;
    for (const f of ficheiros.slice(1)) {
      const a = document.createElement('a');
      a.href = f.url; a.target = '_blank'; a.rel = 'noopener';
      const img = document.createElement('img');
      img.alt = 'Foto'; img.loading = 'lazy';
      a.append(img);
      $('#grelha').append(a);
      esperarPor(f.url).then((i) => (img.src = i.src)).catch(() => a.remove());
      a.addEventListener('click', (e) => { e.preventDefault(); guardar([f]); });
    }
  } catch {
    $('#espera-txt').textContent = 'Ainda não chegaram… tenta abrir este link outra vez daqui a pouco 💛';
  }
}

// Partilhar → "Guardar imagem" no iPhone/Android; descarregar no computador.
async function guardar(lista) {
  try {
    const files = await Promise.all(lista.map(async (f) => {
      const r = await fetch(f.url);
      if (!r.ok) throw new Error(r.status);
      return new File([await r.blob()], f.nome, { type: 'image/jpeg' });
    }));
    if (navigator.canShare?.({ files })) {
      await navigator.share({ files, title: cfg.nomes });
      return;
    }
    for (const file of files) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file);
      a.download = file.name;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    }
  } catch (e) {
    if (e?.name === 'AbortError') return; // a pessoa fechou a folha de partilha
    // Último recurso: abre a imagem — dá para guardar com um toque longo.
    window.open(lista[0].url, '_blank');
  }
}

$('#guardar-tira').addEventListener('click', () => guardar([ficheiros[0]]));
$('#guardar-todas').addEventListener('click', () => guardar(ficheiros.slice(1)));
iniciarLampadas();
iniciar();
