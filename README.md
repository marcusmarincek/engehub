# Hub de Cálculos — TGM

Servidor local para hospedar seus aplicativos internos de cálculo de
engenharia, protegido por usuário/senha, com salvar/abrir/salvar-como de
projetos em qualquer pasta do seu servidor. O primeiro app já incluído é o
**PEVAL** (perfil e desempenho do conjunto de válvulas de regulagem).

## 1. Pré-requisitos

- [Node.js](https://nodejs.org) versão 18 ou mais recente instalado no servidor.
- Nenhum banco de dados é necessário — tudo é salvo em arquivos `.json` comuns.

## 2. Instalação

```bash
cd hub                # entre na pasta deste projeto
npm install            # instala as dependências (Express, bcrypt, sessão)
node setup-password.js # configura usuário, senha e a pasta raiz de projetos
```

O `setup-password.js` vai perguntar:

1. **Usuário** — o nome de login (padrão `admin`).
2. **Senha** — digite e confirme. A senha é guardada apenas como hash (bcrypt)
   em `config.json`, nunca em texto puro.
3. **Pasta raiz de projetos** — a pasta do seu servidor onde os arquivos de
   projeto (`.json`) poderão ser salvos e abertos. Pode ser qualquer caminho
   que você queira — por exemplo `/mnt/dados/Calculos`, uma pasta de rede
   montada, ou o padrão `hub/data/projects`. **Tudo que estiver dentro dessa
   pasta (e subpastas) fica acessível pelo navegador de arquivos do app** —
   então aponte para uma pasta ampla se quiser organizar por
   cliente/máquina/turbina em subpastas.
4. **Porta** — padrão `3000`.

Você pode rodar `node setup-password.js` de novo a qualquer momento para
trocar a senha ou a pasta raiz.

## 3. Rodando o servidor

```bash
npm start
# ou diretamente:
node server.js
```

Acesse `http://SEU-SERVIDOR:3000` no navegador. Você verá a tela de login,
depois o hub com os apps disponíveis (por enquanto, só o PEVAL).

### Manter rodando permanentemente

Para o servidor continuar rodando mesmo depois que você fechar o terminal, e
reiniciar sozinho se cair ou se o servidor reiniciar, use o
[PM2](https://pm2.keymetrics.io/):

```bash
npm install -g pm2
pm2 start server.js --name calc-hub
pm2 save
pm2 startup     # segue as instruções impressas para iniciar no boot
```

### Acessando de outros computadores da rede / com HTTPS

Por padrão o servidor escuta em todas as interfaces na porta configurada.
Se quiser acessar de outros computadores da rede, use o IP do servidor:
`http://IP-DO-SERVIDOR:3000`. Para expor com HTTPS e/ou um domínio interno,
recomendamos colocar um proxy reverso na frente (nginx, Caddy ou Traefik) —
o servidor Node não precisa saber disso, ele continua respondendo em HTTP na
porta local.

## 4. Salvar, abrir e "salvar como"

Dentro do app PEVAL, a barra superior tem:

- **Abrir…** — navega pelas pastas dentro da sua "pasta raiz de projetos" e
  carrega um arquivo `.json` salvo anteriormente.
- **Salvar** — grava por cima do arquivo atualmente aberto. Se ainda não
  houver um arquivo associado, funciona como "Salvar como".
- **Salvar como…** — deixa escolher/criar uma pasta e um novo nome de
  arquivo. Use isso quando quiser partir de um cálculo existente como base
  para uma máquina semelhante, sem sobrescrever o original.

Os arquivos salvos são `.json` simples e legíveis — podem ser copiados,
versionados ou movidos manualmente pelo sistema de arquivos do servidor sem
problema, desde que continuem dentro da pasta raiz configurada (ou você
reconfigure a pasta raiz com `node setup-password.js` se mudar de lugar).

## 5. Adicionando novos aplicativos ao hub (para o futuro)

Cada app vive em `public/apps/<id-do-app>/` como uma página independente.
Para adicionar um novo:

1. Crie a pasta `public/apps/<novo-app>/` com seu `index.html` e scripts.
2. Adicione uma entrada em `public/apps.json`:
   ```json
   {
     "id": "novo-app",
     "name": "Nome do App",
     "description": "Uma linha explicando o que ele calcula.",
     "path": "/apps/novo-app/",
     "icon": "🔧"
   }
   ```
3. Pronto — ele aparece automaticamente na tela do hub, sem precisar mexer no
   servidor. O servidor e a API de salvar/abrir projetos (`/api/file`,
   `/api/browse`, `/api/mkdir`) já funcionam para qualquer app novo — basta
   cada app usar um campo `"appId"` próprio dentro do JSON salvo, do mesmo
   jeito que o PEVAL faz, para se identificar.

## 6. Estrutura do projeto

```
hub/
├── server.js              servidor Express (login, sessão, API de arquivos)
├── setup-password.js      script de configuração inicial (usuário/senha/pasta)
├── config.json             gerado pelo setup — usuário, hash da senha, pasta raiz
├── package.json
├── data/projects/          pasta raiz padrão de projetos (se você não trocar)
└── public/
    ├── login.html
    ├── hub.html            tela inicial com os apps disponíveis
    ├── apps.json           lista de apps do hub
    └── apps/
        └── peval/
            ├── index.html
            ├── engine.js   motor de cálculo (validado contra PEVAL.RES original)
            └── ui.js       formulário, gráficos, tabela e projeto (salvar/abrir)
```

## 7. Segurança — o que já está e o que considerar

**Já incluído:**
- Login por usuário/senha com hash bcrypt (a senha nunca é salva em texto puro).
- Sessão via cookie `httpOnly` (não acessível por JavaScript malicioso).
- Toda a API fica atrás do login — nenhuma rota de dados responde sem sessão válida.
- Proteção contra "path traversal" — não é possível ler/escrever fora da
  pasta raiz configurada, mesmo manipulando o caminho enviado ao servidor.

**Vale considerar antes de expor além da sua rede interna:**
- Isto roda em HTTP puro; para acesso pela internet, sempre coloque atrás de
  um proxy reverso com HTTPS (nginx/Caddy) — nunca exponha a porta 3000
  diretamente à internet.
- É pensado para um usuário (ou poucos, compartilhando a mesma senha). Se no
  futuro precisar de múltiplos usuários com senhas próprias, dá para
  evoluir `config.json` para uma lista de usuários — posso ajudar quando
  chegar a hora.
- O armazenamento de sessão é em memória (`express-session` padrão): se você
  reiniciar o servidor, todos precisam logar de novo. Para um uso mais
  robusto no futuro (múltiplas instâncias, etc.) dá para trocar por um
  armazenamento persistente.

## 8. Sobre a metodologia do cálculo (PEVAL)

O motor de cálculo do PEVAL foi traduzido a partir dos originais em Pascal e
FORTRAN (`PEVAL.pas`, `SUBROUTINE UUU/VVV/WEIN.f`), com as seguintes revisões
de engenharia em relação ao programa original:

- **Volume específico do vapor (V<sub>v</sub>)** é calculado automaticamente
  pela **IAPWS-IF97** (Região 2, vapor superaquecido) a partir da pressão e
  temperatura de vapor vivo informadas — não é mais digitado manualmente. A
  interface avisa se a condição informada não corresponder a vapor
  superaquecido (fora do domínio de validade da Região 2).
- **Não há mais G<sub>st</sub>/Pz<sub>st</sub>/Pot<sub>st</sub> por válvula.**
  A vazão, a pressão de câmara e a potência de cada válvula são consequência
  direta da área de injetores (F<sub>min</sub>) daquela válvula e das
  condições de escoamento — não valores-alvo predefinidos. Isso evita a
  dependência de ter, de antemão, a vazão de projeto do grupo de injeção de
  cada válvula (que normalmente viria de um cálculo de estágio separado).
- Existe **um único ponto de referência** (G<sub>st</sub>, Pz<sub>st</sub> e
  Pot<sub>st</sub> totais, na seção "Referência de projeto"), usado apenas
  para dar a forma da curva de pressão de câmara e calibrar a escala da
  curva de potência — não mais um ponto por válvula.

O motor foi validado contra o relatório de referência `PEVAL.RES` (caso
TMC100 / OS 40606): com os mesmos dados de entrada, vazão total, pressão de
câmara, %G, perdas e velocidade máxima na tubulação batem **exatamente**,
ponto a ponto (a pequena diferença de volume específico entre a IAPWS-IF97
atual e a tabela de vapor do programa original de 1990 — cerca de 0,08% —
é esperada e normal entre formulações válidas).

# E N G E H U B  
 