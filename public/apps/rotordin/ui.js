/*
 * ROTORDIN — interface (formulário, desenho do rotor, planilhas, gráficos, projetos).
 * Um único IIFE, seguindo ARCHITECTURE.md. O cálculo fica todo em engine.js.
 */
(function () {
  'use strict';
  var APP_ID = 'rotordin';
  var E = window.Engine;

  // ======================================================================= //
  // Estado
  // ======================================================================= //
  function blankState() {
    return { name: '', shaft: [], disks: [], bearings: [], analysis: Object.assign({}, E.DEFAULT_ANALYSIS) };
  }
  var state = blankState();
  var ui = {
    tab: 'model', sheet: 'shaft', sel: { table: null, row: -1 }, view: null,
    results: null, resultsKey: null, rendered: {}, charts: {}, running: null,
    file: null, savedKey: null, calcMsg: null, errors: []
  };
  var tablesCache = {};           // tabelas de Sommerfeld já calculadas nesta sessão
  var undoStack = [], redoStack = [];

  // ======================================================================= //
  // Utilidades
  // ======================================================================= //
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function stateKey() { return JSON.stringify(state); }
  function analysisKey() { return JSON.stringify([state.shaft, state.disks, state.bearings, state.analysis]); }

  // Aceita "1,5", "1.5", "1e8", "1,2E+05", "1.234,5"; vazio -> null; inválido -> NaN
  function parseNum(text) {
    var t = String(text === null || text === undefined ? '' : text).trim().replace(/\s/g, '');
    if (t === '') return null;
    if (t.indexOf(',') >= 0 && t.indexOf('.') >= 0) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(',', '.');
    var v = Number(t);
    return isFinite(v) ? v : NaN;
  }
  // Exibição em célula (vírgula decimal, notação científica para valores extremos)
  function fmtCell(v) {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v !== 'number') return String(v);
    var a = Math.abs(v);
    if (a !== 0 && (a >= 1e6 || a < 1e-3)) return Number(v.toPrecision(6)).toExponential().replace('.', ',').replace('e+', 'e');
    return String(Number(v.toPrecision(8))).replace('.', ',');
  }
  function fN(v, d) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    if (Math.abs(v) < 0.5 * Math.pow(10, -d)) v = 0;          // evita "−0,00"
    return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function fE(v, d) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return Number(v).toExponential(d === undefined ? 3 : d).replace('.', ',').replace('e+', 'e');
  }

  // Avisos na área #notices (padrão PEVAL); kind: 'ok' | 'info' | 'error'
  function toast(msg, kind) { ui.calcMsg = { msg: msg, kind: kind || 'info' }; renderNotices(); }
  function renderNotices() {
    var el = $('notices');
    if (!el) return;
    var h = [];
    if (ui.errors.length) h.push('<div class="notice error"><strong>Corrija antes de calcular:</strong> ' + ui.errors.map(esc).join('; ') + '</div>');
    if (ui.calcMsg) h.push('<div class="notice ' + (ui.calcMsg.kind === 'err' ? 'error' : ui.calcMsg.kind) + '">' + esc(ui.calcMsg.msg) + '</div>');
    el.innerHTML = h.join('');
  }
  // ======================================================================= //
  // Desfazer / refazer e "sujo"
  // ======================================================================= //
  function resetHistory() { undoStack = [stateKey()]; redoStack = []; }
  function commit() {
    var k = stateKey();
    if (k !== undoStack[undoStack.length - 1]) {
      undoStack.push(k);
      if (undoStack.length > 200) undoStack.shift();
      redoStack = [];
    }
    afterChange();
  }
  function afterChange() {
    updateDirty();
    updateStale();
    renderSummary();
    renderRotorSvg();
    renderUndoButtons();
  }
  function undo() {
    if (undoStack.length < 2) return;
    redoStack.push(undoStack.pop());
    state = JSON.parse(undoStack[undoStack.length - 1]);
    renderAll();
  }
  function redo() {
    if (!redoStack.length) return;
    var k = redoStack.pop();
    undoStack.push(k);
    state = JSON.parse(k);
    renderAll();
  }
  function renderUndoButtons() {
    var u = $('btnUndo'), r = $('btnRedo');
    if (u) u.disabled = undoStack.length < 2;
    if (r) r.disabled = !redoStack.length;
  }

  function updateDirty() {
    var dirty = stateKey() !== ui.savedKey, d = $('project-path-display');
    if (d) {
      d.value = (ui.file ? ui.file.path : '(projeto não salvo)') + (dirty && state.shaft.length ? '   ● alterações não salvas' : '');
      d.style.color = dirty && state.shaft.length ? 'var(--amber)' : '';
    }
  }
  function updateStale() {
    var m = $('main');
    if (m) m.classList.toggle('is-stale', !!ui.results && analysisKey() !== ui.resultsKey);
  }

  // ======================================================================= //
  // Estrutura do eixo (inserir/excluir elementos renumera nós das massas e mancais)
  // ======================================================================= //
  function shiftNodes(fromNode, delta) {
    state.disks.concat(state.bearings).forEach(function (r) {
      if (r.node >= fromNode) r.node = Math.max(1, r.node + delta);
    });
  }
  function insertElement(index, row) {
    if (!row) row = clone(state.shaft[Math.min(index, state.shaft.length - 1)] || E.blankRow('shaft'));
    state.shaft.splice(index, 0, row);
    shiftNodes(index + 2, +1);
  }
  function deleteElement(index) {
    if (state.shaft.length <= 1) { alert('O rotor precisa de pelo menos um elemento.'); return false; }
    state.shaft.splice(index, 1);
    shiftNodes(index + 2, -1);
    return true;
  }
  function splitElement(index, parts) {
    parts = parts || 2;
    var r = state.shaft[index];
    r.L = r.L / parts;
    // insere as cópias ANTES do trecho: o nó da extremidade direita (e o que estiver nele) é empurrado
    for (var k = 0; k < parts - 1; k++) insertElement(index, clone(r));
  }

  // ======================================================================= //
  // Barra lateral (configuração das análises)
  // ======================================================================= //
  var SIDE = [
    { group: 'Faixa de rotação', fields: [
      { key: 'speed_max', label: 'Rotação máx. da varredura [rpm]', kind: 'num' },
      { key: 'op_min', label: 'Mínima de operação [rpm]', kind: 'num' },
      { key: 'op_max', label: 'Máxima contínua (MCS) [rpm]', kind: 'num' },
      { key: 'n_speeds', label: 'Pontos no Campbell', kind: 'int' },
      { key: 'n_modes', label: 'Nº de modos', kind: 'int' },
      { key: 'mode_speed', label: 'Rotação das formas modais [rpm]', kind: 'num' }
    ] },
    { group: 'Desbalanceamento', fields: [
      { key: 'G', label: 'Grau de qualidade ISO G [mm/s]', kind: 'num', list: E.standards.ISO_G_GRADES },
      { key: 'planes', label: 'Planos de balanceamento', kind: 'select', options: [[1, '1 plano'], [2, '2 planos']] },
      { key: 'plane_A', label: 'Nó do plano A', kind: 'int' },
      { key: 'plane_B', label: 'Nó do plano B', kind: 'int', showIf: function (a) { return Number(a.planes) === 2; } },
      { key: 'probes', label: 'Nós das sondas', kind: 'text', ph: 'vazio = mancais' }
    ] },
    { group: 'Estabilidade', fields: [
      { key: 'stab_node', label: 'Nó da rigidez cruzada', kind: 'int' },
      { key: 'stab_Qmax', label: 'Q máximo [N/m]', kind: 'num' }
    ] }
  ];


  // campos da barra lateral no formato do PEVAL: dois por linha, rótulo acima
  var SIDE = [
    { group: 'Faixa de rotação', rows: [
      [{ key: 'op_min', label: 'Mín. de operação', unit: 'rpm' }, { key: 'op_max', label: 'Máx. contínua (MCS)', unit: 'rpm' }],
      [{ key: 'speed_max', label: 'Máx. da varredura', unit: 'rpm' }, { key: 'mode_speed', label: 'Rotação dos modos', unit: 'rpm' }],
      [{ key: 'n_speeds', label: 'Pontos no Campbell', int: true }, { key: 'n_modes', label: 'Nº de modos', int: true }]
    ], hint: 'A faixa entre a mínima de operação e a MCS aparece sombreada nos gráficos e é a referência das margens de separação.' },
    { group: 'Desbalanceamento', rows: [
      [{ key: 'G', label: 'Grau ISO G', unit: 'mm/s', list: E.standards.ISO_G_GRADES },
       { key: 'planes', label: 'Planos de balanceamento', select: [[1, '1 plano'], [2, '2 planos']] }],
      [{ key: 'plane_A', label: 'Nó do plano A', int: true }, { key: 'plane_B', label: 'Nó do plano B', int: true, twoPlanes: true }],
      [{ key: 'probes', label: 'Nós das sondas', text: true, ph: 'vazio = nós dos mancais' }]
    ], hint: 'ISO 21940-11 (1 ou 2 planos, CG entre os planos) e API 617 (U<sub>a</sub> = 2·6350·W/N no meio do vão, AF por meia potência e margem de separação). Confira a edição da norma exigida no contrato.' },
    { group: 'Mancais — temperatura e folga', rows: [
      [{ key: 'T_mount', label: 'T de montagem', unit: '°C' }, { key: 'sens_dT', label: 'Variação de T do óleo', unit: '± °C' }],
      [{ key: 'sens_dC', label: 'Variação da folga', unit: '± %' }, { key: 'k_mix', label: 'Fração k (T efetiva)' }]
    ], hint: 'Folga informada em cada mancal = <b>a frio</b> (na T de montagem). Com térmica <b>calculada</b>, o balanço P = ρ·c<sub>p</sub>·Q·ΔT dá a elevação ΔT do óleo; T efetiva = T entrada + k·ΔT (k típico 0,5–1), munhão na T de saída e mancal na média. Daí saem a folga a quente e, com a excentricidade do furo, a pré-carga de operação. Variações = estudo de sensibilidade (T de entrada e folga de fabricação).' },
    { group: 'Estabilidade', rows: [
      [{ key: 'stab_node', label: 'Nó da rigidez cruzada', int: true }, { key: 'stab_Qmax', label: 'Q máximo', unit: 'N/m' }]
    ], hint: 'Rigidez cruzada desestabilizante (k<sub>xy</sub> = +Q, k<sub>yx</sub> = −Q) somada no nó, na MCS. Critério: δ ≥ 0,1.' }
  ];
  function sideField(key) {
    var f = null;
    SIDE.forEach(function (g) { g.rows.forEach(function (r) { r.forEach(function (x) { if (x.key === key) f = x; }); }); });
    return f;
  }

  function renderSidebar() {
    var a = state.analysis, h = [];
    h.push('<div class="brand"><div class="mark">RD</div><h1>ROTORDIN</h1></div>' +
           '<div class="sub">Rotordinâmica lateral — Campbell, modos, desbalanceamento, estabilidade e mancais</div>');
    h.push('<div class="field-group"><h2>Identificação</h2><div><label>Nome do rotor</label>' +
           '<input type="text" id="f-name" data-side="name" value="' + esc(state.name) + '" placeholder="ex.: Compressor K-101"></div></div>');
    SIDE.forEach(function (g) {
      h.push('<div class="field-group"><h2>' + esc(g.group) + '</h2>');
      g.rows.forEach(function (row) {
        h.push('<div class="row">');
        row.forEach(function (f) {
          var v = a[f.key], lab = esc(f.label) + (f.unit ? ' <span class="unit">(' + f.unit + ')</span>' : '');
          var dis = f.twoPlanes && Number(a.planes) !== 2 ? ' disabled' : '';
          h.push('<div><label>' + lab + '</label>');
          if (f.select) {
            h.push('<select data-side="' + f.key + '">' + f.select.map(function (o) {
              return '<option value="' + o[0] + '"' + (Number(v) === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>');
          } else {
            h.push('<input type="text" data-side="' + f.key + '" value="' + (f.text ? esc(v) : fmtCell(v)) + '"' + dis +
                   (f.ph ? ' placeholder="' + esc(f.ph) + '"' : '') + (f.list ? ' list="dl-' + f.key + '"' : '') + '>');
            if (f.list) h.push('<datalist id="dl-' + f.key + '">' + f.list.map(function (x) { return '<option value="' + fmtCell(x) + '">'; }).join('') + '</datalist>');
          }
          h.push('</div>');
        });
        h.push('</div>');
      });
      if (g.hint) h.push('<div class="hint">' + g.hint + '</div>');
      h.push('</div>');
    });
    h.push('<div class="calc-box" id="calcBox"></div>');
    $('sidebar').innerHTML = h.join('');
    renderCalcBox();
  }

  function onSideChange(e) {
    var el = e.target, key = el.getAttribute('data-side');
    if (!key) return;
    if (key === 'name') { state.name = el.value; commit(); return; }
    var f = sideField(key);
    if (!f) return;
    var v;
    if (f.text) v = el.value;
    else if (f.select) v = Number(el.value);
    else {
      v = parseNum(el.value);
      if (v === null || isNaN(v)) { el.classList.add('invalid'); setTimeout(function () { el.classList.remove('invalid'); el.value = fmtCell(state.analysis[key]); }, 900); return; }
      if (f.int) v = Math.round(v);
      el.value = fmtCell(v);
    }
    state.analysis[key] = v;
    commit();
    if (key === 'planes') renderSidebar();
  }

  function renderCalcBox() {
    var box = $('calcBox');
    if (!box) return;
    var run = ui.running, has = state.shaft.length > 0;
    box.innerHTML = run
      ? '<button class="btn" id="btnStop">Parar cálculo</button><div class="progress"><div style="width:' + Math.round(100 * run.progress) +
        '%"></div></div><div class="progress-label">' + esc(run.label) + ' — ' + Math.round(100 * run.progress) + ' %</div>'
      : '<button class="btn-primary" id="btnCalc"' + (has ? '' : ' disabled') + '>Calcular (Ctrl+Enter)</button>';
    renderNotices();
  }
  // ======================================================================= //
  // Área principal
  // ======================================================================= //
  var TABS = [['model', 'Modelo'], ['deflection', 'Flecha'], ['bearings', 'Mancais'], ['oil', 'Óleo e folga'], ['campbell', 'Campbell'], ['modes', 'Modos'],
              ['unbalance', 'Desbalanceamento'], ['stability', 'Estabilidade'], ['report', 'Relatório']];

  function renderAll() {
    renderSummary();
    renderSidebar();
    renderMain();
    updateDirty();
    renderUndoButtons();
  }

  function renderMain() {
    destroyCharts();
    ui.rendered = {};
    var m = $('main');
    if (!state.shaft.length) { m.innerHTML = renderEmptyState(); return; }
    var h = ['<div class="tabs" id="mainTabs">'];
    TABS.forEach(function (t) { h.push('<button class="tab' + (ui.tab === t[0] ? ' active' : '') + '" data-tab="' + t[0] + '">' + t[1] + '</button>'); });
    h.push('</div>');
    h.push('<div class="panel' + (ui.tab === 'model' ? ' active' : '') + '" id="panel-model">' + modelPanelHtml() + '</div>');
    TABS.slice(1).forEach(function (t) {
      h.push('<div class="panel' + (ui.tab === t[0] ? ' active' : '') + '" id="panel-' + t[0] + '">' +
             '<div class="notice stale">Os dados mudaram depois do último cálculo — estes resultados estão desatualizados. Clique em <b>Calcular</b>.</div>' +
             '<div id="res-' + t[0] + '"></div></div>');
    });
    m.innerHTML = h.join('');
    renderSheet();
    renderSummary();
    ui.view = null;
    renderRotorSvg();
    updateStale();
    renderUndoButtons();
    if (ui.tab !== 'model') renderPanel(ui.tab);
  }


  function renderEmptyState() {
    return '<div class="notice" style="text-align:center;padding:40px 20px;">' +
      'Monte o modelo do rotor — elementos de eixo, massas (impelidores, palhetas, acoplamento) e mancais — ' +
      'ou abra um projeto salvo com <strong>Abrir…</strong> no topo.' +
      '<div class="empty-actions"><button class="btn-primary inline" data-empty="new">Novo rotor em branco</button>' +
      '<button class="btn-toolbar" data-empty="open">Abrir projeto…</button>' +
      '<button class="btn-toolbar" data-empty="example">Carregar exemplo (compressor com tilting pad)</button></div></div>';
  }
  function selectTab(t) {
    ui.tab = t;
    document.querySelectorAll('#mainTabs .tab').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-tab') === t); });
    document.querySelectorAll('#main > .panel').forEach(function (p) { p.classList.toggle('active', p.id === 'panel-' + t); });
    if (t === 'model') { ui.view = ui.view || null; renderRotorSvg(); }
    else renderPanel(t);
  }

  // ---- painel do modelo ------------------------------------------------- //

  function modelPanelHtml() {
    var b = function (tool, label, tip, id) { return '<button class="btn-toolbar" data-tool="' + tool + '"' + (id ? ' id="' + id + '"' : '') + (tip ? ' title="' + tip + '"' : '') + '>' + label + '</button>'; };
    return '<div class="toolbar">' +
      b('addEl', '+ Elemento', 'Insere elemento após o selecionado') + b('split', 'Dividir', 'Divide o elemento selecionado em 2') +
      b('addDisk', '+ Massa') + b('diskGeom', 'Disco por geometria…') + b('blades', 'Fileira de palhetas…') + b('addBrg', '+ Mancal') +
      b('delRow', 'Excluir', 'Exclui a linha selecionada da tabela ativa') + '<span class="sep"></span>' +
      b('undo', '↶ Desfazer', 'Ctrl+Z', 'btnUndo') + b('redo', '↷ Refazer', 'Ctrl+Y', 'btnRedo') + '<span class="sep"></span>' +
      b('fit', 'Ajustar vista') + '</div>' +
      '<div class="rotor-view" id="rotorView"><svg id="rotorSvg" preserveAspectRatio="xMidYMid meet"></svg>' +
      '<div class="view-hint">roda: zoom · arrastar: mover · duplo clique: ajustar · botão direito: editar</div></div>' +
      '<div class="model-summary" id="modelSummary"></div>' +
      '<div class="tabs sub" id="sheetTabs">' +
      [['shaft', 'Eixo'], ['disks', 'Massas'], ['bearings', 'Mancais']].map(function (t) {
        return '<button class="tab' + (ui.sheet === t[0] ? ' active' : '') + '" data-sheet="' + t[0] + '">' + t[1] + '</button>';
      }).join('') + '</div><div id="sheetArea"></div>';
  }

  function renderSummary() {
    var z = E.nodePositionsMm(state), mass = 0;
    state.shaft.forEach(function (r) {
      var m = E.MATERIALS[r.material] || E.MATERIALS['Aço'], odm = r.od_mass === null || r.od_mass === '' ? r.od : r.od_mass,
          idm = r.id_mass === null || r.id_mass === '' ? r.id : r.id_mass;
      mass += m.rho * Math.PI / 4 * (odm * odm - idm * idm) * 1e-6 * r.L * 1e-3;
    });
    state.disks.forEach(function (d) { mass += Number(d.m) || 0; });
    var has = state.shaft.length > 0;
    $('hdr-name').textContent = state.name || '—';
    $('hdr-nodes').textContent = has ? state.shaft.length + 1 : '—';
    $('hdr-mass').textContent = has ? fN(mass, 1) : '—';
    $('hdr-brg').textContent = has ? state.bearings.length : '—';
    var el = $('modelSummary');
    if (!el) return;
    var errs = E.validate(state);
    el.innerHTML = '<span>Nós: <b>' + (state.shaft.length + 1) + '</b></span><span>Comprimento: <b>' + fN(z[z.length - 1], 1) + ' mm</b></span>' +
      '<span>Massa: <b>' + fN(mass, 2) + ' kg</b></span><span>Massas: <b>' + state.disks.length + '</b></span><span>Mancais: <b>' + state.bearings.length + '</b></span>' +
      (errs.length ? '<span style="color:var(--red)">⚠ ' + esc(errs[0]) + (errs.length > 1 ? ' (+' + (errs.length - 1) + ')' : '') + '</span>' : '<span style="color:var(--green)">✓ modelo consistente</span>');
  }
  // ======================================================================= //
  // Planilhas (Eixo / Massas / Mancais)
  // ======================================================================= //
  var SHEET_HINT = {
    shaft: 'Cada linha é um trecho de eixo entre dois nós consecutivos (o nó i fica à esquerda do elemento i). ' +
           'OD/ID massa: diâmetros que só somam massa (luvas, pacotes de lâminas); vazio = igual ao de rigidez.',
    disks: 'Massas concentradas rígidas: m, momento polar Ip (gera o efeito giroscópico) e diametral Id em relação ao próprio CG. ' +
           'Use "Disco por geometria…" ou "Fileira de palhetas…" para calcular a partir das dimensões.',
    bearings: 'Constante: 8 coeficientes informados. Hidrodinâmicos: coeficientes pela equação de Reynolds, interpolados pelo número de Sommerfeld em cada rotação. ' +
              'Folga: informe a folga radial A FRIO; a quente sai da dilatação (ou é informada). Excentricidade do furo: define a pré-carga de operação m = e/(C_quente + e). ' +
              'Térmica calculada: temperaturas pelo balanço entre atrito e calor levado pelo óleo (informe a T de entrada); informada: digite a T efetiva. Carga vazia = peso próprio.'
  };

  function renderSheet() {
    var area = $('sheetArea');
    if (!area) return;
    var t = ui.sheet, cols = E.SCHEMA[t], rows = state[t], h = [];
    h.push('<div class="sheet-bar"><button class="btn-toolbar" data-sheetact="append">+ Linha</button>' +
           '<button class="btn-toolbar" data-sheetact="copy" title="Texto separado por tabulação, vírgula decimal — cola direto no Excel">Copiar tabela</button>' +
           '<span class="spacer"></span><span class="hint" style="margin:0">Colar do Excel: selecione a célula inicial e Ctrl+V.</span></div>');
    h.push('<div class="table-scroll sheet-wrap"><table class="sheet" data-table="' + t + '"><thead><tr><th>#</th>');
    cols.forEach(function (c) { h.push('<th' + (c.tip ? ' title="' + esc(c.tip) + '"' : '') + '>' + esc(c.label) + '</th>'); });
    h.push('<th></th></tr></thead><tbody>');
    rows.forEach(function (r, i) {
      var sel = ui.sel.table === t && ui.sel.row === i;
      h.push('<tr data-r="' + i + '"' + (sel ? ' class="sel"' : '') + '><td class="rn" data-rowsel="' + i + '">' + (i + 1) + '</td>');
      cols.forEach(function (c, j) {
        var en = !c.enabled || c.enabled(r), dis = en ? '' : ' disabled', v = r[c.key];
        if (c.kind === 'choice') {
          h.push('<td><select data-r="' + i + '" data-c="' + j + '"' + dis + '>' + c.choices.map(function (o) {
            return '<option' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select></td>');
        } else {
          var val = !en ? '—' : (c.kind === 'str' ? esc(v) : fmtCell(v));
          h.push('<td><input data-r="' + i + '" data-c="' + j + '"' + (c.kind === 'str' ? ' class="str"' : '') + ' value="' + val + '"' + dis + '></td>');
        }
      });
      h.push('<td class="act"><button class="icon-btn" data-rowact="ins" data-r="' + i + '" title="Inserir linha acima">+</button>' +
             '<button class="icon-btn" data-rowact="del" data-r="' + i + '" title="Excluir linha">&times;</button></td></tr>');
    });
    h.push('</tbody></table></div><div class="hint">' + esc(SHEET_HINT[t]) + '</div>');
    area.innerHTML = h.join('');
  }

  function setCell(t, r, c, text) {
    var col = E.SCHEMA[t][c], row = state[t][r];
    if (col.enabled && !col.enabled(row)) return true;
    var v;
    if (col.kind === 'str') v = String(text);
    else if (col.kind === 'choice') { v = String(text).trim(); if (col.choices.indexOf(v) < 0) return false; }
    else {
      v = parseNum(text);
      if (isNaN(v)) return false;
      if (v === null) { if (col.kind !== 'opt') return false; }
      else if (col.kind === 'int') v = Math.round(v);
    }
    row[col.key] = v;
    return true;
  }

  function selectRow(t, r, fromCanvas) {
    ui.sel = { table: t, row: r };
    document.querySelectorAll('table.sheet tr[data-r]').forEach(function (tr) {
      tr.classList.toggle('sel', Number(tr.getAttribute('data-r')) === r && ui.sheet === t);
    });
    if (fromCanvas) {
      var tr = document.querySelector('table.sheet tr[data-r="' + r + '"]');
      if (tr) tr.scrollIntoView({ block: 'nearest' });
    }
    renderRotorSvg();
  }

  function addRow(t, at, row) {
    if (t === 'shaft') insertElement(at, row);
    else {
      var ref = row || clone(state[t][Math.max(0, at - 1)] || E.blankRow(t));
      if (!row && t === 'disks') ref.name = 'Massa ' + (state.disks.length + 1);
      if (!row && t === 'bearings') ref.name = 'M' + (state.bearings.length + 1);
      state[t].splice(at, 0, ref);
    }
  }
  function deleteRow(t, r) {
    if (t === 'shaft') return deleteElement(r);
    state[t].splice(r, 1);
    return true;
  }

  function copySheet() {
    var t = ui.sheet, cols = E.SCHEMA[t];
    var lines = [cols.map(function (c) { return c.label; }).join('\t')];
    state[t].forEach(function (r) { lines.push(cols.map(function (c) { return c.kind === 'str' || c.kind === 'choice' ? r[c.key] : fmtCell(r[c.key]); }).join('\t')); });
    copyText(lines.join('\n'));
    toast('Tabela copiada (' + state[t].length + ' linhas).', 'ok');
  }
  function copyText(s) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(s).catch(fallback);
    else fallback();
    function fallback() { var ta = document.createElement('textarea'); ta.value = s; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) { /* */ } ta.remove(); }
  }

  function onSheetChange(e) {
    var el = e.target, tab = el.closest('table.sheet');
    if (!tab || !el.hasAttribute('data-c')) return;
    var t = tab.getAttribute('data-table'), r = Number(el.getAttribute('data-r')), c = Number(el.getAttribute('data-c'));
    var col = E.SCHEMA[t][c];
    if (!setCell(t, r, c, el.value)) {
      el.classList.add('invalid');
      setTimeout(function () { el.classList.remove('invalid'); el.value = col.kind === 'str' ? state[t][r][col.key] : fmtCell(state[t][r][col.key]); }, 900);
      return;
    }
    if (col.kind !== 'str' && col.kind !== 'choice') el.value = fmtCell(state[t][r][col.key]);
    commit();
    if (col.key === 'type') renderSheet();
  }

  function onSheetPaste(e) {
    var el = e.target, tab = el.closest && el.closest('table.sheet');
    if (!tab || !el.hasAttribute('data-c')) return;
    var text = (e.clipboardData || window.clipboardData).getData('text');
    if (!/[\t\n]/.test(text.replace(/\s+$/, ''))) return;           // colagem simples numa célula
    e.preventDefault();
    var t = tab.getAttribute('data-table'), r0 = Number(el.getAttribute('data-r')), c0 = Number(el.getAttribute('data-c'));
    var lines = text.replace(/\r/g, '').split('\n');
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    var bad = 0;
    lines.forEach(function (ln, k) {
      var r = r0 + k;
      while (r >= state[t].length) addRow(t, state[t].length);
      ln.split('\t').forEach(function (cell, j) {
        var c = c0 + j;
        if (c < E.SCHEMA[t].length && !setCell(t, r, c, cell)) bad++;
      });
    });
    commit();
    renderSheet();
    toast(lines.length + ' linha(s) colada(s)' + (bad ? ' — ' + bad + ' célula(s) inválida(s) ignorada(s)' : '') + '.', bad ? 'err' : 'ok');
  }

  function onSheetKey(e) {
    var el = e.target;
    if (!el.hasAttribute || !el.hasAttribute('data-c') || !el.closest('table.sheet')) return;
    var r = Number(el.getAttribute('data-r')), c = el.getAttribute('data-c'), to = null;
    if (e.key === 'Enter' || (e.key === 'ArrowDown' && el.tagName === 'INPUT')) to = r + 1;
    else if (e.key === 'ArrowUp' && el.tagName === 'INPUT') to = r - 1;
    if (to === null) return;
    e.preventDefault();
    el.blur();
    var nx = document.querySelector('table.sheet [data-r="' + to + '"][data-c="' + c + '"]');
    if (nx) { nx.focus(); if (nx.select) nx.select(); }
  }

  // ======================================================================= //
  // Desenho do rotor (SVG, proporção real)
  // ======================================================================= //
  function geomInfo() {
    var z = E.nodePositionsMm(state), L = z[z.length - 1] || 1;
    var rmax = Math.max.apply(null, state.shaft.map(function (r) { return (Number(r.od) || 1) / 2; }).concat([1]));
    var sBrg = Math.max(0.025 * L, rmax * 0.5), maxR = rmax;
    state.disks.forEach(function (d) { maxR = Math.max(maxR, diskR(d, rmax)); });
    return { z: z, L: L, rmax: rmax, sBrg: sBrg, yNodes: Math.max(rmax + 2.4 * sBrg, maxR * 1.04), maxR: maxR };
  }
  function diskR(d, rmax) {
    var r = (d.m > 0 && d.Ip > 0) ? Math.sqrt(2 * d.Ip / d.m) * 1000 : rmax * 1.5;
    return Math.max(r, rmax * 1.15);
  }
  function fitView() {
    var g = geomInfo(), fs = g.L * 0.018;
    ui.view = { x: -0.04 * g.L, y: -(g.maxR + 3 * fs), w: 1.08 * g.L, h: g.maxR + 3 * fs + g.yNodes + 3 * fs };
  }
  function renderRotorSvg() {
    var svg = $('rotorSvg');
    if (!svg || !state.shaft.length) return;
    if (!ui.view) fitView();
    var g = geomInfo(), z = g.z, v = ui.view, fs = Math.max(v.w, v.h * 2.5) * 0.016, h = [];
    svg.setAttribute('viewBox', [v.x, v.y, v.w, v.h].join(' '));
    var S = ui.sel;
    state.shaft.forEach(function (r, i) {
      var ro = r.od / 2, x = z[i], L = r.L;
      if (r.od_mass !== null && r.od_mass !== '' && r.od_mass !== undefined && Number(r.od_mass) !== Number(r.od)) {
        var rm = r.od_mass / 2;
        h.push('<rect class="mass-layer" x="' + x + '" y="' + (-rm) + '" width="' + L + '" height="' + (2 * rm) + '" pointer-events="none"/>');
      }
      h.push('<rect class="shaft-el' + (S.table === 'shaft' && S.row === i ? ' sel' : '') + '" data-t="shaft" data-i="' + i + '" x="' + x + '" y="' + (-ro) + '" width="' + L + '" height="' + (2 * ro) + '"><title>Elemento ' + (i + 1) + ': L=' + fmtCell(L) + ' mm, OD=' + fmtCell(r.od) + ', ID=' + fmtCell(r.id) + ' mm, ' + esc(r.material) + '</title></rect>');
      if (Number(r.id) > 0) h.push('<rect class="hollow" x="' + x + '" y="' + (-r.id / 2) + '" width="' + L + '" height="' + r.id + '" pointer-events="none"/>');
    });
    z.forEach(function (x, n) {
      h.push('<line class="node-tick" x1="' + x + '" y1="' + (-g.rmax * 1.1) + '" x2="' + x + '" y2="' + g.yNodes + '"/>');
      h.push('<text x="' + x + '" y="' + (g.yNodes + fs * 1.1) + '" font-size="' + fs + '" text-anchor="middle">' + (n + 1) + '</text>');
    });
    var w = Math.max(0.012 * g.L, 4);
    state.disks.forEach(function (d, i) {
      if (!(d.node >= 1 && d.node <= z.length)) return;
      var x = z[d.node - 1], rr = diskR(d, g.rmax);
      h.push('<rect class="disk-el' + (S.table === 'disks' && S.row === i ? ' sel' : '') + '" data-t="disks" data-i="' + i + '" x="' + (x - w / 2) + '" y="' + (-rr) + '" width="' + w + '" height="' + (2 * rr) + '"><title>' + esc(d.name) + ': nó ' + d.node + ', m=' + fmtCell(d.m) + ' kg, Ip=' + fmtCell(d.Ip) + ', Id=' + fmtCell(d.Id) + ' kg·m²</title></rect>');
      h.push('<text class="lbl-disk" x="' + x + '" y="' + (-rr - fs * 0.45) + '" font-size="' + fs + '" text-anchor="middle">' + esc(d.name) + '</text>');
    });
    state.bearings.forEach(function (b, i) {
      if (!(b.node >= 1 && b.node <= z.length)) return;
      var x = z[b.node - 1], el = state.shaft[Math.min(b.node - 1, state.shaft.length - 1)], ro = el.od / 2, s = g.sBrg;
      var cls = b.type === 'Constante' ? 'brg-const' : 'brg-fluid';
      h.push('<polygon class="' + cls + (S.table === 'bearings' && S.row === i ? ' sel' : '') + '" data-t="bearings" data-i="' + i + '" points="' +
             x + ',' + ro + ' ' + (x - s / 2) + ',' + (ro + s) + ' ' + (x + s / 2) + ',' + (ro + s) + '"><title>' + esc(b.name) + ': nó ' + b.node + ', ' + esc(b.type) + '</title></polygon>');
      h.push('<text class="lbl-brg" x="' + x + '" y="' + (ro + s + fs * 1.05) + '" font-size="' + fs + '" text-anchor="middle" style="fill:var(--' + (b.type === 'Constante' ? 'brg-const' : 'brg-fluid') + ')">' + esc(b.name) + '</text>');
    });
    h.push('<line class="centerline" x1="' + (-0.03 * g.L) + '" y1="0" x2="' + (1.03 * g.L) + '" y2="0" pointer-events="none"/>');
    svg.innerHTML = h.join('');
  }
  function svgPoint(svg, cx, cy) {
    var p = svg.createSVGPoint(); p.x = cx; p.y = cy;
    return p.matrixTransform(svg.getScreenCTM().inverse());
  }
  function nearestNode(x) {
    var z = E.nodePositionsMm(state), best = 0;
    z.forEach(function (v, i) { if (Math.abs(v - x) < Math.abs(z[best] - x)) best = i; });
    return best + 1;
  }
  function wireSvg() {
    var drag = null;
    document.addEventListener('wheel', function (e) {
      var svg = e.target.closest && e.target.closest('#rotorSvg');
      if (!svg || !ui.view) return;
      e.preventDefault();
      var p = svgPoint(svg, e.clientX, e.clientY), f = e.deltaY < 0 ? 1 / 1.15 : 1.15, v = ui.view;
      ui.view = { x: p.x - (p.x - v.x) * f, y: p.y - (p.y - v.y) * f, w: v.w * f, h: v.h * f };
      renderRotorSvg();
    }, { passive: false });
    document.addEventListener('pointerdown', function (e) {
      var svg = e.target.closest && e.target.closest('#rotorSvg');
      if (!svg || e.button !== 0) return;
      drag = { svg: svg, x: e.clientX, y: e.clientY, v: Object.assign({}, ui.view), moved: false, target: e.target.closest('[data-t]') };
    });
    document.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      drag.svg.classList.add('dragging');
      var ctm = drag.svg.getScreenCTM(), k = 1 / ctm.a;
      ui.view = { x: drag.v.x - dx * k, y: drag.v.y - dy * k, w: drag.v.w, h: drag.v.h };
      renderRotorSvg();
    });
    document.addEventListener('pointerup', function () {
      if (!drag) return;
      drag.svg.classList.remove('dragging');
      if (!drag.moved) {
        if (drag.target) {
          var t = drag.target.getAttribute('data-t'), i = Number(drag.target.getAttribute('data-i'));
          if (ui.sheet !== t) { ui.sheet = t; document.querySelectorAll('#sheetTabs .tab').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-sheet') === t); }); renderSheet(); }
          selectRow(t, i, true);
        } else { ui.sel = { table: null, row: -1 }; selectRow(null, -1); }
      }
      drag = null;
    });
    document.addEventListener('dblclick', function (e) {
      if (e.target.closest && e.target.closest('#rotorSvg')) { fitView(); renderRotorSvg(); }
    });
    document.addEventListener('contextmenu', function (e) {
      var svg = e.target.closest && e.target.closest('#rotorSvg');
      if (!svg) return;
      e.preventDefault();
      var p = svgPoint(svg, e.clientX, e.clientY), node = nearestNode(p.x), tg = e.target.closest('[data-t]');
      var items = [];
      if (tg) {
        var t = tg.getAttribute('data-t'), i = Number(tg.getAttribute('data-i'));
        if (t === 'shaft') items.push({ head: 'Elemento ' + (i + 1) },
          { label: 'Inserir elemento antes', fn: function () { insertElement(i); after('shaft'); } },
          { label: 'Inserir elemento depois', fn: function () { insertElement(i + 1); after('shaft'); } },
          { label: 'Dividir em 2', fn: function () { splitElement(i, 2); after('shaft'); } },
          { label: 'Excluir elemento', fn: function () { if (deleteElement(i)) after('shaft'); } }, { sep: 1 });
        if (t === 'disks') items.push({ head: state.disks[i].name }, { label: 'Excluir massa', fn: function () { state.disks.splice(i, 1); after('disks'); } }, { sep: 1 });
        if (t === 'bearings') items.push({ head: state.bearings[i].name }, { label: 'Excluir mancal', fn: function () { state.bearings.splice(i, 1); after('bearings'); } }, { sep: 1 });
      }
      items.push({ label: 'Adicionar massa no nó ' + node, fn: function () { addDisk(node); } },
                 { label: 'Disco por geometria no nó ' + node + '…', fn: function () { dialogDiskGeom(node); } },
                 { label: 'Fileira de palhetas no nó ' + node + '…', fn: function () { dialogBlades(node); } },
                 { label: 'Adicionar mancal no nó ' + node, fn: function () { addBearing(node); } },
                 { sep: 1 }, { label: 'Ajustar vista', fn: function () { fitView(); renderRotorSvg(); } });
      showMenu(e.clientX, e.clientY, items);
    });
    function after(t) { ui.view = null; showSheet(t); commit(); }
  }
  function showSheet(t) {
    ui.sheet = t;
    document.querySelectorAll('#sheetTabs .tab').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-sheet') === t); });
    renderSheet();
  }
  function addDisk(node) {
    var r = E.blankRow('disks'); r.node = node; r.name = 'Massa ' + (state.disks.length + 1);
    state.disks.push(r); showSheet('disks'); commit(); selectRow('disks', state.disks.length - 1, true);
  }
  function addBearing(node) {
    var r = E.blankRow('bearings'); r.node = node; r.name = 'M' + (state.bearings.length + 1);
    state.bearings.push(r); showSheet('bearings'); commit(); selectRow('bearings', state.bearings.length - 1, true);
  }

  // ---- menu de contexto ------------------------------------------------- //
  function closeMenu() { var m = document.querySelector('.ctx-menu'); if (m) m.remove(); }
  function showMenu(x, y, items) {
    closeMenu();
    var m = document.createElement('div');
    m.className = 'ctx-menu';
    items.forEach(function (it) {
      var d;
      if (it.sep) d = document.createElement('hr');
      else if (it.head) { d = document.createElement('div'); d.className = 'head'; d.textContent = it.head; }
      else { d = document.createElement('div'); d.className = 'item'; d.textContent = it.label; d.onclick = function () { closeMenu(); it.fn(); }; }
      m.appendChild(d);
    });
    document.body.appendChild(m);
    var r = m.getBoundingClientRect();
    m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
    m.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
  }

  // ---- diálogos --------------------------------------------------------- //

  // Diálogo genérico no modal fixo #dlg-overlay (mesma aparência do navegador de arquivos)
  function showDialog(title, fields, onOk, note) {
    var ov = $('dlg-overlay');
    $('dlg-title').textContent = title;
    $('dlg-msg').textContent = '';
    $('dlg-body').innerHTML = fields.map(function (f, i) {
      var inp = f.options
        ? '<select data-k="' + f.key + '">' + f.options.map(function (o) { return '<option' + (o === f.value ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>'
        : '<input type="text" data-k="' + f.key + '" value="' + esc(f.text ? f.value : fmtCell(f.value)) + '">';
      return (i % 2 === 0 ? '<div class="row">' : '') + '<div><label>' + esc(f.label) + '</label>' + inp + '</div>' +
             (i % 2 === 1 || i === fields.length - 1 ? '</div>' : '');
    }).join('') + (note ? '<div class="hint">' + esc(note) + '</div>' : '');
    ov.classList.add('open');
    var first = ov.querySelector('#dlg-body input,#dlg-body select'); if (first) first.focus();
    function close() { ov.classList.remove('open'); ov.onclick = null; ov.onkeydown = null; }
    function ok() {
      var vals = {}, bad = null;
      fields.forEach(function (f) {
        var el = ov.querySelector('[data-k="' + f.key + '"]');
        if (f.text || f.options) vals[f.key] = el.value;
        else { var v = parseNum(el.value); if (v === null || isNaN(v)) bad = bad || f.label; vals[f.key] = v; }
      });
      if (bad) { $('dlg-msg').textContent = 'Valor inválido: ' + bad; return; }
      var msg = onOk(vals);
      if (typeof msg === 'string') { $('dlg-msg').textContent = msg; return; }
      close();
    }
    ov.onclick = function (e) {
      if (e.target === ov || e.target.id === 'dlg-close' || e.target.id === 'dlg-cancel') close();
      else if (e.target.id === 'dlg-ok') ok();
    };
    ov.onkeydown = function (e) { if (e.key === 'Enter') ok(); if (e.key === 'Escape') close(); };
  }
  function nodeOk(n) { return n >= 1 && n <= state.shaft.length + 1 && Math.round(n) === n; }
  function dialogDiskGeom(node) {
    showDialog('Disco / impelidor por geometria', [
      { key: 'name', label: 'Nome', value: 'Disco ' + (state.disks.length + 1), text: true },
      { key: 'node', label: 'Nó', value: node || 1 },
      { key: 'w', label: 'Largura [mm]', value: 50 }, { key: 'od', label: 'Diâmetro externo [mm]', value: 300 },
      { key: 'id', label: 'Diâmetro interno [mm]', value: 100 },
      { key: 'mat', label: 'Material', value: 'Aço', options: Object.keys(E.MATERIALS) }
    ], function (v) {
      if (!nodeOk(v.node)) return 'Nó inexistente (1–' + (state.shaft.length + 1) + ').';
      if (!(v.od > v.id && v.w > 0)) return 'Geometria inválida.';
      var d = E.diskFromGeometry(v.w / 1e3, v.od / 1e3, v.id / 1e3, v.mat), r = E.blankRow('disks');
      Object.assign(r, { name: v.name, node: v.node, m: +d.m.toFixed(4), Ip: +d.Ip.toFixed(6), Id: +d.Id.toFixed(6) });
      state.disks.push(r); showSheet('disks'); commit(); selectRow('disks', state.disks.length - 1, true);
    }, 'Disco sólido de faces paralelas: m = ρ·π(R²−r²)·b, Ip = m(R²+r²)/2, Id = m[3(R²+r²)+b²]/12.');
  }
  function dialogBlades(node) {
    showDialog('Fileira de palhetas', [
      { key: 'name', label: 'Nome', value: 'Palhetas', text: true }, { key: 'node', label: 'Nó', value: node || 1 },
      { key: 'n', label: 'Nº de palhetas', value: 40 }, { key: 'mb', label: 'Massa por palheta [kg]', value: 0.1 },
      { key: 'rr', label: 'Raio da raiz [mm]', value: 150 }, { key: 'rt', label: 'Raio da ponta [mm]', value: 250 },
      { key: 'hm', label: 'Massa do disco/cubo [kg]', value: 0 }, { key: 'hip', label: 'Ip do disco/cubo [kg·m²]', value: 0 }
    ], function (v) {
      if (!nodeOk(v.node)) return 'Nó inexistente (1–' + (state.shaft.length + 1) + ').';
      if (!(v.rt > v.rr && v.n >= 1 && v.mb > 0)) return 'Dados inválidos (raio da ponta deve ser maior que o da raiz).';
      var hub = v.hm > 0 ? { m: v.hm, Ip: v.hip, Id: v.hip / 2 } : null;
      var d = E.bladeRow(Math.round(v.n), v.mb, v.rr / 1e3, v.rt / 1e3, hub), r = E.blankRow('disks');
      Object.assign(r, { name: v.name, node: v.node, m: +d.m.toFixed(4), Ip: +d.Ip.toFixed(6), Id: +d.Id.toFixed(6) });
      state.disks.push(r); showSheet('disks'); commit(); selectRow('disks', state.disks.length - 1, true);
    }, 'Palhetas como anel rígido (barras radiais uniformes); a flexibilidade própria das palhetas não entra na análise lateral.');
  }

  // ======================================================================= //
  // Ferramentas da barra do modelo
  // ======================================================================= //
  function onTool(t) {
    var s = ui.sel;
    if (t === 'addEl') { var i = s.table === 'shaft' && s.row >= 0 ? s.row + 1 : state.shaft.length; insertElement(i); ui.view = null; showSheet('shaft'); commit(); selectRow('shaft', i, true); }
    else if (t === 'split') { if (s.table === 'shaft' && s.row >= 0) { splitElement(s.row, 2); ui.view = null; showSheet('shaft'); commit(); } else toast('Selecione um elemento do eixo para dividir.', 'info'); }
    else if (t === 'addDisk') addDisk(s.table === 'shaft' && s.row >= 0 ? s.row + 1 : 1);
    else if (t === 'diskGeom') dialogDiskGeom(s.table === 'shaft' && s.row >= 0 ? s.row + 1 : 1);
    else if (t === 'blades') dialogBlades(s.table === 'shaft' && s.row >= 0 ? s.row + 1 : 1);
    else if (t === 'addBrg') addBearing(s.table === 'shaft' && s.row >= 0 ? s.row + 1 : 1);
    else if (t === 'delRow') {
      var tb = s.table || ui.sheet, r = s.table ? s.row : -1;
      if (r < 0) { toast('Selecione uma linha (clique no número da linha ou no desenho).', 'info'); return; }
      if (deleteRow(tb, r)) { ui.sel = { table: null, row: -1 }; ui.view = null; showSheet(tb); commit(); }
    }
    else if (t === 'undo') undo();
    else if (t === 'redo') redo();
    else if (t === 'fit') { fitView(); renderRotorSvg(); }
  }

  // ======================================================================= //
  // Cálculo (Engine.Job em fatias de ~40 ms, com progresso e Parar)
  // ======================================================================= //
  function calculate() {
    if (ui.running || !state.shaft.length) return;
    ui.errors = E.validate(state);
    ui.calcMsg = null;
    if (ui.errors.length) { renderCalcBox(); return; }
    var job, t0 = Date.now(), key = analysisKey();
    try { job = new E.Job(clone(state), { tables: tablesCache }); }
    catch (e) { ui.errors = e.validation || [e.message]; renderCalcBox(); return; }
    ui.running = { job: job, stop: false, progress: 0, label: 'Iniciando' };
    renderCalcBox();
    (function tick() {
      var run = ui.running;
      if (!run) return;
      if (run.stop) { ui.running = null; renderCalcBox(); toast('Cálculo interrompido.', 'info'); return; }
      try {
        var st = job.step(40);
        run.progress = st.progress; run.label = st.label;
        if (st.done) {
          Object.assign(tablesCache, job.tables);
          ui.results = job.results; ui.resultsKey = key; ui.running = null; renderCalcBox();
          destroyCharts(); ui.rendered = {};
          toast('Cálculo concluído em ' + fN((Date.now() - t0) / 1000, 1) + ' s.' + (job.results.warnings.length ? ' Avisos: ' + job.results.warnings.join('; ') : ''), 'ok');
          updateStale();
          if (ui.tab === 'model') selectTab('campbell'); else renderPanel(ui.tab);
          return;
        }
        renderCalcBox();
        setTimeout(tick, 0);
      } catch (e) {
        ui.running = null; renderCalcBox();
        toast('Erro no cálculo: ' + e.message, 'err');
      }
    })();
  }

  // ======================================================================= //
  // Gráficos (Chart.js) — cores lidas dos tokens CSS na hora de desenhar
  // ======================================================================= //
  var SANS = "'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif";
  var MONO = "'IBM Plex Mono', ui-monospace, Consolas, monospace";
  // tokens do hub (mesmos nomes do PEVAL), lidos na hora de desenhar para seguir o tema
  function tok(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function palette() { return [tok('--blue'), tok('--amber'), tok('--brass'), tok('--green'), tok('--violet'), tok('--red'), '#C08A3E', '#8A9999']; }
  function destroyCharts() { Object.keys(ui.charts).forEach(function (k) { try { ui.charts[k].destroy(); } catch (e) { /* */ } }); ui.charts = {}; }
  function numTick(v) { return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 }); }
  function axis(title, extra) {
    return Object.assign({ type: 'linear', title: { display: !!title, text: title, color: tok('--ink-dim') },
      grid: { color: tok('--grid') }, border: { color: tok('--line') },
      ticks: { color: tok('--ink-dim'), callback: numTick, includeBounds: false, maxTicksLimit: 12 } }, extra || {});
  }
  function chart(id, cfg) {
    var cv = $(id);
    if (!cv) return null;
    if (ui.charts[id]) ui.charts[id].destroy();
    Chart.defaults.font.family = MONO; Chart.defaults.font.size = 11; Chart.defaults.color = tok('--ink-dim');
    cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
      interaction: { mode: 'nearest', intersect: false },
      plugins: { legend: { labels: { color: tok('--ink-dim'), boxWidth: 12, font: { family: SANS, size: 11 },
                                      filter: function (it) { return !!it.text; } } },
                 tooltip: { backgroundColor: tok('--bg-raised'), borderColor: tok('--line'), borderWidth: 1, titleColor: tok('--ink'), bodyColor: tok('--ink-dim'),
                            callbacks: { label: function (c) { return (c.dataset.label ? c.dataset.label + ': ' : '') + numTick(c.parsed.x) + ' ; ' + numTick(c.parsed.y); } } } }
    }, cfg.options || {});
    ui.charts[id] = new Chart(cv.getContext('2d'), cfg);
    return ui.charts[id];
  }
  function line(label, xs, ys, color, extra) {
    var data = [];
    xs.forEach(function (x, i) {
      // fase: interrompe a linha no salto ±180° em vez de desenhar um traço vertical
      if (extra && extra.wrap && i > 0 && Math.abs(ys[i] - ys[i - 1]) > 180) data.push({ x: x, y: null });
      data.push({ x: x, y: ys[i] });
    });
    if (extra) delete extra.wrap;
    return Object.assign({ label: label, data: data, spanGaps: false, borderColor: color, backgroundColor: color,
                           showLine: true, pointRadius: 0, borderWidth: 1.8 }, extra || {});
  }
  // Faixa de operação sombreada
  function bandPlugin(x0, x1) {
    return { id: 'opband', beforeDatasetsDraw: function (c) {
      var ar = c.chartArea, x = c.scales.x, p0 = Math.max(ar.left, x.getPixelForValue(x0)), p1 = Math.min(ar.right, x.getPixelForValue(x1));
      if (p1 <= p0) return;
      c.ctx.save(); c.ctx.fillStyle = 'rgba(111,169,122,.13)'; c.ctx.fillRect(p0, ar.top, p1 - p0, ar.bottom - ar.top); c.ctx.restore();
    } };
  }
  // Linhas verticais (mancais / massas nas formas modais)
  function vlinesPlugin(marks) {
    return { id: 'vlines', beforeDatasetsDraw: function (c) {
      var ar = c.chartArea, x = c.scales.x, ctx = c.ctx;
      ctx.save();
      marks.forEach(function (m) {
        var p = x.getPixelForValue(m.x);
        if (p < ar.left || p > ar.right) return;
        ctx.strokeStyle = m.color; ctx.setLineDash(m.dash || [4, 3]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(p, ar.top); ctx.lineTo(p, ar.bottom); ctx.stroke();
      });
      ctx.restore();
    } };
  }
  // Marca pontos com rótulo (ex.: flecha máxima): marks = [{x, y, text, color}]
  function markPlugin(marks) {
    return { id: 'marks', afterDatasetsDraw: function (c) {
      var ctx = c.ctx, xs = c.scales.x, ys = c.scales.y, ar = c.chartArea;
      ctx.save();
      marks.forEach(function (m, k) {
        var px = xs.getPixelForValue(m.x), py = ys.getPixelForValue(m.y);
        ctx.strokeStyle = m.color; ctx.fillStyle = m.color; ctx.lineWidth = 1.5; ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(px, py, 5, 0, 2 * Math.PI); ctx.stroke();
        ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, ar.bottom); ctx.stroke(); ctx.setLineDash([]);
        ctx.font = '600 12px ' + SANS;
        var w = ctx.measureText(m.text).width, tx = Math.min(Math.max(px - w / 2, ar.left + 4), ar.right - w - 4), ty = py + 22 + 18 * k;
        if (ty > ar.bottom - 6) ty = py - 12 - 18 * k;
        ctx.fillStyle = tok('--bg-panel'); ctx.fillRect(tx - 4, ty - 13, w + 8, 18);
        ctx.fillStyle = m.color; ctx.fillText(m.text, tx, ty);
      });
      ctx.restore();
    } };
  }
  function scatterCfg(datasets, xTitle, yTitle, extra) {
    extra = extra || {};
    return { type: 'scatter', data: { datasets: datasets }, plugins: extra.plugins || [],
             options: { scales: { x: axis(xTitle, extra.x), y: axis(yTitle, extra.y) } } };
  }
  // Blocos de marcação no padrão do PEVAL
  function chartBox(id, title, desc, cls) {
    return '<div class="chart-box"><h3>' + title + '</h3>' + (desc ? '<p class="desc">' + desc + '</p>' : '') +
           '<div class="chart-wrap' + (cls ? ' ' + cls : '') + '"><canvas id="' + id + '"></canvas></div></div>';
  }
  function statCard(label, value, unit) {
    return '<div class="stat-card"><div class="label">' + label + '</div><div class="value">' + value + (unit ? '<span class="unit">' + unit + '</span>' : '') + '</div></div>';
  }
  function tableBox(title, desc, head, rows, maxH) {
    return '<div class="chart-box"><h3>' + title + '</h3>' + (desc ? '<p class="desc">' + desc + '</p>' : '') +
      '<div class="table-scroll"' + (maxH ? ' style="max-height:' + maxH + 'px"' : '') + '><table><thead><tr>' +
      head.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div></div>';
  }
  function tr(cells) { return '<tr>' + cells.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }

  // ======================================================================= //
  // Painéis de resultado
  // ======================================================================= //
  function renderPanel(t) {
    var el = $('res-' + t);
    if (!el) return;
    var R = ui.results;
    if (!R) {
      el.innerHTML = '<div class="notice" style="text-align:center;padding:40px 20px;">Revise o modelo na aba <strong>Modelo</strong> e clique em <strong>Calcular</strong>.</div>';
      return;
    }
    if (ui.rendered[t]) return;
    ui.rendered[t] = true;
    ({ deflection: panelDeflection, oil: panelOil, bearings: panelBearings, campbell: panelCampbell, modes: panelModes, unbalance: panelUnbalance,
       stability: panelStability, report: panelReport })[t](el, R);
  }
  function tagWhirl(w) { return '<span class="tag ' + w + '">' + ({ F: 'Forward', B: 'Backward', M: 'Misto' }[w] || w) + '</span>'; }
  function tagOk(ok, txtOk, txtBad) { return ok === null || ok === undefined ? '<span class="tag neutral">—</span>' : '<span class="tag ' + (ok ? 'ok' : 'bad') + '">' + (ok ? (txtOk || 'Atende') : (txtBad || 'Não atende')) + '</span>'; }
  function a_() { return Object.assign({}, E.DEFAULT_ANALYSIS, state.analysis); }

  function panelDeflection(el, R) {
    var D = R.deflection, h = [], mr = D.maxRigid, mt = D.maxTotal;
    var maxSlope = 0; D.bearings.forEach(function (b) { maxSlope = Math.max(maxSlope, Math.abs(b.slopeTotal)); });
    h.push('<div class="card-grid">' +
      statCard('Flecha máx. do eixo (apoios rígidos)', fN(mr.value, 2), 'µm') +
      statCard('Posição da flecha máx.', fN(mr.z, 0), 'mm · nó ' + mr.node) +
      statCard('Flecha máx. da linha de centro', fN(mt.value, 2), 'µm') +
      statCard('Inclinação máx. nos mancais', fN(maxSlope, 3), 'mrad') + '</div>');
    h.push(chartBox('cDefl', 'Linha elástica sob peso próprio',
      'Deslocamento vertical ao longo do rotor (negativo = para baixo). <b>Eixo sobre apoios rígidos</b>: flecha do eixo por flexão. ' +
      '<b>Linha de centro real</b>: inclui a posição de equilíbrio do munhão em cada mancal em ' + fN(D.rpm, 0) + ' rpm ' +
      '(hidrodinâmico: excentricidade ε·C na direção da atitude; constante: W/k<sub>yy</sub>). Verde: mancais; laranja: massas.', 'tall'));
    h.push(tableBox('Mancais — reações e posição do munhão', 'Inclinação do eixo no mancal: indica o desalinhamento que o mancal precisa acomodar.',
      ['Mancal', 'Nó', 'z (mm)', 'Reação (N)', 'Δy munhão (µm)', 'Δx munhão (µm)', 'ε', 'Atitude (°)', 'Inclinação apoio rígido (mrad)', 'Inclinação real (mrad)'],
      D.bearings.map(function (b) {
        return tr([esc(b.name), b.node, fN(b.z, 1), fN(b.load, 0), fN(b.dy, 2), fN(b.dx, 2), b.eps === undefined ? '—' : fN(b.eps, 3),
                   b.att === undefined ? '—' : fN(b.att, 1), fN(b.slopeRigid, 4), fN(b.slopeTotal, 4)]);
      })));
    h.push('<div class="hint">Flecha máxima do eixo ' + mr.where + '; da linha de centro ' + mt.where + '. Cargas: peso próprio do eixo e das massas (g = 9,80665 m/s²).</div>');
    el.innerHTML = h.join('');
    var marks = [];
    state.bearings.forEach(function (b) { if (D.nodesZ[b.node - 1] !== undefined) marks.push({ x: D.nodesZ[b.node - 1], color: tok('--green') }); });
    state.disks.forEach(function (d) { if (D.nodesZ[d.node - 1] !== undefined) marks.push({ x: D.nodesZ[d.node - 1], color: tok('--amber'), dash: [2, 3] }); });
    var ymin = Math.min(Math.min.apply(null, D.rigid), Math.min.apply(null, D.total)), ymax = Math.max(0, Math.max.apply(null, D.rigid), Math.max.apply(null, D.total));
    chart('cDefl', scatterCfg([
      line('Eixo sobre apoios rígidos', D.z, D.rigid, tok('--blue'), { borderWidth: 2.2 }),
      line('Linha de centro real (munhão no filme)', D.z, D.total, tok('--amber'), { borderWidth: 2, borderDash: [6, 3] }),
      line('', [D.z[0], D.z[D.z.length - 1]], [0, 0], tok('--ink-faint'), { borderWidth: 1 }),
      { label: 'Mancais', data: D.bearings.map(function (b) { return { x: b.z, y: 0 }; }), pointStyle: 'triangle', pointRadius: 8, backgroundColor: tok('--green'), borderColor: tok('--green') }
    ], 'Posição axial (mm)', 'Deslocamento vertical (µm)', {
      plugins: [vlinesPlugin(marks), markPlugin([
        { x: mr.z, y: -mr.value, color: tok('--blue'), text: 'Flecha máx. eixo: ' + fN(mr.value, 2) + ' µm em ' + fN(mr.z, 0) + ' mm' },
        { x: mt.z, y: -mt.value, color: tok('--amber'), text: 'Linha de centro: ' + fN(mt.value, 2) + ' µm em ' + fN(mt.z, 0) + ' mm' }])],
      y: { min: ymin * 1.45, max: ymax + Math.abs(ymin) * 0.15 } }));
  }

  function panelOil(el, R) {
    var a = a_(), h = [], B = R.bearings || [], S = R.sensitivity;
    if (!B.length) {
      el.innerHTML = '<div class="notice info">Nenhum mancal hidrodinâmico no modelo: folga e viscosidade do óleo não se aplicam a mancais de coeficientes constantes.</div>';
      return;
    }
    h.push(tableBox('Balanço térmico e vazão de óleo em ' + fN(a.op_max, 0) + ' rpm',
      'Térmica calculada: ΔT tal que perda por atrito = ρ·c<sub>p</sub>·Q·ΔT (atrito também na região cavitada — conservador); T efetiva = T entrada + k·ΔT (k = ' + fN(Number(a.k_mix), 2) + '). ' +
      'Vazão de alimentação = soma das entradas nas bordas de ataque das sapatas/lobos (360° sem ranhura: vazamento lateral). Térmica informada: ΔT e vazão apenas estimados.',
      ['Mancal', 'Térmica', 'T entrada (°C)', 'ΔT (°C)', 'T efetiva (°C)', 'T saída (°C)', 'μ (mPa·s)', 'Perda (kW)', 'Vazão alim. (L/min)', 'Vaz. lateral (L/min)', 'T munhão (°C)', 'T mancal (°C)'],
      B.map(function (b) {
        var o = b.op;
        return tr([esc(b.name), b.calc ? 'calculada' : 'informada', b.calc ? fN(o.Tin, 1) : '—', fN(o.dT, 1), fN(o.Tef, 1), b.calc ? fN(o.Tout, 1) : '—',
                   fN(o.mu * 1e3, 2), fN(o.power / 1000, 2), fN(o.Qsup * 6e4, 2), fN(o.Qs * 6e4, 2), fN(o.Tj, 1), fN(o.Th, 1)]);
      })));
    h.push('<div class="chart-grid">' +
      chartBox('cThT', 'Temperaturas × rotação', 'T efetiva (contínua) e T de saída (tracejada) de cada mancal.', 'sm') +
      chartBox('cThQ', 'Vazão e perda de potência × rotação', 'Vazão de alimentação (contínua, L/min) e perda por atrito (tracejada, eixo direito, kW).', 'sm') + '</div>');
    h.push(tableBox('Folga radial: a frio × a quente',
      'C<sub>quente</sub> = C<sub>frio</sub> + R·α<sub>mancal</sub>·(T<sub>mancal</sub> − T<sub>mont</sub>) − R·α<sub>eixo</sub>·(T<sub>munhão</sub> − T<sub>mont</sub>). ' +
      'Munhão mais quente que o mancal <b>reduz</b> a folga. A análise dinâmica usa a folga a quente.',
      ['Mancal', 'Folga a frio (µm)', 'T mont. (°C)', 'T mancal (°C)', 'α mancal', 'ΔR mancal (µm)', 'T munhão (°C)', 'α eixo', 'ΔR munhão (µm)', 'Folga a quente (µm)', 'Variação', 'Exc. furo (µm)', 'm a frio', 'm operação'],
      B.map(function (b) {
        var t = b.thermal, dv = 100 * (t.hot - t.cold) / t.cold, o = b.op;
        return tr([esc(b.name), fN(t.cold, 1), fN(t.Tm, 0), fN(t.Th, 1), fN(t.ab, 1), (t.dRb >= 0 ? '+' : '') + fN(t.dRb, 2), fN(t.Tj, 1), fN(t.aj, 1),
                   (t.dRj >= 0 ? '+' : '') + fN(t.dRj, 2), fN(t.hot, 1) + (t.given ? ' (inf.)' : ''), (dv >= 0 ? '+' : '') + fN(dv, 1) + ' %',
                   o.eBore === null ? '—' : fN(o.eBore, 1), fN(o.mCold, 3), fN(o.m, 3)]);
      })));
    h.push(tableBox('Influência da folga a frio × a quente em ' + fN(a.op_max, 0) + ' rpm',
      'Mesmos mancais, óleo na temperatura efetiva, com a folga de montagem e com a folga de operação.',
      ['Mancal', 'Condição', 'Folga (µm)', 'S', 'ε', 'h<sub>mín</sub> (µm)', 'k<sub>xx</sub> (N/m)', 'k<sub>yy</sub> (N/m)', 'c<sub>xx</sub> (N·s/m)', 'c<sub>yy</sub> (N·s/m)'],
      [].concat.apply([], B.map(function (b) {
        var r2 = function (lab, cr, o) { return tr([esc(b.name), lab, fN(cr, 1), fN(o.S, 4), fN(o.eps, 3), fN(o.hmin_um, 1), fE(o.Kdim[0][0], 3), fE(o.Kdim[1][1], 3), fE(o.Cdim[0][0], 3), fE(o.Cdim[1][1], 3)]); };
        return [r2('a frio', b.thermal.cold, b.opCold), r2('a quente', b.thermal.hot, b.op)];
      }))));
    if (S && S.cold && S.hot) {
      var c = S.cold, q = S.hot, crit = function (o) { return S.hasCrit ? (isFinite(o.crit) ? fN(o.crit, 0) : 'não identificada') : '—'; };
      h.push(tableBox('Efeito na dinâmica do rotor', 'Recalculado com todos os mancais em cada condição.',
        ['Condição', '1º modo forward na MCS (cpm)', 'log dec do 1º forward', 'Menor log dec', '1ª crítica (rpm)'],
        [tr(['Folga a frio', fN(c.f1, 0), fN(c.ld1, 3), fN(c.ldmin, 3), crit(c)]), tr(['Folga a quente', fN(q.f1, 0), fN(q.ld1, 3), fN(q.ldmin, 3), crit(q)])]));
    }
    h.push(chartBox('cVisc', 'Viscosidade dos óleos × temperatura',
      'Viscosidade dinâmica pela equação de Walther (ASTM D341) com ν<sub>40</sub> = grau ISO VG e ν<sub>100</sub> típico de óleo mineral (IV ≈ 95–100). ' +
      'Pontos: óleo e temperatura efetiva de cada mancal.', ''));
    if (S) {
      h.push('<div class="chart-grid">' +
        chartBox('cSensT1', 'Temperatura do óleo × dinâmica', 'Variação da T de entrada do óleo (térmica calculada) ou da T efetiva (informada), ± ' + fN(S.dT, 0) + ' °C, em todos os mancais. Esquerda: frequências; direita: log dec.', 'sm') +
        chartBox('cSensC1', 'Folga × dinâmica', 'Variação da folga de fabricação (a frio), ± ' + fN(S.dC, 0) + ' %, em todos os mancais; a folga a quente e a pré-carga são recalculadas.', 'sm') +
        chartBox('cSensT2', 'Temperatura do óleo × mancais', 'k<sub>yy</sub> (contínua) e c<sub>yy</sub> (tracejada, eixo direito) na MCS.', 'sm') +
        chartBox('cSensC2', 'Folga × espessura mínima de filme', 'h<sub>mín</sub> na MCS versus variação da folga (contínua) e da temperatura (tracejada, eixo superior).', 'sm') + '</div>');
      h.push('<div class="hint">A API 684 recomenda avaliar a dinâmica nos extremos de folga e de temperatura do óleo (folga mínima com óleo frio, folga máxima com óleo quente). ' +
             'Use as variações da barra lateral para cobrir a tolerância de fabricação da folga e a faixa de temperatura de entrada do óleo.</div>');
    }
    el.innerHTML = h.join('');
    // viscosidade
    var P = palette(), Ts = []; for (var t = 20; t <= 120; t += 2) Ts.push(t);
    var dsV = E.OILS.map(function (o, i) {
      var used = B.some(function (b) { return b.oil === o; });
      return line(o, Ts, Ts.map(function (T) { return 1000 * E.fluid.oilViscosity(o, T); }), P[i % P.length], { borderWidth: used ? 2.6 : 1.1, borderDash: used ? [] : [4, 3] });
    });
    dsV.push({ label: 'Mancais (T efetiva)', data: B.map(function (b) { return { x: b.thermal.Tef, y: b.mu * 1000 }; }), pointRadius: 7, pointStyle: 'rectRot', backgroundColor: tok('--brass'), borderColor: tok('--brass') });
    chart('cVisc', scatterCfg(dsV, 'Temperatura (°C)', 'Viscosidade dinâmica (mPa·s)', { y: { type: 'logarithmic', ticks: { color: tok('--ink-dim'), callback: numTick } } }));
    var dsTT = [], dsTQ = [], bandT = bandPlugin(a.op_min, a.op_max);
    B.forEach(function (b, k) {
      var col = P[k % P.length];
      dsTT.push(line(b.name + ' T efetiva', b.rpm, b.pts.map(function (q) { return q.Tef; }), col));
      if (b.calc) dsTT.push(line(b.name + ' T saída', b.rpm, b.pts.map(function (q) { return q.Tout; }), col, { borderDash: [5, 3] }));
      dsTQ.push(line(b.name + ' vazão', b.rpm, b.pts.map(function (q) { return q.Qsup * 6e4; }), col));
      dsTQ.push(line(b.name + ' perda', b.rpm, b.pts.map(function (q) { return q.power / 1000; }), col, { borderDash: [5, 3], yAxisID: 'y1' }));
    });
    chart('cThT', scatterCfg(dsTT, 'Rotação (rpm)', 'Temperatura (°C)', { plugins: [bandT], x: { min: 0, max: a.speed_max } }));
    var cQ = scatterCfg(dsTQ, 'Rotação (rpm)', 'Vazão (L/min)', { plugins: [bandT], x: { min: 0, max: a.speed_max }, y: { min: 0 } });
    cQ.options.scales.y1 = axis('Perda (kW)', { position: 'right', grid: { drawOnChartArea: false }, min: 0 });
    chart('cThQ', cQ);
    if (!S) return;
    var xT = S.T.map(function (o) { return o.v; }), xC = S.C.map(function (o) { return o.v; });
    // (curvas × rotação desenhadas antes do retorno antecipado — ver thermoCharts)
    var y1 = function (title) { return axis(title, { position: 'right', grid: { drawOnChartArea: false } }); };
    function dynCfg(src, xs, xTitle) {
      var ds = [line('1º modo forward na MCS (cpm)', xs, src.map(function (o) { return o.f1; }), tok('--blue'), { pointRadius: 3 })];
      if (S.hasCrit) ds.push(line('1ª crítica (rpm)', xs, src.map(function (o) { return isFinite(o.crit) ? o.crit : null; }), tok('--amber'), { pointRadius: 3 }));
      ds.push(line('log dec 1º forward', xs, src.map(function (o) { return o.ld1; }), tok('--green'), { pointRadius: 3, borderDash: [5, 3], yAxisID: 'y1' }));
      var cfg = scatterCfg(ds, xTitle, 'cpm / rpm', { plugins: [vlinesPlugin([{ x: 0, color: tok('--ink-faint') }])] });
      cfg.options.scales.y1 = y1('log dec');
      return cfg;
    }
    chart('cSensT1', dynCfg(S.T, xT, 'Variação da temperatura do óleo (°C)'));
    chart('cSensC1', dynCfg(S.C, xC, 'Variação da folga de fabricação (%)'));
    var dsK = [], dsH = [];
    B.forEach(function (b, k) {
      var col = P[k % P.length];
      dsK.push(line(b.name + ' kyy', xT, S.T.map(function (o) { return o.brg[k].kyy; }), col, { pointRadius: 3 }));
      dsK.push(line(b.name + ' cyy', xT, S.T.map(function (o) { return o.brg[k].cyy; }), col, { pointRadius: 3, borderDash: [5, 3], yAxisID: 'y1' }));
      dsH.push(line(b.name + ' — folga', xC, S.C.map(function (o) { return o.brg[k].hmin; }), col, { pointRadius: 3 }));
      dsH.push(line(b.name + ' — temperatura', xT, S.T.map(function (o) { return o.brg[k].hmin; }), col, { pointRadius: 3, borderDash: [5, 3], xAxisID: 'x1' }));
    });
    var cK = scatterCfg(dsK, 'Variação da T do óleo (°C)', 'k<sub>yy</sub> (N/m)'.replace(/<\/?sub>/g, ''));
    cK.options.scales.y1 = y1('cyy (N·s/m)');
    chart('cSensT2', cK);
    var cH = scatterCfg(dsH, 'Variação da folga de fabricação (%)', 'h mín (µm)');
    cH.options.scales.x1 = axis('Variação da temperatura (°C)', { position: 'top', grid: { drawOnChartArea: false } });
    chart('cSensC2', cH);
  }

  function panelBearings(el, R) {
    var h = [], a = a_();
    h.push(tableBox('Coeficientes dos mancais em ' + fN(a.op_max, 0) + ' rpm', 'Rigidez em N/m, amortecimento em N·s/m. Carga estática pelo peso próprio (reações com apoios rígidos).',
      ['Mancal', 'Tipo', 'Nó', 'Carga (N)', 'k<sub>xx</sub>', 'k<sub>xy</sub>', 'k<sub>yx</sub>', 'k<sub>yy</sub>', 'c<sub>xx</sub>', 'c<sub>xy</sub>', 'c<sub>yx</sub>', 'c<sub>yy</sub>'],
      R.summary.bearings.map(function (b) {
        return tr([esc(b.name), esc(b.type), b.node, fN(b.load, 0)].concat([b.K[0][0], b.K[0][1], b.K[1][0], b.K[1][1], b.C[0][0], b.C[0][1], b.C[1][0], b.C[1][1]].map(function (v) { return fE(v, 3); })));
      })));
    if (!R.bearings || !R.bearings.length) {
      h.push('<div class="notice info">Nenhum mancal hidrodinâmico no modelo: todos os coeficientes são constantes, informados na tabela de mancais.</div>');
      el.innerHTML = h.join(''); return;
    }
    h.push(tableBox('Mancais hidrodinâmicos — ponto de operação (' + fN(a.op_max, 0) + ' rpm)',
      'Equação de Reynolds isotérmica (temperatura efetiva informada) com cavitação pela condição de Reynolds; coeficientes interpolados pelo número de Sommerfeld. Tilting pad: coeficientes síncronos, pivô rígido.',
      ['Mancal', 'Tipo', 'μ (mPa·s)', 'W/(L·D) (MPa)', 'Sommerfeld S', 'ε', 'Atitude (°)', 'h<sub>mín</sub> (µm)', 'Faixa de S tabelada'],
      R.bearings.map(function (b) {
        var o = b.op;
        return tr([esc(b.name), esc(b.type), fN(b.mu * 1e3, 2), fN(b.pspec, 3), fN(o.S, 4), fN(o.eps, 3), fN(o.att, 1), fN(o.hmin_um, 1), fN(b.Srange[0], 3) + ' – ' + fN(b.Srange[1], 2)]);
      })));
    R.bearings.forEach(function (b) {
      if (b.belowUpTo !== null) h.push('<div class="notice"><strong>' + esc(b.name) + ':</strong> até ' + fN(b.belowUpTo, 0) + ' rpm o número de Sommerfeld fica abaixo do mínimo tabelado (ε > ' + fN(b.epsMax, 2) + '); o valor extremo da tabela é mantido.</div>');
      if (b.aboveFrom !== null) h.push('<div class="notice"><strong>' + esc(b.name) + ':</strong> a partir de ' + fN(b.aboveFrom, 0) + ' rpm o número de Sommerfeld fica acima do máximo tabelado; o valor extremo é mantido.</div>');
    });
    h.push('<div class="chart-grid">' + chartBox('cb1', 'Rigidez direta', 'k<sub>xx</sub> (contínua) e k<sub>yy</sub> (tracejada) em N/m', 'sm') +
      chartBox('cb2', 'Rigidez cruzada', 'k<sub>xy</sub> (contínua) e k<sub>yx</sub> (tracejada) em N/m', 'sm') +
      chartBox('cb3', 'Amortecimento direto', 'c<sub>xx</sub> (contínua) e c<sub>yy</sub> (tracejada) em N·s/m', 'sm') +
      chartBox('cb4', 'Espessura mínima de filme', 'h<sub>mín</sub> em µm', 'sm') + '</div>');
    el.innerHTML = h.join('');
    var P = palette(), band = bandPlugin(a.op_min, a.op_max), ds = [[], [], [], []];
    R.bearings.forEach(function (b, k) {
      var c1 = P[(2 * k) % P.length], c2 = P[(2 * k + 1) % P.length], g = function (f) { return b.pts.map(f); };
      ds[0].push(line(b.name + ' kxx', b.rpm, g(function (p) { return p.Kdim[0][0]; }), c1), line(b.name + ' kyy', b.rpm, g(function (p) { return p.Kdim[1][1]; }), c2, { borderDash: [5, 3] }));
      ds[1].push(line(b.name + ' kxy', b.rpm, g(function (p) { return p.Kdim[0][1]; }), c1), line(b.name + ' kyx', b.rpm, g(function (p) { return p.Kdim[1][0]; }), c2, { borderDash: [5, 3] }));
      ds[2].push(line(b.name + ' cxx', b.rpm, g(function (p) { return p.Cdim[0][0]; }), c1), line(b.name + ' cyy', b.rpm, g(function (p) { return p.Cdim[1][1]; }), c2, { borderDash: [5, 3] }));
      ds[3].push(line(b.name, b.rpm, g(function (p) { return p.hmin_um; }), c1));
    });
    ['cb1', 'cb2', 'cb3', 'cb4'].forEach(function (id, i) { chart(id, scatterCfg(ds[i], 'Rotação (rpm)', '', { plugins: [band], x: { min: 0, max: a.speed_max } })); });
  }

  function panelCampbell(el, R) {
    var C = R.campbell, a = a_(), h = [];
    var inRange = C.crit.filter(function (c) { return c.inRange; }).length;
    h.push('<div class="card-grid">' +
      statCard('Críticas na varredura', C.crit.length, 'modos forward') +
      statCard('1ª crítica', C.crit.length ? fN(C.crit[0].rpm, 0) : '—', C.crit.length ? 'rpm' : '') +
      statCard('Na faixa de operação', inRange, inRange ? '⚠' : '') +
      statCard('Faixa de operação', fN(a.op_min, 0) + '–' + fN(a.op_max, 0), 'rpm') + '</div>');
    h.push(chartBox('cCamp', 'Diagrama de Campbell', 'Frequências naturais amortecidas × rotação; azul = precessão forward, vermelho = backward. Faixa de operação sombreada; círculos = interseções com 1X. Modos com ζ > 0,5 (superamortecidos) ocultados.', 'tall'));
    if (!C.crit.length) h.push('<div class="notice ok">Nenhuma velocidade crítica na faixa analisada.</div>');
    else h.push(tableBox('Velocidades críticas', 'Interseções com a reta 1X nos ramos forward. Separação e fator de amplificação exigidos pela API 617 na aba Desbalanceamento.',
      ['Modo', 'Rotação (rpm)', 'log dec', 'Situação'],
      C.crit.map(function (c) { return tr([c.mode, fN(c.rpm, 0), fN(c.logdec, 3), c.inRange ? '<span class="tag bad">Dentro da faixa de operação</span>' : '<span class="tag ok">Fora da faixa</span>']); })));
    el.innerHTML = h.join('');
    var pts = { F: [], B: [], M: [] }, ymax = a.speed_max * 1.3;
    C.pts.forEach(function (p, i) { p.wd.forEach(function (w, j) { if (p.zeta[j] <= 0.5 && w <= ymax * 1.05) pts[p.whirl[j]].push({ x: C.rpm[i], y: w }); }); });
    var ds = [
      { label: 'Forward', data: pts.F, backgroundColor: tok('--blue'), pointRadius: 2.6 },
      { label: 'Backward', data: pts.B, backgroundColor: tok('--red'), pointRadius: 2.6 },
      { label: '1X', data: [{ x: 0, y: 0 }, { x: a.speed_max, y: a.speed_max }], showLine: true, borderColor: tok('--ink-dim'), borderDash: [6, 4], borderWidth: 1.2, pointRadius: 0 },
      { label: 'Críticas', data: C.crit.map(function (c) { return { x: c.rpm, y: c.rpm }; }), pointRadius: 8, pointBorderWidth: 2, borderColor: tok('--brass'), backgroundColor: 'transparent', pointStyle: 'circle' }
    ];
    if (pts.M.length) ds.splice(2, 0, { label: 'Misto', data: pts.M, backgroundColor: tok('--ink-faint'), pointRadius: 2.6 });
    chart('cCamp', scatterCfg(ds, 'Rotação (rpm)', 'Frequência natural amortecida (cpm)',
      { plugins: [bandPlugin(a.op_min, a.op_max)], x: { min: 0, max: a.speed_max }, y: { min: 0, max: ymax } }));
  }

  function panelModes(el, R) {
    var M = R.modes, h = [];
    h.push(tableBox('Modos em ' + fN(M.rpm, 0) + ' rpm', M.omitted ? M.omitted + ' modo(s) com ζ > 0,5 (superamortecidos) omitido(s).' : '',
      ['Modo', 'f<sub>d</sub> (Hz)', 'f<sub>d</sub> (cpm)', 'log dec', 'ζ', 'Precessão'],
      M.list.map(function (m, i) { return tr([i + 1, fN(m.hz, 2), fN(m.cpm, 0), fN(m.logdec, 3), fN(m.zeta, 4), tagWhirl(m.whirl)]); }), 300));
    var n = Math.min(6, M.list.length);
    h.push('<div class="chart-grid">');
    for (var i = 0; i < n; i++) {
      var m = M.list[i];
      h.push(chartBox('cMode' + i, 'Modo ' + (i + 1) + ': ' + fN(m.cpm, 0) + ' cpm (' + fN(m.hz, 1) + ' Hz)',
        ({ F: 'forward', B: 'backward', M: 'misto' }[m.whirl]) + ', δ = ' + fN(m.logdec, 3) + ' — verde: mancais, laranja: massas', 'sm'));
    }
    h.push('</div><div class="hint">Curvas normalizadas pelo maior semi-eixo da órbita; com mancais anisotrópicos o modo pode ser dominante no plano Y.</div>');
    el.innerHTML = h.join('');
    var zmm = M.z.map(function (v) { return v * 1000; }), marks = [];
    state.bearings.forEach(function (b) { if (zmm[b.node - 1] !== undefined) marks.push({ x: zmm[b.node - 1], color: tok('--green') }); });
    state.disks.forEach(function (d) { if (zmm[d.node - 1] !== undefined) marks.push({ x: zmm[d.node - 1], color: tok('--amber'), dash: [2, 3] }); });
    for (var k = 0; k < n; k++) {
      var mm = M.list[k];
      chart('cMode' + k, scatterCfg([
        line('Plano X', zmm, mm.X, tok('--blue'), { pointRadius: 2 }),
        line('Plano Y', zmm, mm.Y, tok('--amber'), { pointRadius: 2 }),
        line('Eixo maior da órbita', zmm, mm.env, tok('--ink-faint'), { borderDash: [3, 3], borderWidth: 1.2 }),
        line('', zmm, mm.env.map(function (v) { return -v; }), tok('--ink-faint'), { borderDash: [3, 3], borderWidth: 1.2 })
      ], 'Posição axial (mm)', '', { plugins: [vlinesPlugin(marks)], y: { min: -1.1, max: 1.1 } }));
    }
  }

  function panelUnbalance(el, R) {
    var U = R.unbalance, a = a_(), h = [];
    h.push('<div class="card-grid">' +
      statCard('ISO G' + esc(fmtCell(a.G)) + ' — U permissível', fN(U.iso.U_per_gmm, 1), 'g·mm') +
      statCard('Excentricidade permissível', fN(U.iso.e_per_um, 3), 'µm') +
      (U.alloc ? statCard('Planos A / B', fN(U.alloc.A, 1) + ' / ' + fN(U.alloc.B, 1), 'g·mm') : '') +
      statCard('API 617 — U<sub>a</sub> (nó ' + U.mid + ')', fN(U.Ua, 0), 'g·mm') + '</div>');
    h.push(chartBox('cAmp', 'Resposta ao desbalanceamento', 'Amplitude pico a pico (eixo maior da órbita) nas sondas. Contínuas: casos ISO 21940-11; tracejadas: API 617.', 'tall'));
    h.push(chartBox('cPh', 'Fase', 'Fase da componente x em relação ao desbalanceamento (°).', 'sm'));
    h.push(tableBox('Amplitudes nas sondas', 'Pico a pico, eixo maior da órbita.', ['Caso', 'Nó', 'Em ' + fN(a.op_max, 0) + ' rpm (µm)', 'Máxima (µm)', 'Na rotação (rpm)'],
      U.curves.map(function (c) { return tr([esc(c.name), c.node, fN(c.atMcs, 2), fN(c.max, 2), fN(c.rpmMax, 0)]); })));
    if (!U.checks.length) h.push('<div class="notice ok">Nenhum pico de ressonância na faixa analisada.</div>');
    else h.push(tableBox('API 617 — fator de amplificação e margem de separação',
      'SM requerida: abaixo da faixa min(16; 17·(1−1/(AF−1,5))) %, acima min(26; 10+17·(1−1/(AF−1,5))) %; AF < 2,5 dispensa margem. W = soma das cargas estáticas nos mancais.',
      ['Nó', 'Pico (rpm)', 'N1 (rpm)', 'N2 (rpm)', 'AF', 'SM real (%)', 'SM requerida (%)', 'Resultado'],
      U.checks.map(function (c) {
        return tr([c.node, fN(c.Nc, 0), fN(c.N1, 0), fN(c.N2, 0), fN(c.AF, 2), fN(c.SM, 1), fN(c.SMreq, 1),
          c.note ? '<span class="tag ' + (c.ok === false ? 'bad' : c.ok ? 'ok' : 'neutral') + '">' + esc(c.note) + '</span>' : tagOk(c.ok)]);
      })));
    el.innerHTML = h.join('');
    var P = palette(), dsA = [], dsP = [], band = bandPlugin(a.op_min, a.op_max);
    U.curves.forEach(function (c, i) {
      var col = P[i % P.length], ex = c.api ? { borderDash: [6, 3] } : {};
      dsA.push(line(c.name + ' – nó ' + c.node, U.rpm, c.amp, col, ex));
      dsP.push(line(c.name + ' – nó ' + c.node, U.rpm, c.phase, col, Object.assign({ borderWidth: 1.2, wrap: true }, ex)));
    });
    chart('cAmp', scatterCfg(dsA, 'Rotação (rpm)', 'Amplitude pk-pk (µm)', { plugins: [band], x: { min: 0, max: a.speed_max }, y: { min: 0 } }));
    var cp = chart('cPh', scatterCfg(dsP, 'Rotação (rpm)', 'Fase x (°)', { plugins: [band], x: { min: 0, max: a.speed_max }, y: { min: -180, max: 180 } }));
    cp.options.plugins.legend.display = false; cp.update();
  }

  function panelStability(el, R) {
    var S = R.stability, h = [];
    h.push('<div class="card-grid">' +
      statCard('log dec 1º forward (Q = 0)', fN(S.ld0, 3)) +
      statCard('Critério δ ≥ 0,1', tagOk(S.ok)) +
      statCard('Q para δ = 0,1 (nó ' + S.node + ')', S.Q01 === null ? '—' : fN(S.Q01 / 1e6, 2), S.Q01 === null ? '' : 'MN/m') +
      statCard('Limiar de instabilidade', S.Q0 === null ? '—' : fN(S.Q0 / 1e6, 2), S.Q0 === null ? '' : 'MN/m') + '</div>');
    h.push(chartBox('cStab', 'Mapa de estabilidade', 'Decremento logarítmico × rigidez cruzada aplicada no nó ' + S.node + ', em ' + fN(S.rpm, 0) +
      ' rpm. "—" nos limiares indica que δ não cruzou o valor na faixa de Q analisada (aumente Q máximo).', 'tall'));
    el.innerHTML = h.join('');
    var Qm = S.Q.map(function (q) { return q / 1e6; }), x1 = Qm[Qm.length - 1];
    chart('cStab', scatterCfg([
      line('1º modo forward', Qm, S.first, tok('--brass'), { pointRadius: 3, borderWidth: 2 }),
      line('Mínimo entre modos', Qm, S.min, tok('--blue'), { borderDash: [5, 3] }),
      line('Critério δ = 0,1', [0, x1], [0.1, 0.1], tok('--red'), { borderWidth: 1.2 }),
      line('δ = 0', [0, x1], [0, 0], tok('--ink-dim'), { borderWidth: 1 })
    ], 'Rigidez cruzada aplicada Q (MN/m)', 'Decremento logarítmico'));
  }

  function panelReport(el, R) {
    el.innerHTML = '<div class="download-row"><button class="btn btn-inline" id="btnCopyReport">Copiar relatório</button>' +
      '<button class="btn btn-inline" id="btnReportTxt">Exportar (.txt)</button></div><pre class="report" id="reportText"></pre>';
    $('reportText').textContent = R.report;
  }

  // ======================================================================= //
  // Projetos (API do hub) — buildProjectData / applyProjectData / navegador
  // ======================================================================= //
  function buildProjectData(name) {
    return { appId: APP_ID, version: 1,
             name: name || state.name || (ui.file ? ui.file.path.split('/').pop().replace(/\.json$/i, '') : 'projeto'),
             savedAt: new Date().toISOString(), state: clone(state) };
  }
  // Completa campos ausentes com os padrões do esquema: projetos antigos continuam abrindo
  function applyProjectData(data) {
    if (typeof data === 'string') data = JSON.parse(data);
    if (!data || !data.state) throw new Error('arquivo de projeto inválido');
    if (data.appId && data.appId !== APP_ID &&
        !confirm('Este arquivo foi salvo pelo app "' + data.appId + '", não pelo ROTORDIN. Tentar carregar mesmo assim?')) return null;
    var s0 = data.state, st = blankState();
    st.name = s0.name || '';
    ['shaft', 'disks', 'bearings'].forEach(function (t) {
      st[t] = (s0[t] || []).map(function (r) {
        var row = E.blankRow(t);
        Object.keys(row).forEach(function (key) { if (r[key] !== undefined) row[key] = r[key]; });
        if (t === 'bearings' && r.thermal === undefined) row.thermal = 'Informada';
        return row;
      });
    });
    st.analysis = Object.assign({}, E.DEFAULT_ANALYSIS, s0.analysis || {});
    return st;
  }
  function loadState(st, file) {
    state = st;
    ui.file = file || null;
    ui.results = null; ui.resultsKey = null; ui.errors = []; ui.calcMsg = null;
    ui.sel = { table: null, row: -1 }; ui.view = null; ui.tab = 'model'; ui.sheet = 'shaft';
    ui.savedKey = file ? stateKey() : JSON.stringify(blankState());
    resetHistory();
    renderAll();
  }

  // fetch com JSON; sessão expirada → tela de login do hub
  function api(method, url, body) {
    var opt = { method: method, headers: {} };
    if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    return fetch(url, opt).then(function (res) {
      if (res.status === 401) { window.location.href = '/login.html'; throw new Error('sessão expirada'); }
      return res.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
        if (!res.ok) { var err = new Error((data && (data.error || data.message)) || ('HTTP ' + res.status)); err.status = res.status; throw err; }
        return data;
      });
    });
  }

  // ---- navegador de arquivos (modal #fb-overlay, mesmo padrão do PEVAL) ---- //
  var fbMode = 'open', fbCurrentDir = '', fbSelected = null, fbNames = [];

  function fbList(dir) {
    $('fb-msg').textContent = '';
    return api('GET', '/api/browse?path=' + encodeURIComponent(dir)).then(function (data) {
      fbCurrentDir = data.path || '';
      fbSelected = null;
      renderBreadcrumb();
      var list = $('fb-list'), entries = data.entries || [];
      fbNames = entries.filter(function (e) { return !e.isDir; }).map(function (e) { return e.name; });
      if (!entries.length) { list.innerHTML = '<div class="modal-row" style="color:var(--ink-faint);cursor:default;">— pasta vazia —</div>'; return; }
      list.innerHTML = entries.map(function (e) {
        return '<div class="modal-row ' + (e.isDir ? 'dir' : '') + '" data-name="' + esc(e.name) + '" data-isdir="' + e.isDir + '">' +
               '<span class="ic">' + (e.isDir ? '\u{1F4C1}' : '\u{1F4C4}') + '</span><span>' + esc(e.name) + '</span></div>';
      }).join('');
      list.querySelectorAll('.modal-row[data-name]').forEach(function (row) {
        row.onclick = function () {
          var name = row.dataset.name, isDir = row.dataset.isdir === 'true';
          if (isDir) { fbList(fbCurrentDir ? fbCurrentDir + '/' + name : name); return; }
          // só alterna a classe: redesenhar a lista aqui quebraria o duplo clique
          list.querySelectorAll('.modal-row').forEach(function (r) { r.classList.remove('selected'); });
          row.classList.add('selected');
          fbSelected = { name: name, isDir: false };
          if (fbMode === 'save') $('fb-filename').value = name;
        };
        if (row.dataset.isdir !== 'true') row.ondblclick = function () { fbSelected = { name: row.dataset.name, isDir: false }; fbConfirm(); };
      });
    }).catch(function (e) { $('fb-msg').textContent = 'Erro ao listar pasta: ' + e.message; });
  }
  function renderBreadcrumb() {
    var bc = $('fb-breadcrumb'), parts = fbCurrentDir ? fbCurrentDir.split('/').filter(Boolean) : [], acc = '';
    var html = '<button data-path="">raiz</button>';
    parts.forEach(function (p) { acc = acc ? acc + '/' + p : p; html += ' / <button data-path="' + esc(acc) + '">' + esc(p) + '</button>'; });
    bc.innerHTML = html;
    bc.querySelectorAll('button').forEach(function (b) { b.onclick = function () { fbList(b.dataset.path); }; });
  }
  function openFileBrowser(mode) {
    fbMode = mode;
    $('fb-title').textContent = mode === 'open' ? 'Abrir projeto' : 'Salvar projeto como';
    $('fb-msg').textContent = '';
    $('fb-filename').style.display = mode === 'save' ? '' : 'none';
    $('fb-filename').value = ui.file ? ui.file.path.split('/').pop()
      : ((state.name || 'rotor').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'rotor') + '.json';
    $('fb-confirm').textContent = mode === 'open' ? 'Abrir' : 'Salvar aqui';
    $('fb-overlay').classList.add('open');
    fbList(ui.file && ui.file.path.indexOf('/') >= 0 ? ui.file.path.split('/').slice(0, -1).join('/') : '');
  }
  function closeFileBrowser() { $('fb-overlay').classList.remove('open'); }

  function fbConfirm() {
    var msg = $('fb-msg');
    msg.textContent = '';
    if (fbMode === 'open') {
      if (!fbSelected || fbSelected.isDir) { msg.textContent = 'Selecione um arquivo .json.'; return; }
      var rel = fbCurrentDir ? fbCurrentDir + '/' + fbSelected.name : fbSelected.name;
      api('GET', '/api/file?path=' + encodeURIComponent(rel)).then(function (data) {
        var st = applyProjectData(data.content);
        if (!st) return;
        closeFileBrowser();
        loadState(st, { path: rel });
      }).catch(function (e) { msg.textContent = 'Erro ao carregar o arquivo: ' + e.message; });
    } else {
      var filename = $('fb-filename').value.trim();
      if (!filename) { msg.textContent = 'Digite um nome de arquivo.'; return; }
      if (!/\.json$/i.test(filename)) filename += '.json';
      if (fbNames.indexOf(filename) >= 0 && !(ui.file && ui.file.path === (fbCurrentDir ? fbCurrentDir + '/' : '') + filename) &&
          !confirm('"' + filename + '" já existe nesta pasta. Substituir?')) return;
      var rel2 = fbCurrentDir ? fbCurrentDir + '/' + filename : filename;
      saveTo(rel2, filename.replace(/\.json$/i, '')).then(closeFileBrowser).catch(function (e) { msg.textContent = 'Erro ao salvar: ' + e.message; });
    }
  }
  // content vai como OBJETO, igual ao PEVAL
  function saveTo(rel, name) {
    return api('POST', '/api/file', { path: rel, content: buildProjectData(name), overwrite: true }).then(function () {
      ui.file = { path: rel }; ui.savedKey = stateKey(); updateDirty();
      toast('Projeto salvo em ' + rel + '.', 'ok');
    });
  }
  function saveCurrent() {
    if (!state.shaft.length) { toast('Nada para salvar: o modelo está vazio.', 'info'); return; }
    if (!ui.file) { openFileBrowser('save'); return; }
    saveTo(ui.file.path).then(function () {
      var btn = $('btn-save'), old = btn.textContent;
      btn.textContent = 'Salvo ✓'; setTimeout(function () { btn.textContent = old; }, 1200);
    }).catch(function (e) { toast('Erro ao salvar o projeto: ' + e.message, 'err'); });
  }
  function confirmDiscard() { return stateKey() === ui.savedKey || confirm('Há alterações não salvas. Descartar?'); }

  function wireProjectToolbar() {
    $('btn-open').onclick = function () { if (confirmDiscard()) openFileBrowser('open'); };
    $('btn-save').onclick = saveCurrent;
    $('btn-saveas').onclick = function () { if (state.shaft.length) openFileBrowser('save'); else toast('Nada para salvar: o modelo está vazio.', 'info'); };
    $('fb-close').onclick = closeFileBrowser;
    $('fb-confirm').onclick = fbConfirm;
    $('fb-overlay').addEventListener('click', function (e) { if (e.target.id === 'fb-overlay') closeFileBrowser(); });
    $('fb-filename').addEventListener('keydown', function (e) { if (e.key === 'Enter') fbConfirm(); });
    $('fb-newfolder').onclick = function () {
      var name = prompt('Nome da nova pasta:');
      if (!name) return;
      var rel = fbCurrentDir ? fbCurrentDir + '/' + name.trim() : name.trim();
      api('POST', '/api/mkdir', { path: rel }).then(function () { fbList(fbCurrentDir); })
        .catch(function (e) { $('fb-msg').textContent = 'Erro ao criar pasta: ' + e.message; });
    };
    updateDirty();
  }
  function wireHubNav() {
    fetch('/api/whoami').then(function (r) { return r.json(); }).catch(function () { return { authed: false }; }).then(function (who) {
      if (!who.authed) { window.location.href = '/login.html'; return; }
      $('hubnav-who').textContent = who.username;
    });
    $('hubnav-logout').onclick = function () {
      if (!confirmDiscard()) return;
      fetch('/api/logout', { method: 'POST' }).catch(function () { /* */ }).then(function () { window.location.href = '/login.html'; });
    };
  }
  function wireTheme() {
    var btn = $('btn-theme');
    if (!btn) return;
    btn.onclick = function () {
      var cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark', next = cur === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('hub-theme', next); } catch (e) { /* */ }
      destroyCharts(); ui.rendered = {};                 // gráficos redesenhados com as cores do novo tema
      if (ui.tab !== 'model') renderPanel(ui.tab);
    };
  }
  function downloadReport() {
    if (!ui.results) { toast('Calcule antes de exportar o relatório.', 'info'); return; }
    var blob = new Blob([ui.results.report], { type: 'text/plain;charset=utf-8' }), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = ((state.name || 'rotordin').replace(/[^a-zA-Z0-9_-]+/g, '_') || 'rotordin') + '_relatorio.txt'; a.click();
    URL.revokeObjectURL(url);
  }

  // ======================================================================= //
  // Novo rotor / exemplo (carregados só a pedido — o app abre em branco)
  // ======================================================================= //
  function newBlankRotor() {
    var st = blankState();
    for (var i = 0; i < 4; i++) st.shaft.push(Object.assign(E.blankRow('shaft'), { L: 250, od: 100 }));
    [1, 5].forEach(function (n, k) { st.bearings.push(Object.assign(E.blankRow('bearings'), { node: n, name: 'M' + (k + 1) })); });
    Object.assign(st.analysis, { plane_A: 2, plane_B: 4, stab_node: 3 });
    return st;
  }
  function exampleState() {
    var st = blankState();
    st.name = 'Compressor centrífugo – exemplo';
    [[60, 80], [60, 80], [50, 100], [50, 100], [110, 115], [130, 130], [130, 130], [130, 130], [130, 130], [130, 130],
     [130, 130], [110, 115], [50, 100], [50, 100], [60, 90]].forEach(function (x) {
      st.shaft.push(Object.assign(E.blankRow('shaft'), { L: x[0], od: x[1] }));
    });
    st.shaft[6].od_mass = 170;
    [['Acoplamento', 1, 18.0, 0.060, 0.035], ['Imp. 1', 7, 58.70, 1.4184, 0.7268], ['Imp. 2', 9, 58.70, 1.4184, 0.7268],
     ['Imp. 3', 11, 39.10, 0.7884, 0.4024], ['Palhetas', 16, 10.71, 0.1007, 0.0514]].forEach(function (d) {
      st.disks.push(Object.assign(E.blankRow('disks'), { name: d[0], node: d[1], m: d[2], Ip: d[3], Id: d[4] }));
    });
    [['LA', 4], ['LOA', 14]].forEach(function (b) {
      st.bearings.push(Object.assign(E.blankRow('bearings'), { name: b[0], node: b[1], type: 'Tilting pad LBP', D: 100, Lb: 50, Cr: 75,
        preload: 0.3, e_bore: 32, n_pads: 5, arc: 60, offset: 0.5, oil: 'ISO VG 32', thermal: 'Calculada', T_in: 45, T: 50, alpha_b: 11.5,
        kxx: 1.9e8, kyy: 2.9e8, cxx: 1.1e5, cyy: 1.5e5 }));
    });
    Object.assign(st.analysis, { plane_A: 7, plane_B: 11, probes: '4, 14', stab_node: 9 });
    return st;
  }

  // ======================================================================= //
  // Eventos e inicialização
  // ======================================================================= //
  function wire() {
    document.addEventListener('change', function (e) {
      if (e.target.closest('#sidebar')) onSideChange(e);
      else onSheetChange(e);
    });
    document.addEventListener('paste', onSheetPaste);
    document.addEventListener('keydown', function (e) {
      onSheetKey(e);
      var tag = (e.target.tagName || '').toLowerCase(), editing = tag === 'input' || tag === 'select' || tag === 'textarea';
      var mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 'Enter') { e.preventDefault(); if (document.activeElement) document.activeElement.blur(); setTimeout(calculate, 0); }
      else if (mod && (e.key === 's' || e.key === 'S')) { e.preventDefault(); if (document.activeElement) document.activeElement.blur(); setTimeout(saveCurrent, 0); }
      else if (mod && !editing && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (mod && !editing && (e.key === 'y' || e.key === 'Y' || ((e.key === 'z' || e.key === 'Z') && e.shiftKey))) { e.preventDefault(); redo(); }
      else if (e.key === 'Escape') { closeMenu(); closeFileBrowser(); }
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.ctx-menu')) closeMenu();
      var t = e.target.closest('[data-tab]'); if (t) { selectTab(t.getAttribute('data-tab')); return; }
      var sh = e.target.closest('[data-sheet]'); if (sh) { showSheet(sh.getAttribute('data-sheet')); return; }
      var tool = e.target.closest('[data-tool]'); if (tool) { onTool(tool.getAttribute('data-tool')); return; }
      var em = e.target.closest('[data-empty]');
      if (em) {
        var k = em.getAttribute('data-empty');
        if (k === 'new') { loadState(newBlankRotor(), null); commit(); }
        else if (k === 'example') { loadState(exampleState(), null); commit(); }
        else openFileBrowser('open');
        return;
      }
      var sa = e.target.closest('[data-sheetact]');
      if (sa) {
        if (sa.getAttribute('data-sheetact') === 'copy') copySheet();
        else { addRow(ui.sheet, state[ui.sheet].length); ui.view = null; commit(); renderSheet(); selectRow(ui.sheet, state[ui.sheet].length - 1, true); }
        return;
      }
      var ra = e.target.closest('[data-rowact]');
      if (ra) {
        var r = Number(ra.getAttribute('data-r')), tb = ui.sheet;
        if (ra.getAttribute('data-rowact') === 'ins') { addRow(tb, r); ui.view = null; commit(); renderSheet(); selectRow(tb, r); }
        else if (deleteRow(tb, r)) { ui.sel = { table: null, row: -1 }; ui.view = null; commit(); renderSheet(); }
        return;
      }
      var rs = e.target.closest('[data-rowsel]'); if (rs) { selectRow(ui.sheet, Number(rs.getAttribute('data-rowsel'))); return; }
      if (e.target.id === 'btnCalc') calculate();
      else if (e.target.id === 'btnStop' && ui.running) ui.running.stop = true;
      else if (e.target.id === 'btnCopyReport' && ui.results) { copyText(ui.results.report); toast('Relatório copiado.', 'ok'); }
      else if (e.target.id === 'btnReportTxt' || e.target.id === 'btn-report') downloadReport();
      else if (e.target.id === 'btn-recalc') calculate();
    });
    document.addEventListener('focusin', function (e) {
      var el = e.target;
      if (el.hasAttribute && el.hasAttribute('data-c') && el.closest('table.sheet')) {
        var r = Number(el.getAttribute('data-r'));
        if (!(ui.sel.table === ui.sheet && ui.sel.row === r)) selectRow(ui.sheet, r);
      }
    });
    window.addEventListener('beforeunload', function (e) {
      if (stateKey() !== ui.savedKey) { e.preventDefault(); e.returnValue = ''; }
    });
    wireSvg();
    wireProjectToolbar();
    wireHubNav();
    wireTheme();
  }

  function init() {
    if (!E) { document.body.innerHTML = '<p style="padding:20px">engine.js não carregou.</p>'; return; }
    wire();
    loadState(blankState(), null);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  // ganchos para testes automatizados (sem efeito no uso normal)
  window.__rotordin = { get state() { return state; }, ui: ui, loadState: loadState, exampleState: exampleState,
                        newBlankRotor: newBlankRotor, calculate: calculate, applyProjectData: applyProjectData, buildProjectData: buildProjectData };



})();
