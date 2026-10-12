// Guardar fotos no telemóvel/computador.
// Recebe uma lista de { url, nome }.

// Partilhar → "Guardar imagem" no iPhone/Android; descarregar no computador.
export async function guardar(lista) {
  try {
    const files = await Promise.all(lista.map(async (f) => {
      const r = await fetch(f.url);
      if (!r.ok) throw new Error(r.status);
      return new File([await r.blob()], f.nome, { type: 'image/jpeg' });
    }));
    if (navigator.canShare?.({ files })) {
      await navigator.share({ files, title: window.PHOTOBOOTH_CONFIG.nomes });
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
