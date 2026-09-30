// ============================================================================
// setup-password.js
// Configura (ou reconfigura) o usuário/senha de acesso e a pasta raiz de
// projetos do hub. Rode com:  node setup-password.js
// ============================================================================
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const CONFIG_PATH = path.join(__dirname, 'config.json');

function loadExisting() {
  if (fs.existsSync(CONFIG_PATH)) {
    try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (e) { return {}; }
  }
  return {};
}

function ask(rl, query) {
  return new Promise((resolve) => rl.question(query, (v) => resolve(v)));
}

async function main() {
  const existing = loadExisting();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n=== Configuração de acesso do Hub de Cálculos ===');
  console.log('(a senha é digitada em texto visível — rode isto num terminal privado)\n');

  const usernameRaw = await ask(rl, `Usuário [${existing.username || 'admin'}]: `);
  const username = usernameRaw.trim() || existing.username || 'admin';

  const password = await ask(rl, 'Nova senha: ');
  const password2 = await ask(rl, 'Confirme a senha: ');

  if (!password || password !== password2) {
    console.error('\nAs senhas não conferem ou estão vazias. Nada foi alterado.');
    rl.close();
    process.exit(1);
  }

  const defaultRoot = existing.projectsRoot || path.join(__dirname, 'data', 'projects');
  const rootRaw = await ask(rl, `Pasta raiz de projetos (onde os arquivos .json salvos podem ficar) [${defaultRoot}]: `);
  const projectsRoot = rootRaw.trim() || defaultRoot;

  const portRaw = await ask(rl, `Porta do servidor [${existing.port || 3000}]: `);
  const port = parseInt(portRaw.trim()) || existing.port || 3000;

  const passwordHash = bcrypt.hashSync(password, 10);
  const sessionSecret = existing.sessionSecret || crypto.randomBytes(32).toString('hex');
  const resolvedRoot = path.resolve(projectsRoot);
  fs.mkdirSync(resolvedRoot, { recursive: true });

  const config = { username, passwordHash, projectsRoot: resolvedRoot, sessionSecret, port };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

  console.log(`\nConfiguração salva em ${CONFIG_PATH}`);
  console.log(`Pasta raiz de projetos: ${resolvedRoot}`);
  console.log(`\nPara iniciar o servidor:  npm start   (ou: node server.js)\n`);
  rl.close();
}

main();
