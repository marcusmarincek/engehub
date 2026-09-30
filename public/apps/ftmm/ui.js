// ============================================================================
// INTERFACE — conversor rápido + lista de medidas do projeto + integração hub
// ============================================================================
(function () {
  'use strict';

  // ---------------- Estado (abre sempre em branco — sem dado de exemplo) ----
  let state = {
    denom: 16,
    rows: []
  };

  function v(x) { return (x === '' || x === null || x === undefined) ? '' : x; }
  function fmt(n, d) { return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: d }); }
  function uid() { return 'r' + Math.random().toString(36).slice(2, 10); }

  // ---------------- Conversor rápido ----------------
  let qcDir = 'toMm';

  function updateQuickConverter() {
    if (qcDir === 'toMm') {
      const ft = document.getElementById('qc-ft').value;
      const inch = document.getElementById('qc-in').value;
      const mm = Engine.ftInToMm(ft, inch);
      document.getElementById('qc-mm-result').textContent = fmt(mm, 2) + ' mm';
      document.getElementById('qc-mm-sub').textContent = fmt(mm / 10, 3) + ' cm · ' + fmt(mm / 1000, 5) + ' m';
    } else {
      const mm = document.getElementById('qc-mm').value;
      const denom = parseInt(document.getElementById('qc-denom').value, 10);
      state.denom = denom;
      const r = Engine.mmToFtInFraction(mm, denom);
      document.getElementById('qc-ft-result').textContent = r.label;
      document.getElementById('qc-ft-sub').textContent = fmt(r.decimalFeet, 4) + ' pés decimais · ' + fmt(r.decimalInches, 4) + ' pol decimais';
    }
  }

  function setQcTab(dir) {
    qcDir = dir;
    document.querySelectorAll('#qc-tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.dir === dir));
    document.getElementById('qc-panel-toMm').classList.toggle('active', dir === 'toMm');
    document.getElementById('qc-panel-toFt').classList.toggle('active', dir === 'toFt');
    updateQuickConverter();
  }

  function wireQuickConverter() {
    document.querySelectorAll('#qc-tabs .tab').forEach(tab => {
      tab.onclick = () => setQcTab(tab.dataset.dir);
    });
    ['qc-ft', 'qc-in', 'qc-mm', 'qc-denom'].forEach(id => {
      document.getElementById(id).addEventListener('input', updateQuickConverter);
    });
    document.getElementById('qc-add').onclick = addQuickToRows;
  }

  function addQuickToRows() {
    const labelInput = document.getElementById('qc-label');
    const label = labelInput.value.trim() || ('Medida ' + (state.rows.length + 1));
    let row;
    if (qcDir === 'toMm') {
      row = { id: uid(), direction: 'toMm', label, ft: document.getElementById('qc-ft').value, inches: document.getElementById('qc-in').value };
    } else {
      row = {
        id: uid(), direction: 'toFt', label,
        mm: document.getElementById('qc-mm').value,
        denom: parseInt(document.getElementById('qc-denom').value, 10)
      };
    }
    state.rows.push(row);
    labelInput.value = '';
    renderRows();
  }

  // ---------------- Lista de medidas (dado salvo do projeto) ----------------
  function rowResultText(row) {
    if (row.direction === 'toMm') {
      const mm = Engine.ftInToMm(row.ft, row.inches);
      return { entrada: (v(row.ft) || 0) + '\' ' + (v(row.inches) || 0) + '"', resultado: fmt(mm, 2) + ' mm' };
    }
    const r = Engine.mmToFtInFraction(row.mm, row.denom || state.denom);
    return { entrada: fmt(parseFloat(row.mm) || 0, 2) + ' mm', resultado: r.label };
  }

  function renderRows() {
    const empty = document.getElementById('rows-empty');
    const wrap = document.getElementById('rows-table-wrap');
    const actions = document.getElementById('rows-actions');
    if (!state.rows.length) {
      empty.style.display = '';
      wrap.style.display = 'none';
      actions.style.display = 'none';
      return;
    }
    empty.style.display = 'none';
    wrap.style.display = '';
    actions.style.display = '';
    const tbody = document.getElementById('rows-tbody');
    tbody.innerHTML = state.rows.map(row => {
      const r = rowResultText(row);
      const safeLabel = String(row.label || '').replace(/"/g, '&quot;');
      return '<tr>' +
        '<td style="text-align:left;"><input type="text" class="mono row-label" data-id="' + row.id + '" value="' + safeLabel + '" ' +
        'style="width:100%;background:transparent;border:none;color:inherit;font-family:inherit;font-size:inherit;padding:2px 0;"></td>' +
        '<td style="text-align:left;">' + r.entrada + '</td>' +
        '<td>' + r.resultado + '</td>' +
        '<td><button class="icon-btn row-remove" data-id="' + row.id + '" title="Remover">\u2715</button></td>' +
        '</tr>';
    }).join('');
    tbody.querySelectorAll('.row-remove').forEach(btn => {
      btn.onclick = () => { state.rows = state.rows.filter(r => r.id !== btn.dataset.id); renderRows(); };
    });
    tbody.querySelectorAll('.row-label').forEach(inp => {
      inp.addEventListener('change', () => {
        const row = state.rows.find(r => r.id === inp.dataset.id);
        if (row) row.label = inp.value;
      });
    });
  }

  function toCSV() {
    const lines = [['Identificacao', 'Entrada', 'Resultado'].join(';')];
    state.rows.forEach(row => {
      const r = rowResultText(row);
      lines.push([row.label, r.entrada, r.resultado].map(x => '"' + String(x).replace(/"/g, '""') + '"').join(';'));
    });
    return lines.join('\n');
  }

  function wireRowsActions() {
    document.getElementById('rows-csv').onclick = () => {
      const blob = new Blob([toCSV()], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'medidas_convertidas.csv'; a.click();
      URL.revokeObjectURL(url);
    };
    document.getElementById('rows-clear').onclick = () => {
      if (state.rows.length && !confirm('Remover todas as medidas da lista?')) return;
      state.rows = [];
      renderRows();
    };
  }

  // ==========================================================================
  // PROJETOS — salvar / abrir / salvar como (padrão genérico do hub,
  // copiado quase literalmente de public/apps/peval/ui.js — só troca o APP_ID)
  // ==========================================================================
  const APP_ID = 'ftmm';
  let currentProjectPath = null;

  function buildProjectData(name) {
    return {
      appId: APP_ID,
      version: 1,
      name: name || (currentProjectPath ? currentProjectPath.split('/').pop().replace(/\.json$/i, '') : 'projeto'),
      savedAt: new Date().toISOString(),
      state
    };
  }

  function applyProjectData(data) {
    if (!data || !data.state) { alert('Arquivo de projeto inválido.'); return; }
    if (data.appId && data.appId !== APP_ID) {
      if (!confirm('Este arquivo foi salvo pelo app "' + data.appId + '", não pelo conversor. Tentar carregar mesmo assim?')) return;
    }
    state = Object.assign({ denom: 16, rows: [] }, data.state);
    document.getElementById('qc-denom').value = String(state.denom || 16);
    renderRows();
  }

  function updateProjectDisplay() {
    document.getElementById('project-path-display').value = currentProjectPath ? currentProjectPath : '(projeto não salvo)';
  }

  // ---- File browser modal (idêntico ao padrão do hub) ----
  let fbMode = 'open';
  let fbCurrentDir = '';
  let fbSelected = null;

  async function fbList(dir) {
    const res = await fetch('/api/browse?path=' + encodeURIComponent(dir));
    if (!res.ok) { document.getElementById('fb-msg').textContent = 'Erro ao listar pasta.'; return; }
    const data = await res.json();
    fbCurrentDir = data.path;
    fbSelected = null;
    renderBreadcrumb();
    const list = document.getElementById('fb-list');
    if (!data.entries.length) {
      list.innerHTML = '<div class="modal-row" style="color:var(--ink-faint);cursor:default;">— pasta vazia —</div>';
      return;
    }
    list.innerHTML = data.entries.map(e =>
      '<div class="modal-row ' + (e.isDir ? 'dir' : '') + '" data-name="' + e.name + '" data-isdir="' + e.isDir + '">' +
      '<span class="ic">' + (e.isDir ? '\u{1F4C1}' : '\u{1F4C4}') + '</span><span>' + e.name + '</span></div>'
    ).join('');
    list.querySelectorAll('.modal-row[data-name]').forEach(row => {
      row.onclick = () => {
        const name = row.dataset.name, isDir = row.dataset.isdir === 'true';
        if (isDir) {
          fbList(fbCurrentDir ? fbCurrentDir + '/' + name : name);
        } else {
          list.querySelectorAll('.modal-row').forEach(r => r.classList.remove('selected'));
          row.classList.add('selected');
          fbSelected = { name, isDir };
          if (fbMode === 'save') document.getElementById('fb-filename').value = name;
        }
      };
    });
  }

  function renderBreadcrumb() {
    const bc = document.getElementById('fb-breadcrumb');
    const parts = fbCurrentDir ? fbCurrentDir.split('/').filter(Boolean) : [];
    let html = '<button data-path="">raiz</button>';
    let acc = '';
    parts.forEach(p => {
      acc = acc ? acc + '/' + p : p;
      html += ' / <button data-path="' + acc + '">' + p + '</button>';
    });
    bc.innerHTML = html;
    bc.querySelectorAll('button').forEach(b => { b.onclick = () => fbList(b.dataset.path); });
  }

  function openFileBrowser(mode) {
    fbMode = mode;
    document.getElementById('fb-title').textContent = mode === 'open' ? 'Abrir projeto' : 'Salvar projeto como';
    document.getElementById('fb-msg').textContent = '';
    document.getElementById('fb-filename').style.display = mode === 'save' ? '' : 'none';
    document.getElementById('fb-filename').value = currentProjectPath ? currentProjectPath.split('/').pop() : 'medidas.json';
    document.getElementById('fb-confirm').textContent = mode === 'open' ? 'Abrir' : 'Salvar aqui';
    document.getElementById('fb-overlay').classList.add('open');
    const startDir = currentProjectPath && currentProjectPath.includes('/') ? currentProjectPath.split('/').slice(0, -1).join('/') : '';
    fbList(startDir);
  }
  function closeFileBrowser() { document.getElementById('fb-overlay').classList.remove('open'); }

  async function fbConfirm() {
    const msg = document.getElementById('fb-msg');
    msg.textContent = '';
    if (fbMode === 'open') {
      if (!fbSelected || fbSelected.isDir) { msg.textContent = 'Selecione um arquivo .json.'; return; }
      const rel = fbCurrentDir ? fbCurrentDir + '/' + fbSelected.name : fbSelected.name;
      const res = await fetch('/api/file?path=' + encodeURIComponent(rel));
      if (!res.ok) { msg.textContent = 'Erro ao carregar o arquivo.'; return; }
      const data = await res.json();
      currentProjectPath = rel;
      updateProjectDisplay();
      applyProjectData(data.content);
      closeFileBrowser();
    } else {
      let filename = document.getElementById('fb-filename').value.trim();
      if (!filename) { msg.textContent = 'Digite um nome de arquivo.'; return; }
      if (!filename.toLowerCase().endsWith('.json')) filename += '.json';
      const rel = fbCurrentDir ? fbCurrentDir + '/' + filename : filename;
      const payload = buildProjectData(filename.replace(/\.json$/i, ''));
      const res = await fetch('/api/file', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: rel, content: payload, overwrite: true })
      });
      if (!res.ok) { msg.textContent = 'Erro ao salvar.'; return; }
      currentProjectPath = rel;
      updateProjectDisplay();
      closeFileBrowser();
    }
  }

  async function saveCurrent() {
    if (!currentProjectPath) { openFileBrowser('save'); return; }
    const payload = buildProjectData();
    const res = await fetch('/api/file', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: currentProjectPath, content: payload, overwrite: true })
    });
    if (!res.ok) { alert('Erro ao salvar o projeto.'); return; }
    const btn = document.getElementById('btn-save');
    const old = btn.textContent; btn.textContent = 'Salvo ✓';
    setTimeout(() => { btn.textContent = old; }, 1200);
  }

  function wireProjectToolbar() {
    document.getElementById('btn-open').onclick = () => openFileBrowser('open');
    document.getElementById('btn-save').onclick = saveCurrent;
    document.getElementById('btn-saveas').onclick = () => openFileBrowser('save');
    document.getElementById('fb-close').onclick = closeFileBrowser;
    document.getElementById('fb-confirm').onclick = fbConfirm;
    document.getElementById('fb-overlay').addEventListener('click', (e) => { if (e.target.id === 'fb-overlay') closeFileBrowser(); });
    document.getElementById('fb-newfolder').onclick = async () => {
      const name = prompt('Nome da nova pasta:');
      if (!name) return;
      const rel = fbCurrentDir ? fbCurrentDir + '/' + name : name;
      await fetch('/api/mkdir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: rel }) });
      fbList(fbCurrentDir);
    };
    updateProjectDisplay();
  }

  async function wireHubNav() {
    const who = await fetch('/api/whoami').then(r => r.json()).catch(() => ({ authed: false }));
    if (!who.authed) { window.location.href = '/login.html'; return; }
    document.getElementById('hubnav-who').textContent = who.username;
    document.getElementById('hubnav-logout').onclick = async () => {
      await fetch('/api/logout', { method: 'POST' });
      window.location.href = '/login.html';
    };
  }

  function wireTheme() {
    const btn = document.getElementById('btn-theme');
    if (!btn) return;
    btn.onclick = () => {
      const cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
      const next = cur === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('hub-theme', next); } catch (e) { /* tema não persiste, segue com o padrão */ }
    };
  }

  // ---------------- Init ----------------
  function init() {
    setQcTab('toMm');
    wireQuickConverter();
    wireRowsActions();
    wireProjectToolbar();
    wireHubNav();
    wireTheme();
    renderRows();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
