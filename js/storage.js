// Fila de envio para o Firebase Storage.
// Cada foto é primeiro guardada no próprio iPad (IndexedDB) e só é apagada
// de lá depois de confirmado o envio — se a rede falhar, nada se perde.

const FB_VER = '10.12.2';
const cfg = window.PHOTOBOOTH_CONFIG;

export const firebaseConfigurado = Boolean(cfg.firebase && cfg.firebase.storageBucket && cfg.firebase.apiKey);

// URL público de leitura de um ficheiro (funciona com as regras de storage.rules)
export function urlPublico(caminho) {
  return `https://firebasestorage.googleapis.com/v0/b/${cfg.firebase.storageBucket}/o/${encodeURIComponent(caminho)}?alt=media`;
}

// ── Guardar no aparelho ──────────────────────────────────────
// IndexedDB com as fotos em ArrayBuffer (o Safari em navegação privada recusa Blobs).
// Se o IndexedDB falhar de todo, as fotos ficam em memória e são enviadas na mesma.
const memoria = new Map();
let dbPromise;
function db() {
  dbPromise ??= new Promise((res, rej) => {
    const r = indexedDB.open('photobooth', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('fila', { keyPath: 'caminho' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error || new Error('IndexedDB indisponível'));
  });
  return dbPromise;
}
async function tx(modo, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction('fila', modo);
    const out = fn(t.objectStore('fila'));
    t.oncomplete = () => res(out?.result);
    t.onerror = () => rej(t.error || out?.error || new Error('IndexedDB: erro ao gravar'));
    t.onabort = () => rej(t.error || new Error('IndexedDB: operação cancelada'));
  });
}
async function guardarLocal(item) {
  try { await tx('readwrite', (s) => s.put(item)); }
  catch (e) { console.warn('A guardar em memória (IndexedDB falhou):', e); memoria.set(item.caminho, item); }
}
async function apagarLocal(caminho) {
  memoria.delete(caminho);
  try { await tx('readwrite', (s) => s.delete(caminho)); } catch { /* já não existe / sem IndexedDB */ }
}
async function listarLocal() {
  let guardados = [];
  try { guardados = await tx('readonly', (s) => s.getAll()); } catch { /* sem IndexedDB */ }
  return [...guardados, ...memoria.values()];
}

// ── Firebase (carregado só quando necessário) ────────────────
let fbPromise;
export function firebase() {
  fbPromise ??= (async () => {
    const { initializeApp } = await import(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-app.js`);
    const st = await import(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-storage.js`);
    const app = initializeApp(cfg.firebase);
    return { storage: st.getStorage(app), ...st };
  })().catch((e) => { fbPromise = undefined; throw e; });
  return fbPromise;
}

async function enviarUm({ caminho, dados, blob }) {
  const { storage, ref, uploadBytes, getMetadata } = await firebase();
  const r = ref(storage, caminho);
  try {
    await uploadBytes(r, dados ? new Blob([dados], { type: 'image/jpeg' }) : blob, { contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000' });
  } catch (e) {
    // As regras não deixam reescrever ficheiros. Se já existe, um envio anterior
    // chegou lá mas a resposta perdeu-se — está tudo bem.
    if (e?.code === 'storage/unauthorized') {
      try { await getMetadata(r); return; } catch { /* não existe mesmo */ }
    }
    throw e;
  }
}

// ── Fila ─────────────────────────────────────────────────────
const ouvintes = new Set();
export function aoMudarEstado(fn) { ouvintes.add(fn); }
let pendentes = 0, erro = null, aCorrer = false, repetir = false, timer;

function avisar() { for (const fn of ouvintes) fn({ pendentes, erro }); }

// ficheiros: [{ caminho, blob }]
export async function enfileirar(ficheiros) {
  let t = Date.now();
  for (const { caminho, blob } of ficheiros) {
    if (!blob) { console.warn('Foto vazia, ignorada:', caminho); continue; }
    await guardarLocal({ caminho, dados: await blob.arrayBuffer(), criado: t++ }); // a tira vai primeiro
  }
  processarFila();
}

export async function processarFila() {
  if (aCorrer) { repetir = true; return; }
  aCorrer = true;
  repetir = false;
  clearTimeout(timer);
  try {
    let lista = await listarLocal();
    lista.sort((a, b) => a.criado - b.criado);
    pendentes = lista.length; avisar();
    if (!firebaseConfigurado) { erro = 'Firebase não configurado'; avisar(); return; }
    for (const item of lista) {
      await enviarUm(item);
      await apagarLocal(item.caminho);
      pendentes--; erro = null; avisar();
    }
  } catch (e) {
    console.warn('Envio falhou, nova tentativa em 10 s', e);
    erro = e?.code || e?.message || 'erro de rede'; avisar();
    timer = setTimeout(processarFila, 10_000);
  } finally {
    aCorrer = false;
    if (repetir && !erro) processarFila();
  }
}

window.addEventListener('online', processarFila);
