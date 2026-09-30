# Guia de arquitetura — para o Claude ler antes de mexer no hub

> Se você é uma instância do Claude começando uma conversa nova sobre este
> projeto: leia este arquivo inteiro antes de escrever qualquer código. Ele
> existe exatamente para que você não precise de memória da conversa
> anterior — o código e este guia são a fonte da verdade.

## O que é isto

Um hub local (Node.js + Express) que hospeda vários aplicativos internos de
cálculo de engenharia da TGM Turbinas, atrás de login por usuário/senha, com
salvar/abrir/salvar-como de projetos em arquivos `.json` em qualquer pasta do
servidor. O primeiro app é o **PEVAL** (perfil e desempenho de válvulas de
regulagem de turbinas a vapor).

Leia também `README.md` (instalação e operação completas) antes de mudar `server.js`.

## Instalação rápida (resumo — detalhes completos em `README.md`)

```bash
cd hub
npm install             # instala Express, bcrypt, sessão
node setup-password.js  # define usuário, senha e a pasta raiz de projetos
npm start                # ou: node server.js
```
Acesse `http://SEU-SERVIDOR:3000`. Para manter rodando permanentemente,
usar HTTPS/domínio, ou instalar em outra máquina do zero, siga o
`README.md` — ele tem o passo a passo com PM2, proxy reverso, etc.

## Convenções que TODO app novo deve seguir

### 1. Estrutura de arquivos

Cada app vive isolado em `public/apps/<id>/`:

```
public/apps/<id>/
├── index.html   — página do app (usa a barra hubnav + toolbar de projeto)
├── engine.js    — motor de cálculo puro, sem DOM, sem fetch
└── ui.js        — formulário, gráficos, tabela, integração com projetos
```

E uma linha em `public/apps.json`:
```json
{ "id": "<id>", "name": "Nome do App", "description": "...", "path": "/apps/<id>/", "icon": "🔧" }
```
Isso é tudo que o servidor precisa — `apps.json` é lido dinamicamente pelo
`hub.html`, não requer mudar `server.js`.

### 2. Separação engine.js / ui.js (importante)

- **`engine.js`**: só matemática/física. Uma função `Engine.run(params)` que
  recebe um objeto plano com os dados de entrada e devolve um objeto com os
  resultados (séries indexadas por passo de curso/tempo, avisos, etc). Nunca
  toca `document`, `fetch`, `localStorage`. Isso permite testar o motor
  isoladamente com `node -e "..."` antes de plugar na interface — é assim
  que o PEVAL foi validado contra o programa original (ver
  `engine.js` do PEVAL, comentário no topo, e a conversa onde isso foi
  construído caso o histórico esteja disponível).
- **`ui.js`**: um único IIFE `(function(){ ... })()`. Mantém um objeto
  `state` com os dados do formulário, funções `renderX()` que geram HTML via
  template strings e reatribuem `.innerHTML`, e `recalc()` que valida o
  `state`, chama `Engine.run()`, e redesenha os painéis. Gráficos usam
  Chart.js (já carregado via CDN no `index.html`).

### 3. Identidade visual (design tokens)

Cor de marca (logo, botões primários, aba ativa, foco): **`#10B6B6`**
(variável CSS `--brass` / `--brass-dim:#0C8A8A` — nome histórico, é a cor da
STEAM, não literalmente cor de latão). Fontes: IBM Plex Sans (interface) +
IBM Plex Mono (todo número/tabela/código). Fundo escuro por padrão
(`--bg:#14181D` etc.), com tema claro via `:root[data-theme="light"]` — veja
o bloco de variáveis no topo do `<style>` de qualquer app existente e copie
o mesmo padrão. Todo app novo deve:
- Ter o script anti-flash de tema logo no `<body>`:
  ```html
  <script>(function(){ try { var t = localStorage.getItem('hub-theme'); if (t) document.documentElement.setAttribute('data-theme', t); } catch(e){} })();</script>
  ```
- Ter um botão de tema (🌗) na barra superior, com o mesmo handler dos apps
  existentes (alterna `data-theme` em `<html>` e salva em
  `localStorage.setItem('hub-theme', ...)`).
- **Nunca** pré-carregar dados de exemplo no `state` inicial — o app deve
  abrir em branco, com uma tela vazia orientando a preencher os dados ou
  abrir um projeto salvo (ver `renderEmptyState()` no PEVAL como modelo).

### 4. Barra de navegação (hubnav) e projeto

Todo `index.html` de app deve ter, no topo, a barra `hubnav` com: link
"← Hub", caixa de identificação do projeto atual + botões **Abrir…** /
**Salvar** / **Salvar como…**, botão de tema, usuário logado + **Sair**.
Copie o markup/CSS `.hubnav` de `public/apps/peval/index.html` — é
genérico, não específico do PEVAL.

### 4.1 Apps sem formulário grande: padrão "coluna única"

PEVAL e STEAMPATH têm um formulário grande demais para caber sempre visível,
por isso usam `sidebar` (formulário) + `main` (abas/gráficos/tabela) lado a
lado. Nem todo app precisa disso — um app pequeno (uma calculadora, um
conversor) não deve forçar esse layout de duas colunas só por convenção.
Para esses casos, use uma única coluna centralizada:

```html
<main class="main-solo">
  <div class="brand">...</div>
  <div class="field-group">...</div>  <!-- cada seção do app -->
  <div class="field-group">...</div>
</main>
```
```css
.main-solo{max-width:760px;margin:0 auto;padding:26px 24px 60px;}
```

A `hubnav` continua exatamente igual (ver seção 4) — só o conteúdo abaixo
dela muda de `#app{sidebar+main}` para `.main-solo`. Reaproveite `.field-group`
(com `h2`/`.row`/`label`/inputs), `.tabs`/`.tab`/`.panel`, `.btn`/`.btn-primary`/
`.icon-btn`, `.notice` e `table`/`.table-scroll` do PEVAL — são genéricos, não
específicos de nenhum app. Só crie uma nova classe quando nenhuma existente
servir (ex.: `.result-box` do FTMM, para destacar um valor calculado — ver
`public/apps/ftmm/index.html`).

Quando o app não tem "campos de máquina" para salvar (é uma ferramenta de
conversão/consulta, não uma simulação de um equipamento), o "projeto"
salvável pode ser uma lista de itens nomeados em vez de um objeto de
parâmetros único — ver `state.rows` em `public/apps/ftmm/ui.js`
(`buildProjectData`/`applyProjectData` continuam genéricos, só o formato de
`state` muda).

### 5. API de projetos (já pronta no servidor, não precisa mudar nada)

Qualquer app novo usa os mesmos endpoints, já protegidos por sessão:

- `GET  /api/browse?path=<relativo>` — lista pastas/arquivos `.json`
- `POST /api/mkdir` `{path}`
- `GET  /api/file?path=<relativo>` — lê um projeto
- `POST /api/file` `{path, content, overwrite}` — salva um projeto
- `GET/POST /api/logout`, `GET /api/whoami`, `GET /api/apps`

Formato exato das mensagens (conferido no `ui.js` do PEVAL — usar exatamente assim):
- `GET /api/browse?path=pasta/sub` → `{ path: "pasta/sub", entries: [{ name, isDir }] }`
  (caminho relativo à raiz de projetos, sem barra inicial; `""` = raiz).
- `GET /api/file?path=…` → `{ content: { …projeto… } }` (o projeto já vem como objeto).
- `POST /api/file` com `{ path, content, overwrite: true }` — **`content` é o objeto do
  projeto, não uma string**. Enviar `JSON.stringify(...)` como `content` faz o arquivo
  ser gravado como uma string JSON duplamente codificada.
- `POST /api/mkdir` com `{ path }` — cria a pasta; o navegador continua na pasta atual.
- `GET /api/whoami` → `{ authed, username }`; se `!authed`, ir para `/login.html`.
- `POST /api/logout` e depois `window.location.href = '/login.html'`.
- O link "← Hub" da `hubnav` aponta para `/hub.html`.

O formato do arquivo salvo é sempre:
```json
{ "appId": "<id-do-app>", "version": 1, "name": "...", "savedAt": "...", "state": { ...tudo que está em `state` do ui.js... } }
```
Copie as funções `buildProjectData`, `applyProjectData`,
`openFileBrowser`/`fbList`/`fbConfirm`, `saveCurrent`, `wireProjectToolbar`
de `public/apps/peval/ui.js` quase literalmente — são genéricas, só trocam
o `APP_ID`.

## Manutenção deste arquivo (leia isto também)

Este arquivo deve crescer junto com o hub. **Sempre que um app novo for
concluído numa conversa, antes de encerrar essa conversa, atualize este
`ARCHITECTURE.md`** com qualquer padrão novo, decisão de design, ou
convenção que tenha surgido e que não estava documentada aqui — por
exemplo: um novo tipo de gráfico usado, uma nova convenção de nomenclatura,
uma decisão sobre unidades, uma nova seção da API, um padrão de validação
diferente, etc. Se nada de novo surgiu (o app apenas seguiu os padrões já
descritos aqui), não precisa mudar nada. O objetivo é que este arquivo
sozinho — sem depender do histórico de nenhuma conversa — continue sendo
suficiente para que uma conversa nova entenda o estado atual do hub.

Ao atualizar, adicione a data e um resumo de uma linha na lista abaixo, e
detalhe a convenção na seção apropriada acima (ou crie uma nova seção se
não couber em nenhuma existente):

### Histórico de atualizações
- 2026-09-22 — versão inicial deste arquivo, escrita após a criação do PEVAL.
- 2026-09-22 — adicionado resumo de instalação (para o arquivo funcionar sozinho, sem depender do README.md, se subido isoladamente numa conversa nova).
- 2026-09-22 — criado o app **STEAMPATH** (linha de expansão multiestágio de turbina a vapor, ação/reação). Introduziu três convenções novas, descritas abaixo: (1) módulo de propriedades de vapor `steam.js` reutilizável; (2) padrão de visualização "steampath" (corte meridional); (3) convenção de sinais do triângulo de velocidades.
- 2026-09-22 — STEAMPATH: expandido o formulário para cobrir o restante dos campos da planilha Excel original (extração/vazão de tomada e perda por setor por estágio, folgas internas e labirintos completos, diâmetros do rotor e pistão de compensação AK, furos de equalização, geometria de diafragma, tipo de perfil/pé/material com `<datalist>`). Ver a seção "Padrão de card de estágio com muitos campos" abaixo antes de adicionar mais campos a um app existente.
- 2026-09-22 — STEAMPATH: quatro correções de modelagem (ver seção "Injetor × Diafragma" abaixo): (1) passo do bocal fixo agora só é dado quando o tipo é "Injetor" — quando é "Diafragma" é sempre calculado (π·dm1/z1); (2) "Grupos de injeção" virou campo global (definição da máquina), não mais por estágio; (3) o pistão de compensação (AK) e seu labirinto agora ficam dentro da seção "Geometria do diafragma" de cada estágio, e o motor soma o alívio de todos os diafragmas que tiverem `dak` informado (antes só olhava o primeiro estágio); (4) β2e (ângulo de saída da palheta móvel) deixou de ser um campo de entrada — é sempre calculado por `sin(β2e)=z2·e2/(π·dm2)`, a mesma relação já usada para α1 no bocal (validado: bate em 21,43° contra 21,4° do desenho real da CTU-TM5000).
- 2026-09-22 — STEAMPATH: empuxo axial refeito do zero seguindo a metodologia real da planilha (Output, linhas 200-238) em vez da aproximação de 1ª ordem anterior — ver seção "Empuxo axial — metodologia real da planilha" abaixo. Adicionado campo global "Mancal axial" (De, Di, α) para reportar a pressão específica no mancal (MPa), como a planilha original faz.
- 2026-09-22 — STEAMPATH: pistão(ões) de compensação (AK) movidos para uma lista própria da máquina, fora dos estágios (ver acima). Investigado — mas ainda NÃO fechado — o papel dos furos de equalização de pressão no coeficiente "k" do empuxo axial; ver seção "Furos de equalização e o coeficiente k — investigação em aberto" abaixo antes de mexer nisso de novo.
- 2026-09-25 — criado o app **PONTAEIXO** (dimensionamento de ponta de eixo por fadiga, seguindo Shigley + literatura de concentração de tensão — substitui/complementa o cálculo antigo em planilha analisado nesta mesma conversa). Ver seção própria abaixo ("App PONTAEIXO") para a metodologia, as constantes conferidas contra a literatura antes de codificar, e os pontos em aberto.
- 2026-09-25 — criado o app **FTMM** (conversor pés/polegadas ↔ milímetros, com frações, para conferência de cotas de desenhos em sistema inglês). Primeiro app do hub sem formulário grande — introduziu a convenção "coluna única" descrita na nova seção "Apps sem formulário grande: padrão 'coluna única'" (logo após a seção 4, "Barra de navegação (hubnav) e projeto"). O "projeto" salvável deste app é uma lista de medidas nomeadas (`state.rows`), não um formulário de máquina.
- 2026-09-29 — integrado o app **CICLOVAP** (balanço térmico de ciclos a vapor: fluxograma arrastável, solver orientado a equações, diagramas T-s/h-s e curvas paramétricas de eficiência). Foi desenvolvido fora do hub e adaptado às convenções depois. Introduziu: (1) o layout "editor de fluxograma" (paleta | abas | inspetor); (2) o adaptador de propriedades sobre o `steam.js`; (3) diagramas termodinâmicos e estudos paramétricos em Chart.js; (4) o token `--brass-text`. Ver a seção "App CICLOVAP" abaixo. **Pendências de integração** listadas no fim daquela seção.
- 2026-09-30 — integrado o app **ROTORDIN** (rotordinâmica lateral: Timoshenko, Campbell, modos, desbalanceamento ISO 21940-11/API 617, estabilidade, mancais hidrodinâmicos por Reynolds + Sommerfeld). Portado de um programa Python/PySide6 validado contra o ROSS. Introduziu: (1) `Engine.Job` com `step(ms)` para cálculos longos em fatias, com `Engine.run()` síncrono reaproveitando as mesmas tarefas; (2) álgebra linear em JS puro (autovalores não simétricos, LU complexa, solver em banda); (3) o padrão "planilha editável" com colagem do Excel; (4) desenho SVG com zoom/arraste/menu de contexto; (5) desfazer/refazer por instantâneos; (6) validação automatizada em `tests/`. Ver a seção "App ROTORDIN" abaixo (pendências de integração resolvidas na entrada seguinte).
- 2026-09-30 — ROTORDIN: pendências de integração resolvidas com os arquivos do PEVAL. `index.html` passou a usar o CSS do PEVAL na íntegra (tokens, `hubnav`, shell, componentes, modal `#fb-overlay`) mais extensões próprias; o bloco de projetos do `ui.js` foi trocado pelo do PEVAL (`content` enviado como objeto — antes ia como texto). Documentado na seção 5 o formato exato das mensagens da API, que antes era só uma lista de endpoints.
- 2026-09-30 — ROTORDIN: (1) **flecha estática** (aba Flecha: linha elástica sob peso próprio com posição e valor da flecha máxima, eixo sobre apoios rígidos e linha de centro real com o munhão na posição de equilíbrio do filme, inclinação nos mancais); (2) **folga a frio × a quente** por dilatação térmica, com colunas novas na tabela de mancais; (3) óleos ISO VG 22–150, curva de viscosidade × temperatura e **estudo de sensibilidade** (temperatura do óleo e folga → coeficientes, h_mín, 1º modo, 1ª crítica, log dec) na aba Óleo e folga. Validação ampliada para 40 verificações.
- 2026-09-30 — ROTORDIN: **vazão de óleo e perda de potência** por mancal (integradas da solução de Reynolds, validadas contra Raimondi & Boyd); **térmica calculada** (balanço atrito = calor levado pelo óleo, com T entrada informada; temperaturas do óleo, munhão e mancal e folga a quente saem do balanço, em cada rotação); **excentricidade do furo** da sapata/lobo como entrada, definindo a pré-carga de operação m = e/(C_quente + e), com tabelas numa grade de pré-carga e interpolação. Tabelas de Sommerfeld passaram a ser geradas sob demanda dentro do `Job` (`needGeo`). Validação: 52 verificações.

### Módulo de propriedades de vapor (`steam.js`)

Qualquer app que precise de propriedades termodinâmicas de água/vapor deve copiar
`public/apps/steampath/steam.js` para dentro da sua própria pasta (cada app é
isolado — ver seção "Estrutura de arquivos" acima) e carregá-lo **antes** do seu
próprio `engine.js` no `index.html`:
```html
<script src="steam.js"></script>
<script src="engine.js"></script>
```
Ele implementa IAPWS-IF97 (Regiões 1, 2 e 4 — líquido comprimido, vapor
superaquecido e saturação/vapor úmido), portado da mesma biblioteca pública
(X-Steam, Magnus Holmgren, www.x-eng.com) que a planilha Excel original em VBA
já usava — os números batem com a planilha original (validado célula a célula
em pelo menos um ponto de operação real antes deste app ser dado como pronto).
API (unidades: bar, °C, kJ/kg, kJ/kg·K, m³/kg):
- `Steam.stateFromPT(p_bar, T_degC)` → `{h,s,v,x,region,...}`
- `Steam.stateFromPS(p_bar, s)` → estado a uma pressão dada mantendo a entropia (expansão isentrópica) — detecta sozinho se cai em vapor superaquecido ou vapor úmido.
- `Steam.stateFromPH(p_bar, h)` → estado a uma pressão dada mantendo a entalpia (ex.: laminação isentálpica numa válvula, ou o ponto real após uma perda que reaquece o fluido).
- `Steam.satAt(p_bar)` → `{Tsat,hL,sL,vL,hV,sV,vV}` (propriedades de saturação).
Ele NÃO implementa Região 3 (supercrítica) nem Região 5 (T>800°C) — não é
necessário para turbinas a vapor industriais convencionais. Se um app futuro
precisar disso, estender `steam.js` em vez de recriar um módulo paralelo.

### Padrão de visualização "steampath" (corte meridional)

Para qualquer app que descreva um equipamento de fluxo axial por estágios
(turbinas, compressores axiais), desenhar um corte meridional em SVG: eixo X =
posição axial acumulada de cada fileira de pás, eixo Y = raio (a partir do
diâmetro médio ± metade da altura de pá), cor = grandeza de interesse (pressão,
temperatura, Mach — normalizada e mapeada numa escala de cor entre `--brass` e
`--blue`, ver `pressureColor()` em `public/apps/steampath/ui.js`). Isso substitui
tabelas por uma leitura visual imediata da geometria e do estado termodinâmico
ao longo da máquina — copiar esse padrão (função `renderSteampathTab`) para
qualquer novo app de turbomáquinas.

### Convenção de sinais do triângulo de velocidades

Eixos: tangencial (alinhado com a velocidade periférica `u`, positivo no
sentido do movimento da pá) e axial/meridional (positivo no sentido do
escoamento). Regra única em todo o triângulo — entrada e saída — é sempre
`C = W + U` (velocidade absoluta = relativa + periférica, soma vetorial):
- Entrada: `wu1 = cu1 − u`, `wa1 = ca1`.
- Saída: a pá vira o escoamento relativo para o lado oposto ao da entrada,
  então a componente tangencial relativa entra com o sinal trocado antes de
  somar `u`: `wu2 = −w2·cos(β2e)`, `wa2 = w2·sin(β2e)`, depois `cu2 = wu2 + u`,
  `ca2 = wa2`. **Não** escrever `cu2 = w2·cos(β2e) − u` (parece razoável mas
  inverte o sinal do trabalho específico de Euler — foi um bug real encontrado
  e corrigido durante a validação deste app; se o trabalho por estágio sair
  negativo ou muito destoante do esperado, é o primeiro lugar a conferir).
Trabalho específico do estágio (equação de Euler): `Δh_u = u·(cu1 − cu2)/1000`
[kJ/kg], com `u` em m/s.

### Garganta como área já perpendicular ao escoamento

Ao converter geometria de bocal/palheta (nº de aletas `z`, garganta `e`,
altura `l`) em área de vazão para a equação da continuidade, a área é
`A = z·e·l` diretamente — **não multiplicar de novo por seno de nenhum
ângulo**. `e` (garganta) já é, por definição, a menor abertura medida
perpendicular à direção local do escoamento; multiplicar por `sin(β)` conta o
ângulo duas vezes (outro bug real encontrado e corrigido nesta validação — a
vazão calculada saía cerca de 3× menor que a real). O ângulo de saída do
bocal, quando não é um dado direto, pode ser estimado a partir da mesma
geometria por `sin(α1) = z1·e1/(π·dm1)` — aí sim o seno entra, porque essa é
uma fórmula diferente (ângulo efetivo a partir do passo das aletas), não a
área de vazão.

### Escopo da primeira versão do STEAMPATH e o que falta evoluir

O motor (`engine.js`) implementa, para uma única linha de corrente no
diâmetro médio (sem raiz/topo ainda): equação de energia (Euler), triângulos
de velocidade, perdas de perfil (por coeficiente de velocidade φ/ψ), atrito de
disco e ventilação (correlação simplificada — ORDEM DE GRANDEZA correta, mas
não calibrada contra dados de fábrica), vazamento em labirinto (opcional,
orifício compressível simplificado), perda por umidade (fator tipo Baumann
simplificado), continuidade (a vazão através de cada garganta — bocal fixo e
palheta móvel — é resolvida por bisseção, respeitando o afogamento/choking) e
convergência (a perda na válvula de admissão é ajustada por bisseção até a
marcha estágio-a-estágio fechar exatamente na pressão de escape informada).
Validado com sucesso contra o ponto de operação real da CTU-TM5000 (3
estágios) para o primeiro estágio isoladamente (potência e pressão de saída
dentro de ~5%); a partir do segundo estágio o erro cresce porque esta versão
ainda não modela o estágio de regulagem Rateau (cuja garganta efetiva é
controlada pela abertura da válvula, não é uma geometria fixa) — ele está
sendo absorvido de forma grosseira dentro da "perda de válvula". Itens
priorizados para a próxima evolução, na ordem em que o usuário pediu: (1)
integrar o estágio de regulagem com o modelo de vazão de válvulas do PEVAL;
(2) equilíbrio radial em três raios (raiz/média/topo) em vez de uma única
linha média; (3) ângulo de saída do bocal e da palheta a partir dos catálogos
de perfis com interpolação (spline), em vez de ângulo geométrico aproximado;
(4) calibrar atrito/ventilação e a perda por umidade com dados reais; (5)
diagrama de Goodman modificado e diagrama SAFE (interferência/Campbell) para
verificação de fadiga da pá, replicando a metodologia já usada na planilha
original (ver o estudo da planilha, referências a Traupel e a Shchegliaev).

### Padrão de card de estágio com muitos campos

Quando um estágio (ou qualquer item repetido) tem mais campos do que cabe
confortavelmente num card sempre visível, siga o padrão do STEAMPATH: os
grupos mais usados (aqui, "Bocal fixo" e "Palheta móvel") ficam sempre
abertos como `<div class="subsection">`; os grupos mais específicos ou usados
com menos frequência (aqui, folgas/labirintos, furos de equalização,
diafragma/compensação, atrito avançado) viram
`<details class="subsection"><summary class="sub-title">Título</summary>...`
— colapsados por padrão, sem esconder nenhum dado, sem exigir uma segunda
tela/aba/modal. O CSS de `.subsection`/`.sub-title` já cobre os dois casos
(ver `index.html` do STEAMPATH); reaproveitar em vez de recriar.

Nem todo campo capturado precisa alimentar o cálculo imediatamente: campos
que ainda não têm modelo implementado (ex.: tipo de pé, material, geometria
de diafragma) devem ser guardados no `state` e salvos/carregados normalmente
pelo projeto, com um `<div class="hint">` no formulário explicando
claramente que aquele grupo "ainda não entra no cálculo — reservado para
[o módulo futuro X]". Isso evita perder dado que o usuário já tem, sem fingir
uma precisão que o motor ainda não entrega. Quando o campo passa a alimentar
o cálculo, atualizar tanto o `engine.js` quanto essa mensagem no `ui.js`.

### Vazamento em labirinto — fórmula de Stodola

Para vazamento através de labirintos de diafragma/eixo (ou qualquer selo do
tipo dente-câmara em série), usar a fórmula clássica de Stodola em vez de uma
área equivalente arbitrária:
`ṁ = ψ·A·√( (p1²−p2²) / (z·v1·p1) )` (SI: p em Pa, v em m³/kg, A em m² → kg/s),
com `A = π·D_selagem·δ` e `ψ≈0,7–0,85`. Implementada em
`public/apps/steampath/engine.js` (`stodolaLabyrinthLeak`). Mais simples que
interpolar a carta "Coef Vedação" da planilha original, mas fisicamente
correta e suficiente para a ordem de grandeza; trocar por interpolação da
carta real só se a diferença comprovadamente importar num caso real.

### Injetor × Diafragma, e nenhum ângulo é dado de entrada

Numa fileira de pás fixas, ela é fisicamente um **Injetor** (bicos avulsos,
cobrindo só parte do arco — típico de estágio de regulagem, controlado por
grupos de válvulas) ou um **Diafragma** (anel de pás ocupando os 360°,
inclusive quando não existe injetor e o diafragma é a própria primeira queda
de pressão da máquina). Isso muda o que é dado de entrada e o que é
calculado:
- **Injetor**: o passo `t1` é um dado (arco parcial, geometria não decorre
  simplesmente do diâmetro e da contagem de bicos) — e só faz sentido ter
  "grupos de injeção" (quantos grupos de bicos/válvulas de regulagem
  existem). Isso é uma característica da máquina como um todo (normalmente só
  o estágio de regulagem é injetor), não de um estágio isolado — por isso
  "grupos de injeção" é campo **global**, não por estágio.
- **Diafragma**: o passo é sempre `t1 = π·dm1/z1` (anel completo) — calculado,
  nunca um dado independente. Diafragma não tem "grupos de injeção".

O mesmo raciocínio vale para os **ângulos de saída** de qualquer fileira de
pás, fixa ou móvel: nenhum dos dois é dado de entrada nesta ferramenta,
porque também não é no programa original — ambos vêm da geometria da
garganta e do passo, `sin(ângulo) = z·e/(π·dm)`:
- Bocal fixo → α1 (calculado em `engine.js`, dentro de `stageCalc`).
- Palheta móvel → β2e (idem — `sinBeta2e = z2·e2/(π·dm2)`; **nunca** pedir
  β2e como input de novo, é o erro mais fácil de reintroduzir sem querer).
`Engine.calcBladeAngleDeg(z, e, dm)` está exposta publicamente
(`public/apps/steampath/engine.js`) exatamente para o `ui.js` mostrar esses
ângulos como campo calculado/somente-leitura no formulário, ao vivo, sem
precisar rodar `Engine.run()` inteiro — ver `renderStageCards()` no
`ui.js` do STEAMPATH como modelo para qualquer variável "calculada, não
pedida" num formulário futuro (mesmo padrão do `steamNow`/`Vv` no PEVAL).

### Pistão de compensação (AK): pode haver mais de um, cada um num diafragma

Uma máquina pode ter mais de um pistão de compensação (AK). Eles vivem numa
lista **própria da máquina** (`state.akDevices` no `ui.js`, `params.akDevices`
no `engine.js`), com um botão de adicionar/remover — igual ao padrão dos
cards de estágio — e **não** dentro do card de um estágio: fisicamente um AK
não pertence a um estágio específico, é montado onde o projeto do rotor pede,
e referencia a pressão de admissão de QUALQUER estágio via `akStage`.
(Primeira versão deste app colocou os campos do AK dentro de "Geometria do
diafragma" de cada estágio — corrigido depois que o usuário apontou que isso
não reflete a estrutura real da máquina.) A ordem dos itens na lista É a
ordem física dos degraus da cadeia (do mais próximo do rotor para o mais
longe); o diâmetro-base do primeiro degrau continua vindo do d2n do 1º
estágio, em "Geometria do diafragma" desse estágio.

### Empuxo axial — metodologia real da planilha (não mais 1ª ordem)

A implementação anterior (área anular aproximada × Δp do estágio inteiro)
foi substituída pela metodologia efetivamente usada na planilha original
(aba Output, linhas 200–238), depois de extrair e validar as fórmulas
célula a célula (o termo RaI de um estágio real bateu em ~4623 N contra os
~4624 N calculados à mão a partir das fórmulas da planilha). Pontos que
custam a intuir de novo caso precise mexer aqui:

- A queda de pressão que empurra o disco é **só a do rotor** (`p1 − p2`,
  "P méd" menos "P2" na planilha), **não** a do estágio inteiro (`p0 − p2`)
  — o bocal fica na parte fixa (diafragma), a pressão que cai ali não atua
  sobre o disco.
- A área do disco usada é a aproximação simples `π·dm2·l2` (diâmetro médio ×
  altura de pá), a mesma que a planilha usa — **não** a área anular exata
  `π/4·(Dtopo²−Draiz²)`. Foi tentador "melhorar" para a fórmula exata numa
  versão anterior deste app; isso na verdade divergiu do original. Ficar com
  `π·dm2·l2`.
- Existe um termo RaIII (pressão de entrada do estágio sobre a face anular
  do eixo entre `d1n` e `d2n`, fórmula `p1·π·(d2n²−d1n²)/40`) que só é
  diferente de zero quando `d1n ≠ d2n`. A planilha original também calcula
  RaII e RaIV, mas **não os inclui** na soma final (conferido na própria
  fórmula da célula do total) — por isso este app também não os inclui;
  não "consertar" isso adicionando-os de volta sem entender por que a
  planilha os deixou de fora.
- A queda de pressão do rotor entra multiplicada por um coeficiente `k`
  (0,93–1,0 na planilha, obtido de uma carta a partir do número de Reynolds
  do escoamento entre disco e diafragma). Aqui `k` é um parâmetro ajustável
  por estágio (`kThrust`, padrão 0,95, campo "Atrito de disco e empuxo") em
  vez de derivado da carta — expor certo, calcular direito é trabalho futuro.
- O(s) pistão(ões) de compensação formam uma **cadeia de degraus**: o
  primeiro degrau vai do `d2n` do 1º estágio da máquina até o `dak` do
  primeiro AK; cada AK seguinte vai do `dak` anterior até o seu próprio
  `dak`; cada degrau é pressurizado pela pressão de admissão do estágio que
  ele referencia (`akStage`) — isso é o que a planilha chama de "Fak-",
  contra o empuxo. A face de trás do **último** degrau (do `d2n` do 1º
  estágio até o `dak` do último AK) é pressurizada pela pressão de escape —
  "Fant+", a favor do empuxo. Testado e validado: com os dados reais da
  CTU-TM5000 esse termo bateu em 528 N contra os 528,49 N da planilha.
- O resultado final da planilha ("Empuxo Axial Específico") não é a força
  em N — é essa força dividida pela área da pastilha do mancal axial
  (`α·π/4·(De²−Di²)`, ou uper uma área já conhecida), dando uma **pressão
  específica em MPa**. Os dois números (força em N e pressão em MPa) são
  reportados na aba Empuxo axial.
- Roda de regulagem tipo Curtis soma um termo extra (empuxo gerado pelo
  degrau do disco Curtis) que não foi implementado — o app avisa quando
  detecta esse tipo selecionado.

### Furos de equalização e o coeficiente k — investigação em aberto

O coeficiente `k` (empuxo axial, acima) hoje é um valor ajustável fixo
(`kThrust`). Na planilha original ele vem de uma fórmula real —
`k = ((alfa·beta+√(1+alfa²+beta²))/(1+alfa²))²` — onde `alfa` e `beta`
dependem, entre outras coisas, da vazão e do coeficiente de descarga dos
furos de equalização de pressão (carta "MiDes", em função de `sdes/torif²` e
`udes/cdes`) e do coeficiente de vazão entre disco e diafragma (carta "MiR",
em função de um número de Reynolds e de um parâmetro "deltar"). Ou seja: sim,
os furos de equalização entram no cálculo de empuxo da planilha original,
através do `k` — e isso **não está implementado** neste app; `kThrust` é uma
aproximação, não uma derivação.

O que já foi investigado e implementado, e pode ser reaproveitado quando
alguém voltar a este ponto:
- **Viscosidade da água/vapor** (IAPWS 1985, revisão 2003) — `Steam.viscosityFromRhoT(rho, T_K)`
  e `Steam.viscosityOfState(state)`, em `steam.js`. Validada contra o ponto de
  referência clássico (água líquida a 25°C, ρ=997,05 kg/m³ → 890,08 μPa·s,
  bate com a literatura).
- **Grau de reação na cabeça/base** (distribuição radial simplificada, sem
  precisar do módulo de equilíbrio radial completo): dado o grau de reação
  na linha média `ρ_médio = 1 − (h0−h1)/(h0−h2)` (h0 = entalpia de admissão
  do estágio, h1 = saída do bocal, h2 = saída do rotor — todas já calculadas
  pelo motor) e a razão `l/dm` do bocal, a planilha original usa
  `ρ_cabeça = 1 − (1−ρ_médio)·(1−1,8·l/dm)` e
  `ρ_base = 1 − (1−ρ_médio)·(1+1,8·l/dm)`. Essa parte é barata de implementar
  e não depende de nenhuma carta — só ainda não foi ligada a nada porque sem
  o restante da cadeia (Reynolds → MiR → k) ela sozinha não fecha o empuxo.
- **Número de Reynolds** entre disco e diafragma: a fórmula usa
  `ρ_médio − ρ_base` (não `ρ_base` sozinho) e a viscosidade no estado
  (P_méd, h_méd) = (p1, h1) do próprio estágio. Tentei validar contra o valor
  real da planilha (esperado Re≈3957 para o estágio E/1) e o número bateu
  só com ~30% de erro (deu ≈5136) — a viscosidade sozinha validou perfeita
  contra a água a 25°C, então o desvio está em alguma referência cruzada
  ainda não resolvida (a planilha usa `H4` como "h1" para o primeiro estágio,
  mas para os estágios seguintes essa célula referencia OUTRA célula
  (`I4='=H46'`) que ainda não foi totalmente rastreada).
- **O parâmetro "deltar" da carta MiR** não foi identificado com confiança —
  ele não bate com nenhuma razão óbvia das folgas já coletadas (ex.: δr/δ dá
  valores fora da faixa da carta, 0,8–3,5). Pior: a própria planilha original
  não escolhe essa coluna por fórmula — as células de referência (`MiR!C40`,
  `MiR!D40` etc.) estão **fixas manualmente** por estágio, sugerindo que o
  autor original escolhia a coluna "na mão" a partir de algum critério de
  projeto que não está documentado nas fórmulas.

**Se for retomar isto**: valeria perguntar ao usuário (que conhece a
ferramenta original de dentro) o que exatamente "deltar" representa fisicamente
na prática de projeto dele, e revisitar a cadeia de referências de `h1`
estágio a estágio (H4, I4, H46...) até fechar o Reynolds com precisão antes
de portar as cartas MiR/MiDes (2D, por interpolação — os dados das duas
cartas já foram extraídos e estão disponíveis se for preciso, mas não foram
portados para JS ainda).

## App PONTAEIXO — dimensionamento de ponta de eixo por fadiga (Shigley)

Substitui a verificação por torção estática pura de uma planilha antiga (mantida
como aba "Método simplificado" dentro do próprio app, para comparação/
continuidade — reproduz exatamente os mesmos números da planilha original,
conferido: 89,35 mm para o caso de referência P=2566 kW, n=3600 rpm,
SAE4340 chavetado). O método novo, principal, segue os capítulos 6 e 7 de
Shigley (*Mechanical Engineering Design*): energia de distorção (von Mises)
combinando flexão e torção alternadas/médias, fatores de Marin para achar
S<sub>e</sub>, sensibilidade ao entalhe (Neuber) para K<sub>f</sub>/K<sub>fs</sub>,
e um dos quatro critérios de fadiga (DE-Goodman/Gerber/ASME-Elíptico/
Soderberg) resolvido para o diâmetro.

### Constantes conferidas contra a literatura antes de codificar

Antes de implementar, cada tabela/equação numérica foi conferida por busca
contra pelo menos uma fonte independente (não só memória) — isso importa
porque é cálculo de máquina real, não exercício:
- Fatores de Marin k<sub>a</sub> (Tabela 6-2: a=1,58/-0,085 retificado;
  4,51/-0,265 usinado; 57,7/-0,718 laminado a quente; 272/-0,995 forjado,
  com S<sub>ut</sub> em MPa) — confirmado em 3 fontes independentes.
- k<sub>b</sub> = 1,24·d⁻⁰'¹⁰⁷ (2,79≤d≤51mm) ou 1,51·d⁻⁰'¹⁵⁷ (51<d≤254mm) —
  confirmado.
- Tabela de confiabilidade k<sub>e</sub> (50%→1,000 ... 99,9999%→0,620) —
  confirmado, valores exatos.
- Equação de Neuber (sensibilidade ao entalhe q): √a = 0,246−3,08×10⁻³S+
  1,51×10⁻⁵S²−2,67×10⁻⁸S³ (flexão/axial) e √a = 0,190−2,51×10⁻³S+
  1,35×10⁻⁵S²−2,67×10⁻⁸S³ (torção), com S=S<sub>ut</sub> em kpsi e √a em
  √polegada — confirmado. **Validação cruzada forte**: rodando o motor com
  os dados do Exemplo 7-1 de Shigley (S<sub>ut</sub>=724 MPa, r=2,79 mm) o
  q calculado bateu em 0,851 contra 0,85 do livro (lido de carta), e
  K<sub>f</sub>/K<sub>fs</sub> bateram em 1,578/1,370 contra 1,58/1,37 do
  livro — ver `engine.js`, função `notchSensitivity`.
- Tabela 7-1 (K<sub>t</sub>/K<sub>ts</sub> de 1ª iteração): filete de ombro
  raio vivo (2,7/2,2) e rasgo de chaveta perfil com chaveta montada
  (2,14/3,0) — confirmados em várias fontes. Filete bem arredondado
  (1,7/1,5), rasgo tipo trenó (1,7/1,6) e rasgo de anel de retenção
  (~5/~3, este último com "cerca de" citado na própria fonte) — valores
  usuais da literatura, mas sem confirmação tão forte quanto os dois
  primeiros; o app já avisa isso na dica ao lado do preset. Para peça
  crítica, confirmar K<sub>t</sub>/K<sub>ts</sub> reais na carta de
  Peterson (Fig. A-15-8/9) com o raio definido em desenho.
- k<sub>c</sub> = 1 (não 0,59) quando se usa a abordagem combinada por
  energia de distorção do capítulo 7 — o fator "3" já dentro da equação
  de von Mises equivalente já faz a conversão flexão↔torção; aplicar
  0,59 de novo contaria a redução em dobro. Por isso o app nem expõe
  k<sub>c</sub> como campo editável.

### O que o app assume/simplifica (documentar se mudar)

- **Carga axial ignorada** — Shigley trata isso explicitamente:
  "cargas axiais geralmente são pequenas e constantes, então são ignoradas"
  no dimensionamento de eixos. Se um caso futuro tiver carga axial
  relevante, precisa entrar como um termo a mais na tensão média/alternada
  (não implementado).
- **Torque padrão constante** (T<sub>m</sub>=T da potência, T<sub>a</sub>=0)
  e **flexão padrão totalmente alternada quando vem de força+braço**
  (M<sub>a</sub>=F·L, M<sub>m</sub>=0) — é o caso clássico de eixo girando
  com torque estável e carga transversal fixa (Shigley usa exatamente essa
  simplificação nos exemplos do cap. 7). Há campos avançados para fugir
  disso quando necessário.
- **Verificação estática usa σ'<sub>max</sub> ≈ σ'<sub>a</sub>+σ'<sub>m</sub>**
  (a "verificação simples alternativa" que o próprio Shigley oferece),
  não o cálculo separado por M<sub>max</sub>/T<sub>max</sub> com K<sub>f</sub>
  aplicado só na parcela alternada — mais simples e do lado conservador.
- **Não há tabela de material embutida** (S<sub>ut</sub>/S<sub>y</sub> são
  sempre digitados pelo usuário) — decisão deliberada: os dois materiais da
  planilha antiga (28CrMoNiV4-9, SAE4340) só tinham S<sub>ut</sub> conhecido
  ali, e S<sub>y</sub> depende do têmpera/revenido específico, que não dá
  para adivinhar com segurança. Se algum dia alguém trouxer S<sub>ut</sub>
  **e** S<sub>y</sub> confirmados por certificado para essas ligas/têmperas
  específicas da TGM, vale adicionar uma tabelinha aqui.
- **Iteração diâmetro↔fatores**: como K<sub>f</sub>/K<sub>fs</sub> (via raio,
  quando vem da Tabela 7-1 por r/d) e k<sub>b</sub> dependem do diâmetro
  final, o motor itera (chuta d, recalcula os fatores, resolve o diâmetro
  de novo, repete) até convergir — exatamente como Shigley resolve à mão
  nos exemplos do cap. 7. Ver `designShaftEnd` em `engine.js`.
- **Critério de fadiga escolhível com comparação lado a lado** dos quatro
  (Goodman/Gerber/ASME-Elíptico/Soderberg) — replica o Exemplo 7-1 de
  Shigley, que resolve os quatro para o mesmo carregamento e compara.

### Padrão de UI novo: seção recolhível para campos avançados

Não havia o CSS de `.subsection`/`.sub-title` do STEAMPATH disponível nesta
conversa (não foi enviado), então para os campos raramente usados (torque
flutuante, k<sub>d</sub>/k<sub>f</sub> avançados) foi recriado um padrão
equivalente com `<details class="section-block"><summary class="sub-title">`
(CSS em `public/apps/pontaeixo/index.html`) — reaproveitar este em vez de
recriar de novo, ou usar o `.subsection` do STEAMPATH se ele for enviado
numa conversa futura.

## App CICLOVAP — balanço térmico de ciclos a vapor

Monta qualquer ciclo a vapor arrastando componentes para um fluxograma e ligando
portas; resolve o balanço de massa e energia de todas as correntes; mostra o
ciclo em diagramas T-s e h-s (Mollier) e gera curvas paramétricas (eficiência,
heat rate, potência etc. em função de qualquer dado de entrada, com família de
curvas). Inspirado no THERMOFLEX (Thermoflow), em escala de protótipo.

Arquivos: `public/apps/ciclovap/{index.html, steam.js, engine.js, ui.js}`.
Linha em `public/apps.json`:
```json
{ "id": "ciclovap", "name": "CICLOVAP", "description": "Balanço térmico de ciclos a vapor: fluxograma, diagramas T-s/h-s e curvas de eficiência", "path": "/apps/ciclovap/", "icon": "♨️" }
```

### Motor (`engine.js`)

- `Engine.run(params)` recebe o fluxograma como objeto plano
  `{ components: [{id, type, name, params}], connections: [{id, from:{c,p}, to:{c,p}}] }`
  (campos de desenho como `x`, `y`, `flip` são ignorados) e devolve
  `{ ok, errors[], warnings[], streams[], streamMap{}, comps{}, totals, iterations, newton, residual }`.
  Erros e alertas trazem `c` (id do componente) quando se referem a um.
- Também expõe, para os diagramas: `Engine.processPaths(params, result)`
  (linhas de processo por componente), `Engine.dome()` (curva de saturação),
  `Engine.isobar(P, Tmax)`, e `Engine.props` (adaptador de propriedades, ver
  abaixo). Nada disso toca o DOM.
- Teste isolado: `node -e "global.Steam=require('./steam.js'); const E=require('./engine.js'); console.log(E.run({...}).totals)"`.
  Os três exemplos embutidos no `ui.js` foram usados como casos de regressão
  (Rankine regenerativo 120 bar/540 °C/100 kg/s: 98,29 MW líquidos, η ciclo 39,97 %;
  balanço global de energia fecha em < 1e-7 kW).

**Método de solução (orientado a equações — não é sequencial-modular):**
cada corrente tem 3 incógnitas (m [kg/s], P [bar], h [kJ/kg]). Cada componente
declara equações na forma "variável = f(outras)", com **formas alternativas**
(ex.: `m_saida = m_entrada` ou `m_entrada = m_saida`). Um emparelhamento
equação↔variável (algoritmo de Kuhn) escolhe qual forma cada equação usa e,
se o emparelhamento não fechar, gera a mensagem exata de "ninguém define a
vazão da corrente X" (sub-especificado) ou "excesso de especificações" (sobre).
Depois: substituição sucessiva (Gauss-Seidel) com as formas emparelhadas e
polimento por Newton-Raphson (Jacobiano por diferenças finitas, busca linear).
Por usar (P, h) como variáveis de estado, a região bifásica não exige caso especial.

**Convenções de especificação (importante ao criar componentes novos):**
- Pressão sempre se propaga **para a frente**: turbinas, bombas, válvulas e
  caldeira fixam a pressão de saída; trocadores repassam P − ΔP; o
  desaerador opera na pressão do vapor que entra; misturador usa a pressão
  da entrada 1. Entradas com pressão diferente são estranguladas
  implicitamente (isentálpico) — drenos em cascata não exigem válvula.
- Vazão: a caldeira fixa a vazão do ciclo; extrações são calculadas pelo
  balanço de energia do equipamento que as consome (aquecedor, desaerador,
  dessuperaquecedor, processo com carga térmica). Divisores têm modo
  "Definida a jusante" (sem especificação, a vazão vem de quem consome) ou
  "Fração da entrada".
- Para acrescentar um componente: no `engine.js`, uma entrada em `DEFS`
  (portas com `io`/`kind`/`label`/`optional`, `params`, `eqs(c,S,E)` com as
  formas alternativas, `post(c,S,R)` com resultados e alertas) e uma entrada
  em `PATHS` (como traçá-lo nos diagramas); no `ui.js`, uma entrada em `GEOM`
  (tamanho e posição/lado de cada porta), um `case` em `icon()` e o tipo em
  `PAL_ORDER`. A física não sabe desenhar e a UI não sabe física.

### Adaptador de propriedades sobre o `steam.js`

O motor não chama o `steam.js` diretamente: tudo passa por um adaptador
interno (`St`, exposto como `Engine.props`) que usa **só a API documentada**
(`stateFromPT`, `stateFromPS`, `stateFromPH`, `satAt`) e oferece ao solver
`h_pT`, `s_pT`, `state_ph`, `h_ps`, `tsat`, `psat`, `hf`, `hg`. Ele lê a
temperatura aceitando `T`/`T_degC`, trata a região bifásica a partir de
`satAt` (não depende do campo `x`) e guarda em cache as propriedades de
saturação (o solver faz milhares de consultas por cálculo). Outros apps que
precisem de muitas avaliações de propriedade (iterações, varreduras) podem
reaproveitar esse adaptador.

### Padrão de UI "editor de fluxograma"

Terceiro layout do hub (além de sidebar+main e coluna única): abaixo da
`hubnav`, uma barra do app (marca + Calcular/Automático/opções) e uma grade
`paleta | área central com abas | inspetor`. O fluxograma é SVG puro
(componentes como `<g>` com portas; ligações como Bézier com cor pela fase:
`--steam` vapor superaquecido, `--mix` mistura, `--water` líquido; portas de
saída cheias, de entrada vazadas). O inspetor mostra dados de entrada do item
selecionado, seus resultados e alertas, ou o resumo do ciclo quando nada está
selecionado. Cálculo automático com atraso de ~180 ms após cada alteração.
O pan/zoom da vista **não** é salvo no projeto; a posição de cada componente é.

### Diagramas e estudos paramétricos em Chart.js

- Diagramas de propriedades (T-s, h-s) usam `type: 'scatter'` com
  `showLine: true`, um dataset por curva (saturação, isobáricas, uma linha de
  processo por componente, pontos de estado). Tudo que não é dado do
  Chart.js (preenchimento da região bifásica, rótulos das isobáricas,
  números das correntes, mira com leitura de s/T/h sob o cursor) é desenhado
  por um plugin local (`beforeDatasetsDraw`/`afterDatasetsDraw`/`afterEvent`).
  Linhas de expansão seguem a eficiência isentrópica ponto a ponto; demais
  processos interpolam P e h linearmente (isobárica exata com P constante,
  isentálpica exata numa válvula). Eixos com `ticks.includeBounds: false`
  para não imprimir os limites como marcas soltas.
- Cores do Chart.js vêm dos tokens CSS lidos na hora de desenhar
  (`getComputedStyle`), e os gráficos são recriados ao alternar o tema.
- Estudo paramétrico: roda `Engine.run()` para cada ponto em fatias de ~40 ms
  (`setTimeout`), com progresso e botão Parar — padrão para qualquer app que
  varra um parâmetro chamando o motor muitas vezes sem travar a página.
  Pontos sem solução viram lacunas (`y: null`, `spanGaps: false`). A tabela
  resultante tem "Copiar tabela" em texto separado por tabulação com vírgula
  decimal, pronto para colar no Excel.

### Token `--brass-text`

Texto na cor da marca (valores-chave, status, marca do app) usa
`--brass-text`: igual a `--brass` no tema escuro e `--brass-dim` no claro,
porque `#10B6B6` sobre branco não tem contraste suficiente para texto.
Fundos e botões continuam em `--brass`. Vale adotar nos outros apps.

### Projeto salvo

`state = { components, connections, settings }`, onde `settings` guarda
preferências de visualização e a configuração do estudo paramétrico
(`labelMode`, `propMode`, `iso`, `nums`, `zoom`, `sweep`). Ao abrir, o
`applyProjectData` completa parâmetros ausentes com os valores padrão de
cada componente e descarta ligações para componentes inexistentes, então
projetos antigos continuam abrindo quando um componente ganha campos novos.
O app abre em branco; os três exemplos (Rankine simples, regenerativo,
cogeração) só carregam a pedido, pela tela vazia ou pelo menu.

### Limitações atuais e próximos passos

- Sem região 3 da IF97 (acima de ~165 bar e 350 °C): o app avisa quando uma
  corrente cai lá. Ciclos supercríticos exigem estender o `steam.js`.
- Só ponto de projeto. O próximo passo natural é o modo fora de projeto
  (lei da elipse de Stodola nas turbinas, correção de eficiência pela vazão,
  UA fixo nos trocadores), o que permite curvas de carga parcial na mesma
  aba de curvas.
- Não há fonte/sumidouro (água de reposição, purgas) nem caldeira detalhada
  (economizador/evaporador/superaquecedor, reaquecimento).

### Pendências de integração (resolver na primeira conversa com os arquivos do hub)

O CICLOVAP foi adaptado tendo só este arquivo como referência. Três pontos
foram reconstruídos pela descrição e **devem ser conferidos/substituídos**:
1. `steam.js` desta pasta é um substituto com a mesma API; sobrescrever com a
   cópia de `public/apps/steampath/steam.js` (o adaptador aceita os dois).
2. O bloco "Integração com o hub" no fim do `ui.js` (`buildProjectData`,
   `applyProjectData`, `openFileBrowser`/`fbList`/`fbConfirm`, `saveCurrent`,
   `wireProjectToolbar`) lê as respostas da API de forma tolerante, mas
   envia `content` como **objeto** no `POST /api/file`. Se o servidor
   espera string, trocar pelo bloco do PEVAL (mantendo este
   `applyProjectData`, que é específico do app).
   *(Atualização 2026-09-30: o contrato real — documentado na seção 5 — confirma
   `content` como objeto, então este envio está correto. Ainda vale conferir a
   leitura de `/api/browse`, que no PEVAL responde `{path, entries:[{name,isDir}]}`.)*
3. Markup/CSS da `.hubnav` e os tokens de cor foram recriados; alinhar com o
   `index.html` do PEVAL (e conferir o `href` do link "← Hub" e a versão do
   Chart.js carregada via CDN).
Depois de resolvido, apagar esta subseção e registrar no histórico.

## App ROTORDIN — rotordinâmica lateral

Modela um rotor em elementos finitos e calcula Campbell/críticas, formas modais,
resposta ao desbalanceamento (ISO 21940-11 e API 617), estabilidade e os
coeficientes de mancais hidrodinâmicos. Nasceu como programa Python/PySide6
(`rotordyn`, validado contra o ROSS da Petrobras) e foi **portado** para o hub;
a versão Python ficou como implementação de referência para validação.

Arquivos: `public/apps/rotordin/{index.html, engine.js, ui.js}` e
`tests/rotordin-validacao.js` + `tests/rotordin-referencia-python.json`.
Linha em `public/apps.json`:
```json
{ "id": "rotordin", "name": "ROTORDIN", "description": "Rotordinâmica lateral: Campbell, modos, desbalanceamento ISO/API, estabilidade e mancais hidrodinâmicos", "path": "/apps/rotordin/", "icon": "🌀" }
```

### Modelo físico e unidades

- Eixo: viga de Timoshenko, 4 GDL por nó `[ux, uy, sx, sy]`, rotação em +z;
  massa consistente, inércia rotacional, matriz giroscópica. Diâmetro "de massa"
  separado do "de rigidez" (`od_mass`/`id_mass`) para luvas e pacotes.
- Massas concentradas `m, Ip, Id`; helpers `Engine.diskFromGeometry` e
  `Engine.bladeRow` (palhetas como anel rígido).
- Mancais: 8 coeficientes, força `F = −K·q − C·q̇`, constantes ou vetores por
  rotação (interpolação linear, extremos mantidos).
- `M q̈ + (C(Ω) + Ω G) q̇ + K(Ω) q = F`.
- Entrada (formulário, arquivo e `params`): mm, µm (folga), kg, kg·m², N/m,
  N·s/m, rpm, °C; **nós numerados a partir de 1**. O motor converte para SI.
- **Inserir/excluir elemento renumera** os nós das massas e mancais
  (`shiftNodes`). Dividir um elemento insere a cópia **antes** do trecho, para
  o nó da extremidade direita (e o que estiver nele) ser empurrado — inserir
  depois era um bug real que deslocava fisicamente o impelidor.

### Motor (`engine.js`) — API

- `Engine.run(params)` — execução síncrona completa (Node/testes), devolve
  `results` = `{summary, bearings, campbell, modes, unbalance, stability, report, tables, warnings}`.
- `new Engine.Job(params, {tables})` + `job.step(ms)` → `{done, progress, label}` —
  mesma execução em fatias, usada pela interface. **Padrão para cálculos longos**:
  o trabalho é uma fila de tarefas incrementais (uma rotação do Campbell, um
  ponto de ε da tabela de mancal, um Q da estabilidade, 25 rotações do
  desbalanceamento) e `run()` só chama `step(Infinity)` até o fim — sem duplicar
  código entre o modo síncrono e o assíncrono. Lança erro com `.validation`
  (lista de mensagens) se `Engine.validate(params)` falhar.
- Blocos isolados reutilizáveis: `buildModel`, `modal`, `criticalSpeeds`,
  `unbalanceAt`, `majorAxis`, `stabilityPoint`, `staticLoads`, `standards.*`,
  `fluid.*`. Esquema das tabelas em `Engine.SCHEMA` (colunas, tipos, padrões,
  `enabled(row)` para células que dependem do tipo de mancal).

### Álgebra linear em JS puro (reutilizável)

Não há NumPy no navegador; `Engine._linalg` traz, conferidos contra NumPy
(erro relativo ~1e-14): LU real e complexa com pivotamento, balanceamento
(potências de 2), redução de Hessenberg e QR de Francis com duplo deslocamento
(porte do JAMA `orthes`/`hqr2`, só autovalores) e solver em banda sem
pivotamento (M-matrizes). Autovetores do problema quadrático
`(λ²M + λD + K)x = 0` por iteração inversa complexa (n×n, não 2n×2n). O
balanceamento é essencial: a matriz de estado mistura escalas de 1e0 a 1e8.

### Mancais hidrodinâmicos

Reynolds isotérmico por diferenças finitas (meia largura por simetria),
cavitação pela condição de Reynolds como complementaridade linear resolvida
pelo método primal-dual de conjunto ativo (partida a quente com o conjunto
cavitado anterior). No mancal 360° periódico os nós em θ são "dobrados"
(0, n−1, 1, n−2, …) para a matriz continuar em banda. Tipos: cilíndrico 360°,
2 ranhuras, elíptico, 3 lobos, tilting pad LOP/LBP (equilíbrio de momento por
sapata, redução síncrona `Z = K + iC`; sapatas descarregadas saem da redução).
Para cada geometria e L/D gera-se a tabela ε → S, atitude, K̄ = K·C/W,
C̄ = C·C·ω/W; na operação `S = μNLD/W·(R/C)²` e interpola-se em **log S**.
Viscosidade: Walther (ASTM D341) com ν100 típico por grau ISO VG. Tabelas
ficam em cache na sessão da página (0,2–1 s por geometria), não no projeto.

### Flecha estática

`Engine.deflection(p, model, w, tables, loads)` resolve a linha elástica sob peso
próprio (massa consistente × g) duas vezes: com **apoios rígidos** nos mancais
(flecha do eixo) e com o **munhão na posição de equilíbrio** de cada mancal na
rotação `w` (deslocamentos prescritos por penalidade). Para mancal hidrodinâmico a
posição vem da tabela de Sommerfeld (excentricidade ε·C na direção da atitude:
`Δx = ε·C·sen φ`, `Δy = −ε·C·cos φ`); para mancal constante, `W/k_yy`. **Não usar a
rigidez linearizada do filme para deslocamento estático** — ela só vale para
perturbações em torno do equilíbrio. A curva é interpolada por Hermite cúbico
dentro de cada elemento (16 pontos), o que dá a posição do máximo entre nós.
Devolve também reações, posição do munhão e inclinação do eixo em cada mancal.

### Folga, temperatura, vazão e pré-carga — `bearingState`

Toda condição de operação de um mancal hidrodinâmico sai de
`Engine.fluid.bearingState(p, row, W, w, tables, mods, strict)`, que encadeia:
temperaturas → folga a quente → pré-carga → viscosidade → S → coeficientes,
potência e vazão.

- **Folga**: a coluna "Folga radial a frio" é a de montagem (em `T_mount`).
  `C_quente = C_frio + R·α_mancal·(T_mancal − T_mont)·1e-3 − R·α_eixo·(T_munhão − T_mont)·1e-3`
  (µm, R em mm, α em µm/(m·K); `α_eixo` do material do elemento do munhão).
  "Folga a quente" informada prevalece. `Engine.bearingThermal(p, row, opt)` detalha.
- **Excentricidade do furo** (`e_bore`, µm; tipos com pré-carga): deslocamento do
  centro do furo da sapata/lobo, `e = C_p − C_b`. Pré-carga de operação
  `m = e/(C_quente + e)` — muda com a folga a quente, porque o furo é usinado.
  Sem `e_bore`, vale a coluna "Pré-carga m" (fixa).
- **Grade de pré-carga**: tabelas em m múltiplo de 0,05 (`PRELOAD_STEP`) e
  interpolação linear em m entre as duas vizinhas (`geoGrid`/`interpGrid`); m na
  grade usa uma só tabela (por isso os projetos de referência continuam idênticos).
  Erro da interpolação vs tabela exata ≈ 0,05 % em k_yy.
- **Potência e vazão** (integradas do campo de pressão, largura total):
  potência `= μω²R⁴/C · p̄w`, `p̄w = ∫∫(1/H + 3H·∂P/∂θ)dθdẑ` (atrito também na
  região cavitada — conservador); vazões `= ωR²C · q̄`, entrada na borda de ataque
  `q̄_in = ∫(H − H³∂P/∂θ)/2 dẑ`, vazamento lateral `q̄_s = ∫H³(−∂P/∂ẑ)dθ` (½ por borda ×
  2 bordas — o fator ½ já causou um erro de 2× nesta implementação). Alimentação =
  soma das entradas das sapatas/lobos; 360° sem ranhura = vazamento lateral.
  Guardadas nas tabelas (`pw`, `qin`, `qs`).
- **Térmica** (coluna "Térmica"): *Calculada* resolve, por Brent em ΔT,
  `ΔT = P/(ρ·c_p·Q_alim)` com `T_efetiva = T_entrada + k·ΔT` (`k_mix`, padrão 0,75),
  `T_saída = T_entrada + ΔT`, munhão = T saída e mancal = média entrada/saída (se não
  informados). É resolvida **em cada rotação** das curvas de coeficientes. *Informada*:
  T efetiva digitada; ΔT e vazão só estimados. Projetos sem a coluna abrem como
  "Informada" (compatibilidade). Óleo: ρ = 870·(1 − 0,00065·(T − 15)),
  c_p = 1800 + 3,4·T J/(kg·K) (mineral típico).
- `mods = { dT, crFactor, crMode: 'cold' }`: dT desloca a T de entrada (calculada)
  ou a T efetiva (informada); crFactor multiplica a folga de **fabricação**;
  'cold' usa a folga de montagem. Usados pela sensibilidade.

### Tabelas sob demanda no `Job`

Como a pré-carga de operação só se conhece durante o cálculo, as tabelas não são
mais planejadas no início. Em modo `strict`, `tableFor` lança um erro com
`needGeo`; `Job.step` captura, gera a tabela em fatias (`this.pending`, uma
excentricidade por passo, com rótulo no progresso) e **repete a tarefa**. Por isso
toda tarefa precisa ser repetível até o ponto em que pede a tabela (não empilhar
resultado parcial antes). Fora do `Job` (Node, testes) `tableFor` gera na hora.

### Validação (`node tests/rotordin-validacao.js`, 52 verificações)

Viga de Timoshenko biapoiada exata (0,004 %); modal, desbalanceamento,
críticas, estabilidade e tabelas de mancais iguais à versão Python (diferenças
1e-9 a 1e-15); mancal 360° L/D=1 vs Raimondi & Boyd (S < 1,2 %, atitude < 0,6°,
com a hipótese deles de filme iniciando na espessura máxima — o modelo 360°
periódico dá atitude ~3° maior, o que é esperado); coeficientes vs teoria do
mancal curto (< 3,4 %); flecha vs viga de Timoshenko biapoiada com carga distribuída e concentrada (exata nas casas mostradas); fórmula da folga a quente; tendências da sensibilidade (óleo mais quente → k_yy e h_mín menores; folga maior → k_yy menor, h_mín maior). Potência e vazões vs Raimondi & Boyd L/D = 1 ((R/C)·f, Q/(RCNL), Q_s/Q, erro < 1 %) e Petroff; fechamento do balanço de energia; pré-carga pelo furo; interpolação em m vs tabela exata; tendências (furo mais excêntrico → mais rígido; óleo de entrada mais quente → menos perda). **Rodar esse script antes de dar qualquer mudança no
motor como pronta.**

### Padrões de UI novos

- **Planilha editável** (`table.sheet`): uma `<input>`/`<select>` por célula,
  gerada a partir de `Engine.SCHEMA`; vírgula decimal na exibição e na leitura
  (`parseNum` aceita `1,5`, `1.5`, `1e8`, `1.234,5`); colar bloco do Excel
  (TSV) a partir da célula focada, criando linhas; Enter/↑/↓ navegam; células
  que não se aplicam ficam desabilitadas com "—"; botões ＋/✕ por linha;
  "Copiar tabela" em TSV. Reaproveitar para qualquer app com listas longas.
- **Desenho SVG interativo em proporção real**: `viewBox` com zoom pela roda
  (em torno do cursor), arrastar para mover, duplo clique para ajustar, clique
  seleciona a linha da tabela (e vice-versa), botão direito abre menu de
  contexto (`.ctx-menu`) com ações no nó mais próximo.
- **Desfazer/refazer por instantâneos** do `state` (JSON, até 200), Ctrl+Z/Ctrl+Y
  fora de campos em edição; indicador ● de alterações não salvas e aviso no
  `beforeunload`; aviso "resultados desatualizados" comparando a chave do
  estado usada no último cálculo.
- **Chart.js**: sempre dar pilha de fontes com alternativa
  (`'IBM Plex Sans', system-ui, sans-serif`) — sem isso, com o Google Fonts
  bloqueado, os gráficos caem em fonte serifada. Plugins locais para faixa de
  operação sombreada e linhas verticais; fase com a linha interrompida no salto
  ±180°. Gráficos criados só quando a aba é aberta e recriados ao trocar o tema.
- **Navegador de arquivos**: ao selecionar um item, só alternar a classe (como o
  PEVAL já faz) — se a lista for redesenhada no primeiro clique, o `dblclick` não
  dispara (bug real da primeira versão deste app).
- Não usar `text-transform: uppercase` em títulos com letras gregas (ζ vira Ζ).

### Limitações atuais

Mancais isotérmicos (sem THD), pivô rígido, coeficientes síncronos; sem
pedestal/suporte flexível, torção, axial, transiente; alocação ISO em 2 planos
só com o CG entre os planos; Campbell ordena modos por frequência (sem
rastreamento modal).

### Conformidade com o PEVAL (resolvido em 2026-09-30)

- `index.html` usa o `<style>` do PEVAL **sem alterações** (tokens, `hubnav`, shell
  `#app`/`.sidebar`/`.main`, `.field-group`, `.row`, `.btn`, `.btn-primary`,
  `.btn-toolbar`, `.icon-btn`, `.tabs`, `.card-grid`/`.stat-card`,
  `.chart-box`/`.chart-wrap`, `table`, `.notice`, modal `#fb-overlay`), seguido de um
  bloco "ROTORDIN — componentes específicos". Os tokens extras (`--brass-text`,
  `--grid`, `--disabled`, cores do desenho) são definidos nos dois temas.
- Markup da `hubnav` e do modal de arquivos idênticos ao PEVAL (mesmos ids). Chart.js
  do cdnjs, versão 4.4.0, como no PEVAL.
- Bloco de projetos do `ui.js` copiado do PEVAL, com três acréscimos que valem para
  os outros apps: confirmação ao substituir arquivo existente, duplo clique para abrir
  e indicador "● alterações não salvas" na caixa `#project-path-display`.
- Cuidados ao reaproveitar o CSS do PEVAL em apps com planilha: `.btn` é de largura
  total (usar `.btn-inline` para largura automática ou `.btn-toolbar`); `.icon-btn`
  é `display:flex` e empilha se a célula quebrar linha (`white-space:nowrap` na
  coluna de ações); o CSS do PEVAL não herda fonte/cor em `input` sem `type`, então
  a planilha declara `font-family`/`color` explicitamente.
- Diálogos auxiliares (disco por geometria, fileira de palhetas) usam um segundo modal
  fixo `#dlg-overlay` com as mesmas classes do navegador de arquivos.
- Validado ponta a ponta (Chromium headless) contra um servidor simulado com o
  contrato da seção 5: arquivo gravado como objeto, reaberto idêntico, sem erros de
  console.

## Como pedir um app novo numa conversa futura

1. Suba (upload) pelo menos: este arquivo (`ARCHITECTURE.md`), o
   `public/apps/peval/index.html` e `ui.js` (como referência de padrão), e
   `public/apps.json`.
2. Descreva o novo cálculo (fórmulas, variáveis de entrada/saída,
   metodologia — igual fizemos com o PEVAL: manuais/planilhas/código antigo
   que você tiver).
3. Peça para seguir as convenções deste arquivo.

Isso é suficiente para eu recriar o padrão exato sem precisar de memória da
conversa onde o hub foi construído.
