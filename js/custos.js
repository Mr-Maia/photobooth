// Custos do Firebase Storage, calculados na galeria dos noivos.
// O espaço e os envios são medidos (tamanho e data de cada ficheiro);
// as descargas não se conseguem medir daqui, por isso são estimadas.

const cfg = window.PHOTOBOOTH_CONFIG;
const BASE = `https://firebasestorage.googleapis.com/v0/b/${cfg.firebase.storageBucket}/o`;

// Escalão grátis (Blaze, região us-central1) e preços do Google em dólares
export const GRATIS = { gb: 5, envios: 5000, descargaGb: 100, leituras: 50000 };
const PRECO = { gbMes: 0.020, envios10k: 0.05, descargaGb: 0.12, leituras10k: 0.004 };
const USD_EUR = 0.92;
const VEZES_DESCARREGADA = 3; // cada foto vista/descarregada ~3 vezes (convidado, galeria, ZIP)
const META_EUR = 2;
const GB = 1024 ** 3;

// Lista todos os ficheiros de uma pasta, incluindo subpastas, com 1 pedido por 1000 ficheiros
// (o listAll do SDK faz 1 pedido por pasta, o que gasta o escalão grátis de envios/listagens).
export async function listarTudo(token, prefixo) {
  const nomes = [];
  let pagina = '';
  do {
    const q = new URLSearchParams({ prefix: prefixo, maxResults: '1000' });
    if (pagina) q.set('pageToken', pagina);
    const r = await fetch(`${BASE}?${q}`, { headers: { Authorization: `Firebase ${token}` } });
    if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { code: `storage/${r.status === 403 ? 'unauthorized' : r.status}` });
    const j = await r.json();
    nomes.push(...(j.items || []).map((i) => i.name));
    pagina = j.nextPageToken || '';
  } while (pagina);
  return nomes;
}

// Os ficheiros nunca mudam (as regras proíbem reescrever), por isso o tamanho fica em cache
const CHAVE = 'custos-tamanhos-v1';
let cache = {};
try { cache = JSON.parse(localStorage.getItem(CHAVE) || '{}'); } catch { cache = {}; }
const gravarCache = () => { try { localStorage.setItem(CHAVE, JSON.stringify(cache)); } catch { /* cheio ou privado */ } };

async function medir(token, caminho) {
  const r = await fetch(`${BASE}/${encodeURIComponent(caminho)}`, { headers: { Authorization: `Firebase ${token}` } });
  if (!r.ok) return;
  const j = await r.json();
  cache[caminho] = [Number(j.size), Date.parse(j.timeCreated)];
}

const $ = (s) => document.querySelector(s);
const eur = (v) => (v > 0 && v < 0.005 ? 'menos de 1 cêntimo'
  : `${v.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);
const gb = (b) => `${(b / GB).toLocaleString('pt-PT', { maximumFractionDigits: b < GB ? 2 : 1 })} GB`;
const num = (n) => n.toLocaleString('pt-PT');

let pedido = 0;
export async function atualizarCustos(token, caminhos) {
  const meu = ++pedido;
  const falta = caminhos.filter((c) => !cache[c]);
  desenhar(caminhos, falta.length);
  for (let i = 0; i < falta.length; i += 16) {
    if (meu !== pedido) return; // entretanto houve outra atualização
    await Promise.all(falta.slice(i, i + 16).map((c) => medir(token, c).catch(() => {})));
    gravarCache();
    desenhar(caminhos, Math.max(0, falta.length - i - 16));
  }
}

function calcular(caminhos) {
  const medidos = caminhos.filter((c) => cache[c]);
  const bytesMedidos = medidos.reduce((s, c) => s + cache[c][0], 0);
  // Enquanto mede, os que faltam contam com a média dos já medidos
  const media = medidos.length ? bytesMedidos / medidos.length : 1.5 * 1024 ** 2;
  const bytes = bytesMedidos + media * (caminhos.length - medidos.length);

  // Envios por mês (o grátis é mensal); os que ainda não têm data contam no mês atual
  const porMes = {};
  const mes = (t) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}`; };
  for (const c of caminhos) { const k = cache[c] ? mes(cache[c][1]) : mes(Date.now()); porMes[k] = (porMes[k] || 0) + 1; }
  const enviosPico = Math.max(0, ...Object.values(porMes));
  const custoEnvios = Object.values(porMes).reduce((s, n) => s + Math.max(0, n - GRATIS.envios) / 1e4 * PRECO.envios10k, 0);

  // Descargas: estimativa, e como se fossem todas no mesmo mês (o pior caso)
  const descarga = bytes * VEZES_DESCARREGADA;
  const custoDescarga = Math.max(0, descarga / GB - GRATIS.descargaGb) * PRECO.descargaGb
    + Math.max(0, caminhos.length * VEZES_DESCARREGADA - GRATIS.leituras) / 1e4 * PRECO.leituras10k;

  const custoEspacoMes = Math.max(0, bytes / GB - GRATIS.gb) * PRECO.gbMes;
  const total = (custoEnvios + custoDescarga + custoEspacoMes * 12) * USD_EUR;
  return { bytes, enviosPico, descarga, total, espacoMes: custoEspacoMes * USD_EUR, n: caminhos.length };
}

function desenhar(caminhos, aMedir) {
  const c = calcular(caminhos);
  const el = $('#custos');
  el.hidden = false;
  el.classList.toggle('acima', c.total > 0);
  el.classList.toggle('passou', c.total > META_EUR);

  $('#custo-total').textContent = c.total > 0 && c.total < 0.005 ? '0,01 €' : eur(c.total);
  $('#custo-barra').style.width = `${Math.min(100, (100 * c.total) / META_EUR)}%`;
  $('#custo-estado').textContent = aMedir
    ? `A medir os ficheiros… faltam ${num(aMedir)}`
    : c.total === 0 ? 'Tudo dentro do escalão grátis.'
      : c.total <= META_EUR ? 'Acima do grátis, mas dentro da meta.'
        : 'Passou a meta de 2 €.';

  const medidor = (id, valor, max, texto) => {
    const p = Math.min(100, (100 * valor) / max);
    $(`#${id} i`).style.width = `${p}%`;
    $(`#${id}`).classList.toggle('alerta', valor > max * 0.8);
    $(`#${id}`).classList.toggle('passou', valor > max);
    $(`#${id} span`).textContent = texto;
  };
  medidor('m-espaco', c.bytes, GRATIS.gb * GB, `${gb(c.bytes)} de ${GRATIS.gb} GB`);
  medidor('m-envios', c.enviosPico, GRATIS.envios, `${num(c.enviosPico)} de ${num(GRATIS.envios)}`);
  medidor('m-descarga', c.descarga, GRATIS.descargaGb * GB, `~${gb(c.descarga)} de ${GRATIS.descargaGb} GB`);
  $('#custo-nota').textContent = c.espacoMes > 0
    ? `Guardar as fotos custa ${c.espacoMes < 0.005 ? '' : '~'}${eur(c.espacoMes)} por mês. Para voltar a 0 €, descarreguem tudo e apaguem da consola do Firebase.`
    : `${num(c.n)} ficheiros guardados. Enquanto ficarem abaixo dos ${GRATIS.gb} GB, guardá-los para sempre não custa nada.`;
}
