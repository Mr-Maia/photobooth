import { urlPublico } from './storage.js';
import { iniciarLampadas } from './lampadas.js';
import { guardar } from './guardar.js';

const cfg = window.PHOTOBOOTH_CONFIG;
const $ = (s) => document.querySelector(s);
document.querySelectorAll('[data-nomes]').forEach((el) => (el.textContent = cfg.nomes));
document.querySelectorAll('[data-data]').forEach((el) => (el.textContent = cfg.data));

const FRASES = [
  'Todos giraços! 😍',
  'Da próxima vez não se esqueçam de sorrir.',
  'Ai, o olho fechado… é sempre a mesma coisa. 🙈',
  'Esta vai direitinha para o frigorífico da avó.',
  'O fotógrafo oficial que se cuide.',
  'Fotogénicos até dizer chega.',
  'Quem é que estava a piscar o olho? 😉',
  'Ninguém viu nada. A não ser os noivos, que ficam com uma cópia.',
  'Prontos para a capa da revista.',
  'Melhor pose da noite? Muito provavelmente.',
];
$('#frase').textContent = FRASES[Math.floor(Math.random() * FRASES.length)];

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


$('#guardar-tira').addEventListener('click', () => guardar([ficheiros[0]]));
$('#guardar-todas').addEventListener('click', () => guardar(ficheiros.slice(1)));
iniciarLampadas();
iniciar();
