// ============================================================================
// server.js — Hub local de aplicativos de cálculo de engenharia
// Login por usuário/senha (sessão em cookie) + API de arquivos de projeto
// (salvar / abrir / salvar-como) restrita à pasta raiz configurada.
// ============================================================================
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');
if (!fs.existsSync(CONFIG_PATH)) {
  console.error('\nNenhuma configuração encontrada. Rode primeiro:  node setup-password.js\n');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const PROJECTS_ROOT = path.resolve(config.projectsRoot);
fs.mkdirSync(PROJECTS_ROOT, { recursive: true });

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 14 } // 14 dias
}));

// ---------------------------------------------------------------------------
// Autenticação
// ---------------------------------------------------------------------------
function requireAuth(req, res, next) {
  if (req.session && req.session.authed) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'not_authenticated' });
  return res.redirect('/login.html');
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'missing_fields' });
  if (username !== config.username) return res.status(401).json({ error: 'invalid_credentials' });
  const ok = bcrypt.compareSync(password, config.passwordHash);
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
  req.session.authed = true;
  req.session.username = username;
  res.json({ ok: true, username });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/whoami', (req, res) => {
  if (req.session && req.session.authed) res.json({ authed: true, username: req.session.username });
  else res.json({ authed: false });
});

// login page is public
app.use('/login.html', express.static(path.join(__dirname, 'public', 'login.html')));
app.use('/css', express.static(path.join(__dirname, 'public', 'css')));

// everything below requires auth
app.use(requireAuth);

// ---------------------------------------------------------------------------
// API de arquivos de projeto (restrita a PROJECTS_ROOT)
// ---------------------------------------------------------------------------
function safeResolve(relPath) {
  const rel = (relPath || '').replace(/^[/\\]+/, '');
  const resolved = path.resolve(PROJECTS_ROOT, rel);
  const rootWithSep = PROJECTS_ROOT.endsWith(path.sep) ? PROJECTS_ROOT : PROJECTS_ROOT + path.sep;
  if (resolved !== PROJECTS_ROOT && !resolved.startsWith(rootWithSep)) {
    throw new Error('path_outside_root');
  }
  return resolved;
}

// Lista pastas e arquivos .json em um diretório (relativo à raiz)
app.get('/api/browse', (req, res) => {
  try {
    const rel = req.query.path || '';
    const dir = safeResolve(rel);
    if (!fs.existsSync(dir)) return res.status(404).json({ error: 'not_found' });
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) return res.status(400).json({ error: 'not_a_directory' });
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory() || e.name.toLowerCase().endsWith('.json'))
      .map(e => ({ name: e.name, isDir: e.isDirectory() }))
      .sort((a, b) => (a.isDir === b.isDir) ? a.name.localeCompare(b.name) : (a.isDir ? -1 : 1));
    res.json({ path: rel.replace(/\\/g, '/'), root: PROJECTS_ROOT, entries });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/mkdir', (req, res) => {
  try {
    const { path: relPath } = req.body || {};
    const dir = safeResolve(relPath);
    fs.mkdirSync(dir, { recursive: true });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/file', (req, res) => {
  try {
    const rel = req.query.path || '';
    const file = safeResolve(rel);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return res.status(404).json({ error: 'not_found' });
    const content = JSON.parse(fs.readFileSync(file, 'utf8'));
    res.json({ ok: true, content, path: rel });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/file', (req, res) => {
  try {
    const { path: relPath, content, overwrite } = req.body || {};
    if (!relPath) return res.status(400).json({ error: 'missing_path' });
    const file = safeResolve(relPath);
    if (fs.existsSync(file) && overwrite === false) {
      return res.status(409).json({ error: 'already_exists' });
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(content, null, 2), 'utf8');
    res.json({ ok: true, path: relPath });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/file', (req, res) => {
  try {
    const rel = req.query.path || '';
    const file = safeResolve(rel);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Manifesto de apps do hub + arquivos estáticos
// ---------------------------------------------------------------------------
app.get('/api/apps', (req, res) => {
  const manifestPath = path.join(__dirname, 'public', 'apps.json');
  res.json(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.redirect('/hub.html'));

const PORT = config.port || process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\nHub de cálculos rodando em http://localhost:${PORT}`);
  console.log(`Pasta raiz de projetos: ${PROJECTS_ROOT}\n`);
});
