# 📸 Photobooth · Carolina & Miguel

Cabine fotográfica para iPad: os convidados escolhem o estilo (P&B clássico ou vintage a cores), tiram 4 fotos,
e no fim aparece uma **tira de fotos retro** com um **código QR** para a guardarem no telemóvel.
Todas as fotos ficam guardadas no Firebase, para vocês.

```
iPad (GitHub Pages)                 Firebase Storage                 Telemóvel do convidado
index.html ── 4 fotos ──► sessoes/<id>/tira.jpg, foto-1..4.jpg ◄── fotos.html?s=<id>  (via QR)
     └─ guarda primeiro no iPad (IndexedDB) e reenvia sozinho se a rede falhar
```

## Ficheiros

| Ficheiro | O quê |
|---|---|
| `index.html` + `js/booth.js` | A cabine (abre-se no iPad) |
| `fotos.html` + `js/fotos.js` | Página que o QR abre no telemóvel dos convidados |
| `js/effects.js` | Filtro vintage (grão, vinheta, contraste) e desenho da tira 2×6" |
| `js/storage.js` | Envio para o Firebase com fila offline |
| `descartavel.html` + `js/descartavel.js` | Câmara descartável nos telemóveis dos convidados |
| `cartao-mesa.html` | Cartões com QR para imprimir e pôr nas mesas (4 por folha A4) |
| `galeria.html` + `js/galeria.js` | Galeria privada dos noivos (login Google, descarregar tudo) |
| `js/config.js` | **⚙️ Tudo o que precisas de editar** (nomes, data, Firebase, tempos) |
| `storage.rules` | Regras de segurança do Firebase Storage |

## Configuração (≈ 20 min, uma vez)

### 1. Firebase
1. Em <https://console.firebase.google.com> cria um projeto (ex: `casamento-cm`). O Analytics não é preciso.
2. **Storage → Começar.** O Firebase pede o plano **Blaze** (pago por utilização) para ativar o Storage.
   Escolhe a região **`us-central1`**, `us-east1` ou `us-west1`: **só estas têm o escalão gratuito.**
   Numa região europeia paga-se desde o primeiro byte. A região não se pode mudar depois.
   Em Google Cloud → Faturação → Orçamentos e alertas, cria um orçamento de 1 € com alertas por email.
   Ver a secção [Custos](#custos).
3. **Definições do projeto → As tuas apps → Web (`</>`)**: regista uma app e copia o `firebaseConfig`
   para `js/config.js`.
4. Publica as regras de segurança (a partir desta pasta):
   ```bash
   firebase login
   firebase use --add          # escolhe o projeto
   firebase deploy --only storage
   ```
   (ou copia o conteúdo de `storage.rules` para Consola → Storage → Regras.)
5. **CORS**, para o botão "Guardar" funcionar no telemóvel. Sem isto, os convidados podem
   na mesma guardar a foto com um toque longo:
   ```bash
   gcloud storage buckets update gs://O-TEU-BUCKET --cors-file=cors.json
   ```

### 2. GitHub Pages
```bash
git init && git add . && git commit -m "Photobooth"
gh repo create photobooth --public --source=. --push
gh api -X POST repos/{owner}/photobooth/pages -f "source[branch]=main" -f "source[path]=/"
```
Depois mete o endereço (ex: `https://o-teu-utilizador.github.io/photobooth`) em `siteUrl` no `js/config.js`
e volta a fazer push.

> As chaves do Firebase no `config.js` **não são segredas**: identificam o projeto e estão sempre visíveis
> no browser. Quem protege as fotos são as regras do `storage.rules`.

### 3. No iPad
1. Abre o endereço no **Safari** e aceita o acesso à câmara.
2. Partilhar → **Adicionar ao ecrã principal**, para abrir em ecrã inteiro como uma app.
3. Definições → Ecrã e brilho → Bloqueio automático → **Nunca**.
4. Liga o **Acesso guiado** (Definições → Acessibilidade): triplo clique no botão lateral, para que ninguém
   saia da app.
5. Faz uma sessão de teste e lê o QR com o teu telemóvel.

## Na festa
- O canto inferior direito mostra `☁︎ a enviar…` enquanto há fotos por enviar e `⚠︎` se a rede falhar.
  As fotos nunca se perdem: ficam no iPad até o envio ser confirmado. Se o Wi-Fi do local for fraco,
  usa o hotspot de um telemóvel.
- Se um convidado ler o QR antes de o envio terminar, a página dele fica à espera e mostra as fotos quando chegarem.

## Ficar com TODAS as fotos
A forma mais simples é a [galeria](#galeria-dos-noivos-galeriahtml). Está tudo no bucket, organizado por data e hora: `sessoes/AAMMDDhhmmss-xxxxxx/`. Para descarregar tudo:
```bash
gcloud storage cp -r gs://O-TEU-BUCKET/sessoes ./fotos-casamento
```
(também dá para ver e descarregar uma a uma na Consola Firebase → Storage.)

## Câmara descartável (`descartavel.html`)
Nas mesas há um cartão com QR (imprimir em `cartao-mesa.html`). Cada convidado escreve o nome e tem
**24 fotos**, sem as ver nem apagar. Depois de cada foto tem de rodar a roda para avançar o rolo.
As fotos levam um efeito de rolo barato com flash e a data carimbada a laranja.
São guardadas em `descartavel/<id>--<nome>/01.jpg … 24.jpg`.

Na **hora da revelação**, o mesmo link passa a mostrar a galeria com os rolos de toda a gente,
para ver e descarregar. As regras do Firebase garantem que ninguém vê nada antes dessa hora.

⚠️ Se mudares o número de fotos ou a hora da revelação em `js/config.js`, muda também em `storage.rules`
(o comentário explica como calcular o valor) e volta a publicar as regras.

## Custos
Plano Blaze: só se paga o que passar do escalão gratuito, que se renova todos os meses.

| | Grátis por mês | Um casamento (~300 sessões) |
|---|---|---|
| Espaço guardado | 5 GB | ~1–1,5 GB (cerca de 4 MB por sessão) |
| Descargas (convidados + galeria) | 100 GB | ~5–10 GB |
| Envios | 5 000 | ~1 800 (6 ficheiros por sessão) |
| Leituras | 50 000 | alguns milhares |

**Se passar o limite**, nada para de funcionar: a Google cobra só a diferença, na fatura do mês seguinte.
São valores de cêntimos, por exemplo cerca de 0,02 $ por GB guardado a mais, por mês.
O orçamento **só envia alertas e não corta o serviço**. Depois de descarregarem tudo pela galeria,
podem apagar a pasta `sessoes` na consola para o custo voltar a zero.

## Galeria dos noivos (`galeria.html`)
Login com Google, todas as sessões por hora, e descarregar uma sessão, só as tiras ou tudo
(ZIP em partes, ou direto para uma pasta no Chrome do computador).
1. Firebase → Authentication → Começar → ativar o fornecedor **Google**.
2. Authentication → Definições → **Domínios autorizados** → adicionar `o-teu-utilizador.github.io`.
3. Mete os vossos emails Google em `emailsNoivos` no `js/config.js` **e** em `storage.rules`,
   e volta a publicar as regras (`firebase deploy --only storage`).

## Personalizar
- Nomes, data, hashtag, número de fotos e tempos: `js/config.js`
- Cores: topo de `css/style.css` e `PALETA` em `js/effects.js`
- Intensidade do grão, da vinheta e do desbotado: `aplicarVintage()` em `js/effects.js`
- Frases durante as fotos ("Sorriam!", "Agora uma careta!"…): `FRASES` em `js/booth.js`

Para testar no computador: `python3 -m http.server 8000` e abre <http://localhost:8000>.
A câmara só funciona em `localhost` ou `https`.
