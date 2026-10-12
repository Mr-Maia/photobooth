// ─────────────────────────────────────────────────────────────
//  Configuração do photobooth — é só isto que precisas de editar
// ─────────────────────────────────────────────────────────────
window.PHOTOBOOTH_CONFIG = {
  // Textos que aparecem na tira de fotos
  nomes: 'Carolina & Miguel',
  data: '12 · 06 · 2027',          // ← muda para a data do casamento
  hashtag: '',                      // opcional, ex: '#CarolinaEMiguel'

  // Endereço público do site (GitHub Pages), SEM barra no fim.
  // É para aqui que o código QR aponta.
  siteUrl: 'https://mr-maia.github.io/photobooth',

  // Configuração do Firebase (Consola Firebase → Definições do projeto → As tuas apps → Web)
  firebase: {
    apiKey: '',
    authDomain: '',
    projectId: '',
    storageBucket: '',              // ex: 'casamento-cm.firebasestorage.app'
    appId: '',
  },

  // Quem pode entrar na galeria (galeria.html) com a conta Google.
  // ⚠️ Tem de ser igual à lista em storage.rules — é lá que a segurança é verificada.
  emailsNoivos: ['EMAIL-DA-CAROLINA@gmail.com', 'EMAIL-DO-MIGUEL@gmail.com'],

  // Câmara descartável (descartavel.html — QR nas mesas, nos telemóveis dos convidados)
  descartavel: {
    fotos: 5,                                   // ⚠️ se mudares, muda também em storage.rules
    revelacao: '2027-06-13T12:00:00+01:00',    // ⚠️ igual em storage.rules (em milissegundos)
    pedirNome: true,
  },

  // Comportamento da cabine
  numeroFotos: 4,
  segundosContagem: 3,              // contagem antes de cada foto
  segundosEntreFotos: 1.2,          // pausa depois de cada foto
  segundosEcraFinal: 75,            // tempo do ecrã com o QR antes de voltar ao início
  espelharFotoFinal: false,         // true = fotos guardadas como num espelho (igual à pré-visualização)
  som: true,                        // efeitos sonoros vintage durante as fotos
};
