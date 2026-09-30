// =============================================================================
// CICLOVAP — ui.js
// Editor de fluxograma (SVG), inspetor de propriedades, diagramas T-s / h-s e
// curvas paramétricas (Chart.js), integração com projetos do hub.
// Toda a física fica no engine.js; aqui só estado, desenho e interação.
// =============================================================================
(function () {
'use strict';
const APP_ID = 'ciclovap';
const D = Engine.DEFS;
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const fmt = (v, d = 1) => Number.isFinite(v) ? v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–';
const clone = o => JSON.parse(JSON.stringify(o));
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

// ---------------------------------------------------------------------------
// Estado. Tudo que está em `state` é salvo no projeto. Nunca pré-carregar
// exemplos aqui: o app abre em branco (ver renderEmptyState).
// ---------------------------------------------------------------------------
const DEFAULT_SETTINGS = () => ({
  labelMode: 'full', propMode: 'Ts', iso: true, nums: true, zoom: false,
  sweep: { pk: '', fk: '', from: '', to: '', n: 11, fv: '', y: 'etaCiclo' }
});
let state = { components: [], connections: [], settings: DEFAULT_SETTINGS() };
const project = { name: '', path: '', dirty: false };
let sel = null;                    // {k:'c'|'l', id}
let result = null, stale = true;
let view = { x: 40, y: 30, k: 1 }; // pan/zoom do fluxograma (não é salvo)
let hist = [], drag = null, calcTimer = null, activeView = 'flow';

const comp = id => state.components.find(c => c.id === id);
const connAt = (cid, pn) => state.connections.find(cn => (cn.from.c === cid && cn.from.p === pn) || (cn.to.c === cid && cn.to.p === pn));
const streamNo = id => state.connections.findIndex(c => c.id === id) + 1;
const streamRes = id => result && result.streamMap ? result.streamMap[id] : null;

// ---------------------------------------------------------------------------
// Geometria de desenho dos componentes (fica na UI: o engine não sabe desenhar)
// ports: [x, y, lado]  lado: l r t b
// ---------------------------------------------------------------------------
const GEOM = {"caldeira":{"w":76,"h":96,"ports":{"entrada":[0,76,"l"],"saida":[76,18,"r"]}},"turbina":{"w":96,"h":64,"ports":{"entrada":[0,32,"l"],"saida":[96,32,"r"]}},"turbina_ext":{"w":110,"h":70,"ports":{"entrada":[0,35,"l"],"extracao":[55,59,"b"],"saida":[110,35,"r"]}},"condensador":{"w":96,"h":60,"ports":{"entrada":[48,0,"t"],"dreno":[96,18,"r"],"saida":[48,60,"b"]}},"bomba":{"w":52,"h":52,"ports":{"entrada":[0,26,"l"],"saida":[52,26,"r"]}},"aquecedor":{"w":110,"h":46,"ports":{"vapor":[40,0,"t"],"dreno_in":[85,0,"t"],"agua_in":[0,23,"l"],"agua_out":[110,23,"r"],"dreno":[55,46,"b"]}},"desaerador":{"w":110,"h":60,"ports":{"vapor":[30,0,"t"],"dreno_in":[82,16,"t"],"agua_in":[0,36,"l"],"saida":[55,60,"b"]}},"dessuperaquecedor":{"w":84,"h":40,"ports":{"vapor":[0,20,"l"],"agua":[42,40,"b"],"saida":[84,20,"r"]}},"valvula":{"w":44,"h":30,"ports":{"entrada":[0,15,"l"],"saida":[44,15,"r"]}},"divisor":{"w":28,"h":28,"ports":{"entrada":[0,14,"l"],"saida1":[28,14,"r"],"saida2":[14,28,"b"]}},"misturador":{"w":28,"h":28,"ports":{"entrada1":[0,14,"l"],"entrada2":[14,0,"t"],"saida":[28,14,"r"]}},"processo":{"w":84,"h":52,"ports":{"entrada":[0,16,"l"],"saida":[84,36,"r"]}}};
const PAL_ORDER = ['caldeira', 'turbina', 'turbina_ext', 'condensador', 'bomba', 'aquecedor', 'desaerador', 'dessuperaquecedor', 'valvula', 'divisor', 'misturador', 'processo'];

function icon(type) {
  const g = GEOM[type], w = g.w, h = g.h;
  switch (type) {
    case 'caldeira': return `<rect class="body" x="0" y="0" width="${w}" height="${h}" rx="4"/>
      <rect class="det" x="12" y="8" width="52" height="16" rx="8"/>
      <path class="det" d="M20 24V62M30 24V62M40 24V62M50 24V62M58 24V62"/>
      <path class="flame" d="M38 90c-11 0-16-7-13-15 2-5 6-6 6-11 5 3 6 8 5 11 3-2 4-5 3-8 7 5 9 12 7 17-2 4-5 6-8 6z"/>`;
    case 'turbina': return `<path class="body" d="M0 20L${w} 0V${h}L0 44Z"/>
      <path class="det" d="M-6 32H${w + 6}" stroke-dasharray="6 3"/><path class="det" d="M28 16V48M52 11V53M74 6V58"/>`;
    case 'turbina_ext': return `<path class="body" d="M0 22L${w} 0V${h}L0 48Z"/>
      <path class="det" d="M-6 35H${w + 6}" stroke-dasharray="6 3"/><path class="det" d="M30 16V54M80 7V63"/>`;
    case 'condensador': return `<rect class="body" x="0" y="0" width="${w}" height="${h}" rx="10"/>
      <path class="det" d="M12 18H84M12 26H84M12 34H84"/><path class="det" d="M18 48H78" stroke-dasharray="3 3"/>`;
    case 'bomba': return `<circle class="body" cx="26" cy="26" r="24"/><path class="det" d="M16 12L42 26L16 40Z"/>`;
    case 'aquecedor': return `<rect class="body" x="0" y="0" width="${w}" height="${h}" rx="23"/>
      <path class="det" d="M4 23H70a8 8 0 0 0 0-10H22" stroke-dasharray="4 3"/>`;
    case 'desaerador': return `<rect class="body" x="20" y="0" width="20" height="18" rx="3"/>
      <rect class="body" x="0" y="16" width="${w}" height="40" rx="20"/>
      <path class="det" d="M12 42H98" stroke-dasharray="3 3"/><path class="det" d="M55 56V60"/>`;
    case 'dessuperaquecedor': return `<rect class="body" x="0" y="11" width="${w}" height="18" rx="3"/>
      <path class="det" d="M42 40V21M42 21L34 14M42 21L42 13M42 21L50 14"/>`;
    case 'valvula': return `<path class="body" d="M0 5L22 15L0 25Z"/><path class="body" d="M44 5L22 15L44 25Z"/>
      <path class="det" d="M22 15V3M15 3H29"/>`;
    case 'divisor': return `<path class="det" d="M0 14H28M14 14V28"/><circle class="solid" cx="14" cy="14" r="5"/>`;
    case 'misturador': return `<path class="det" d="M0 14H28M14 0V14"/><circle class="body" cx="14" cy="14" r="6"/>`;
    case 'processo': return `<rect class="body" x="0" y="0" width="${w}" height="${h}" rx="4"/>
      <path class="det" d="M0 16H14L22 8L32 24L42 8L52 24L62 8L70 36H84"/>`;
  }
  return '';
}
function portGeo(c, pn) {
  const g = GEOM[c.type], [px, py, pside] = g.ports[pn];
  let x = px, side = pside;
  if (c.flip) { x = g.w - px; side = side === 'l' ? 'r' : side === 'r' ? 'l' : side; }
  return { x: c.x + x, y: c.y + py, side, lx: x, ly: py };
}
const KCOL = { vapor: 'var(--steam)', agua: 'var(--water)', geral: 'var(--muted)' };
const DIRS = { l: [-1, 0], r: [1, 0], t: [0, -1], b: [0, 1] };
function bez(a, b) {
  const dist = Math.hypot(b.x - a.x, b.y - a.y), k = Math.max(28, Math.min(150, dist * 0.45));
  const [ax, ay] = DIRS[a.side], [bx, by] = DIRS[b.side];
  const c1 = { x: a.x + ax * k, y: a.y + ay * k }, c2 = { x: b.x + bx * k, y: b.y + by * k };
  const t = 0.5, u = 1 - t;
  const mid = { x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x, y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y };
  return { d: `M${a.x},${a.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${b.x},${b.y}`, mid };
}
function phaseKey(s) {
  if (!s) return 'idle';
  if (s.phase === 'mix') return s.x < 1e-4 ? 'liq' : s.x > 0.9999 ? 'vap' : 'mix';
  return s.phase === 'vap' ? 'vap' : 'liq';
}
const PCOL = { vap: 'var(--steam)', mix: 'var(--mix)', liq: 'var(--water)', idle: 'var(--muted)' };

// Exemplos (opcionais, só carregados a pedido do usuário)
function mkExample(list, links) {
  const components = list.map(([id, type, name, x, y, params = {}, flip = false]) => {
    const p = {}; D[type].params.forEach(q => p[q.k] = q.v); Object.assign(p, params);
    return { id, type, name, x, y, flip, params: p };
  });
  const connections = links.map(([a, b], i) => {
    const [fc, fp] = a.split('.'), [tc, tp] = b.split('.');
    return { id: 'k' + (i + 1), from: { c: fc, p: fp }, to: { c: tc, p: tp } };
  });
  return { components, connections };
}
const EXAMPLES = {
  simples: { title: 'Rankine simples', build: () => mkExample([
    ['cal', 'caldeira', 'Caldeira', 80, 90, { P: 100, T: 500, m: 50 }],
    ['tv', 'turbina', 'Turbina', 260, 76, { Ps: 0.08 }],
    ['cd', 'condensador', 'Condensador', 460, 200],
    ['bb', 'bomba', 'Bomba de alimentação', 290, 330, { Ps: 105 }, true]
  ], [['cal.saida', 'tv.entrada'], ['tv.saida', 'cd.entrada'], ['cd.saida', 'bb.entrada'], ['bb.saida', 'cal.entrada']]) },
  regenerativo: { title: 'Rankine regenerativo', build: () => mkExample([
    ['cal', 'caldeira', 'Caldeira', 60, 90, { P: 120, T: 540, m: 100 }],
    ['t1', 'turbina_ext', 'Turbina AP', 230, 73, { Pe: 30, Ps: 6, eta: 86 }],
    ['dv', 'divisor', 'Divisor', 430, 94, { modo: 'livre' }],
    ['t2', 'turbina_ext', 'Turbina BP', 560, 73, { Pe: 1.5, Ps: 0.08, eta: 84 }],
    ['cd', 'condensador', 'Condensador', 740, 200],
    ['bc', 'bomba', 'Bomba de condensado', 730, 340, { Ps: 8 }, true],
    ['aqb', 'aquecedor', 'Aquecedor BP', 540, 343, { TTD: 3, DCA: 6, dP: 1 }, true],
    ['da', 'desaerador', 'Desaerador', 340, 320, {}, true],
    ['ba', 'bomba', 'Bomba de alimentação', 240, 420, { Ps: 135 }, true],
    ['aqa', 'aquecedor', 'Aquecedor AP', 60, 423, { TTD: 3, DCA: 6, dP: 2 }, true]
  ], [
    ['cal.saida', 't1.entrada'], ['t1.saida', 'dv.entrada'], ['dv.saida1', 't2.entrada'], ['t2.saida', 'cd.entrada'],
    ['cd.saida', 'bc.entrada'], ['bc.saida', 'aqb.agua_in'], ['t2.extracao', 'aqb.vapor'], ['aqb.dreno', 'cd.dreno'],
    ['aqb.agua_out', 'da.agua_in'], ['dv.saida2', 'da.vapor'], ['da.saida', 'ba.entrada'], ['ba.saida', 'aqa.agua_in'],
    ['t1.extracao', 'aqa.vapor'], ['aqa.dreno', 'da.dreno_in'], ['aqa.agua_out', 'cal.entrada']
  ]) },
  cogeracao: { title: 'Cogeração com vapor de processo', build: () => mkExample([
    ['cal', 'caldeira', 'Caldeira', 60, 90, { P: 65, T: 480, m: 60, eta: 85 }],
    ['tv', 'turbina_ext', 'Turbogerador', 240, 73, { Pe: 2.5, Ps: 0.12, eta: 80 }],
    ['cd', 'condensador', 'Condensador', 790, 190],
    ['dv', 'divisor', 'Divisor de extração', 320, 215, { modo: 'livre' }],
    ['dsa', 'dessuperaquecedor', 'Dessuperaquecedor', 420, 209, { T: 135 }],
    ['pr', 'processo', 'Processo (fábrica)', 600, 213, { modo: 'Q', Q: 35, dP: 0.3 }],
    ['bc', 'bomba', 'Bomba de condensado', 800, 350, { Ps: 4 }, true],
    ['da', 'desaerador', 'Desaerador', 500, 350, {}, true],
    ['ba', 'bomba', 'Bomba de alimentação', 320, 460, { Ps: 75 }, true],
    ['dv2', 'divisor', 'Divisor de água', 170, 472, { modo: 'livre' }, true]
  ], [
    ['cal.saida', 'tv.entrada'], ['tv.saida', 'cd.entrada'], ['tv.extracao', 'dv.entrada'], ['dv.saida1', 'dsa.vapor'],
    ['dsa.saida', 'pr.entrada'], ['pr.saida', 'da.dreno_in'], ['dv.saida2', 'da.vapor'], ['cd.saida', 'bc.entrada'],
    ['bc.saida', 'da.agua_in'], ['da.saida', 'ba.entrada'], ['ba.saida', 'dv2.entrada'], ['dv2.saida1', 'cal.entrada'],
    ['dv2.saida2', 'dsa.agua']
  ]) }
};

// ---------------------------------------------------------------------------
// Fluxograma (SVG)
// ---------------------------------------------------------------------------
const svg = $('#cv'), vp = $('#vp'), gLinks = $('#gLinks'), gNodes = $('#gNodes'), gTags = $('#gTags'), tmp = $('#tmp');

function renderFlow() {
  vp.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`);
  const errC = new Set(result && !stale ? result.errors.filter(e => e.c).map(e => e.c) : []);
  const lm = state.settings.labelMode;
  let L = '', T = '';
  state.connections.forEach(cn => {
    const a = comp(cn.from.c), b = comp(cn.to.c);
    if (!a || !b) return;
    const pa = portGeo(a, cn.from.p), pb = portGeo(b, cn.to.p), g = bez(pa, pb);
    const s = result && result.ok ? streamRes(cn.id) : null;
    const pk = phaseKey(s), isSel = sel && sel.k === 'l' && sel.id === cn.id;
    L += `<path class="lnk${isSel ? ' sel' : ''}${stale && s ? ' stale' : ''}" d="${g.d}" stroke="${PCOL[pk]}" marker-end="url(#ar-${pk})"/>
      <path class="lnk-hit" data-link="${cn.id}" d="${g.d}"/>`;
    if (s && lm !== 'none') {
      const lines = lm === 'full'
        ? [`${fmt(s.m, 2)} kg/s`, `${fmt(s.P, s.P < 1 ? 3 : 1)} bar`, `${fmt(s.T, 1)} °C`, pk === 'mix' ? `x=${fmt(s.x, 3)}` : `${fmt(s.h, 1)} kJ/kg`]
        : [`${fmt(s.m, 1)} kg/s`, `${fmt(s.T, 0)} °C`];
      const w = 82, lh = 11.5, h = lines.length * lh + 6;
      let tx = g.mid.x - w / 2, ty = g.mid.y - h / 2;
      const dx = pb.x - pa.x, dy = pb.y - pa.y;
      if (Math.hypot(dx, dy) < 150) { if (Math.abs(dx) >= Math.abs(dy)) ty = g.mid.y - h - 12; else tx = g.mid.x + 10; }
      const no = streamNo(cn.id);
      T += `<g class="tag" data-link="${cn.id}" transform="translate(${tx},${ty})"><rect width="${w}" height="${h}" rx="3"/>` +
        `<circle class="tn" cx="${w}" cy="0" r="8"/><text class="tnt" x="${w}" y="3.5" text-anchor="middle">${no}</text>` +
        lines.map((t, i) => `<text x="5" y="${13 + i * lh - 1}"${i === 0 ? ' class="tm"' : ''}>${esc(t)}</text>`).join('') + `</g>`;
    }
  });
  gLinks.innerHTML = L; gTags.innerHTML = T;
  svg.classList.toggle('stale-tags', stale);
  let N = '';
  state.components.forEach(c => {
    const d = D[c.type], g = GEOM[c.type];
    const isSel = sel && sel.k === 'c' && sel.id === c.id;
    let P = '';
    for (const [pn, pd] of Object.entries(d.ports)) {
      const pg = portGeo(c, pn), col = KCOL[pd.kind];
      P += `<g class="port ${pd.io}" data-port="${pn}" data-c="${c.id}"><title>${esc(pd.label)}</title>
        <circle class="ph" cx="${pg.lx}" cy="${pg.ly}" r="11"/>
        <circle class="pc" cx="${pg.lx}" cy="${pg.ly}" r="5" ${pd.io === 'out' ? `fill="${col}"` : `stroke="${col}"`}/></g>`;
    }
    const flipT = c.flip ? `transform="translate(${g.w},0) scale(-1,1)"` : '';
    N += `<g class="node${isSel ? ' sel' : ''}${errC.has(c.id) ? ' haserr' : ''}" data-id="${c.id}" transform="translate(${c.x},${c.y})">
      <rect class="hit" x="-6" y="-6" width="${g.w + 12}" height="${g.h + 12}"/>
      ${isSel ? `<rect class="selbox" x="-8" y="-8" width="${g.w + 16}" height="${g.h + 16}" rx="6"/>` : ''}
      <g ${flipT}>${icon(c.type)}</g>
      <text class="nlabel" x="${g.w / 2}" y="${g.h + 17}" text-anchor="middle">${esc(c.name)}</text>${P}</g>`;
  });
  gNodes.innerHTML = N;
  renderEmptyState();
  $('#bUndo').disabled = !hist.length;
  renderStatus();
}

// Tela vazia: orienta a montar o ciclo, abrir um projeto ou partir de um exemplo
function renderEmptyState() {
  const el = $('#emptyState');
  const empty = state.components.length === 0;
  el.hidden = !empty;
  if (!empty || el.dataset.ready) return;
  el.dataset.ready = '1';
  el.innerHTML = `<div class="empty-card">
    <h2>Nenhum ciclo montado</h2>
    <p>Arraste componentes da paleta à esquerda para o diagrama e ligue as portas de saída (cheias) às de entrada (vazadas). Os dados de entrada de cada componente aparecem no painel à direita quando ele é selecionado.</p>
    <p>Você também pode abrir um projeto salvo ou partir de um dos exemplos:</p>
    <div class="empty-actions">
      <button class="btn btn-primary" data-act="open">Abrir projeto…</button>
      ${Object.entries(EXAMPLES).map(([k, v]) => `<button class="btn" data-ex="${k}">${esc(v.title)}</button>`).join('')}
    </div></div>`;
  el.querySelector('[data-act="open"]').onclick = () => openFileBrowser('open');
  el.querySelectorAll('[data-ex]').forEach(b => b.onclick = () => loadExample(b.dataset.ex));
}

function renderStatus() {
  const s = $('#status');
  if (!state.components.length) { s.textContent = ''; s.className = 'status'; return; }
  if (!result) { s.textContent = 'Não calculado'; s.className = 'status'; return; }
  if (stale) { s.textContent = 'Resultados desatualizados'; s.className = 'status'; return; }
  if (result.ok) {
    s.textContent = `Convergiu em ${result.iterations + result.newton} iterações (${result.ms} ms)` + (result.warnings.length ? `, ${result.warnings.length} alerta${result.warnings.length > 1 ? 's' : ''}` : '');
    s.className = 'status ok';
  } else { s.textContent = `${result.errors.length} problema${result.errors.length > 1 ? 's' : ''} no modelo`; s.className = 'status bad'; }
}

// ---------------------------------------------------------------------------
// Inspetor (painel direito)
// ---------------------------------------------------------------------------
function kvRows(rows) {
  return `<table class="kv">${rows.map(([l, v, u, key]) => `<tr${key ? ' class="key"' : ''}><td>${esc(l)}</td><td class="v">${v}${u ? `<small>${esc(u)}</small>` : ''}</td></tr>`).join('')}</table>`;
}
const cap = m => m.charAt(0).toUpperCase() + m.slice(1);
function msgList() {
  if (!result) return '';
  const all = result.errors.map(e => ({ ...e, t: 'e' })).concat(result.warnings.map(w => ({ ...w, t: 'w' })));
  if (!all.length) return '';
  return `<ul class="msgs">${all.map(m => {
    const c = m.c && comp(m.c);
    return `<li class="notice ${m.t === 'e' ? 'notice-err' : 'notice-warn'}"${c ? ` data-c="${c.id}"` : ''}>${c ? `<b>${esc(c.name)}:</b> ` : ''}${esc(cap(m.msg))}</li>`;
  }).join('')}</ul>`;
}
function renderInsp() {
  const el = $('#insp'), a = document.activeElement;
  const key = a && el.contains(a) ? (a.dataset.k || a.id) : null;
  const top = el.scrollTop;
  renderInspBody(el);
  el.scrollTop = top;
  if (key) { const f = el.querySelector(`[data-k="${key}"]`) || el.querySelector('#' + key); if (f) f.focus(); }
}
function renderInspBody(el) {
  if (sel && sel.k === 'c' && comp(sel.id)) {
    const c = comp(sel.id), d = D[c.type];
    let h = `<input class="name-in" id="iName" value="${esc(c.name)}" aria-label="Nome do componente"><p class="sub">${esc(d.name)}</p>`;
    const vis = d.params.filter(p => !p.when || p.when(c.params));
    if (vis.length) {
      h += `<div class="field-group"><h2>Dados de entrada</h2>`;
      vis.forEach(p => {
        if (p.type === 'select') h += `<label class="field sel2"><span>${esc(p.label)}</span><select data-k="${p.k}">${p.options.map(([v, t]) => `<option value="${v}"${c.params[p.k] === v ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
        else h += `<label class="field"><span>${esc(p.label)}</span><input type="number" step="any" inputmode="decimal" data-k="${p.k}" value="${c.params[p.k]}"><span class="u">${esc(p.u || '')}</span></label>`;
      });
      h += `</div>`;
    }
    if (d.note) h += `<div class="hint">${esc(d.note)}</div>`;
    const rows = result && result.ok && !stale ? result.comps[c.id] : null;
    if (rows && rows.length) h += `<div class="field-group"><h2>Resultados</h2>${kvRows(rows.map(([l, v, u]) => [l, fmt(v, u === '–' ? 3 : u === 'MW' ? 2 : 1), u === '–' ? '' : u]))}</div>`;
    h += `<div class="field-group"><h2>Portas</h2><ul class="ports">${Object.entries(d.ports).map(([pn, pd]) => {
      const cn = connAt(c.id, pn);
      let st;
      if (cn) { const o = comp(cn.from.c === c.id ? cn.to.c : cn.from.c); st = `<span>${pd.io === 'out' ? 'para' : 'de'} ${esc(o.name)} (corrente ${streamNo(cn.id)})</span>`; }
      else st = pd.optional ? '<span class="free">livre (opcional)</span>' : '<span class="miss">não conectada</span>';
      return `<li><span class="dot" style="background:${KCOL[pd.kind]}"></span><b>${esc(pd.label)}</b>: ${st}</li>`;
    }).join('')}</ul></div>`;
    const cm = result && !stale ? result.errors.map(m => ({ ...m, t: 'e' })).concat(result.warnings.map(m => ({ ...m, t: 'w' }))).filter(m => m.c === c.id) : [];
    if (cm.length) h += `<ul class="msgs">${cm.map(m => `<li class="notice ${m.t === 'e' ? 'notice-err' : 'notice-warn'}">${esc(cap(m.msg))}</li>`).join('')}</ul>`;
    h += `<div class="row-btns"><button class="btn" id="iFlip">Espelhar</button><button class="btn" id="iDup">Duplicar</button><button class="btn" id="iDel">Excluir</button></div>`;
    el.innerHTML = h;
    el.querySelector('#iName').addEventListener('change', e => { push(); c.name = e.target.value.trim() || d.name; changed(); });
    el.querySelectorAll('[data-k]').forEach(inp => {
      const p = d.params.find(q => q.k === inp.dataset.k);
      inp.addEventListener('change', () => {
        let v = inp.value;
        if (p.type !== 'select') { v = parseFloat(String(v).replace(',', '.')); if (!Number.isFinite(v)) { inp.value = c.params[p.k]; toast('Valor inválido.'); return; } }
        push(); c.params[p.k] = v; changed(p.type === 'select');
      });
    });
    el.querySelector('#iFlip').onclick = () => { push(); c.flip = !c.flip; changed(); };
    el.querySelector('#iDup').onclick = () => addComp(c.type, c.x + 30, c.y + 30, clone(c.params), c.flip);
    el.querySelector('#iDel').onclick = delSel;
    return;
  }
  if (sel && sel.k === 'l') {
    const cn = state.connections.find(x => x.id === sel.id);
    if (cn) {
      const a = comp(cn.from.c), b = comp(cn.to.c);
      let h = `<h3 class="insp-title">Corrente ${streamNo(cn.id)}</h3><p class="sub">${esc(a.name)} (${esc(D[a.type].ports[cn.from.p].label)}) para ${esc(b.name)} (${esc(D[b.type].ports[cn.to.p].label)})</p>`;
      const s = result && result.ok ? streamRes(cn.id) : null;
      if (s && !stale) {
        const ph = { vap: 'Vapor superaquecido', mix: 'Mistura líquido-vapor', liq: 'Líquido' }[phaseKey(s)];
        h += `<div class="field-group">${kvRows([
          ['Vazão mássica', fmt(s.m, 3), 'kg/s', 1], ['Vazão mássica', fmt(s.m * 3.6, 2), 't/h'],
          ['Pressão', fmt(s.P, s.P < 1 ? 4 : 2), 'bar', 1], ['Temperatura', fmt(s.T, 2), '°C', 1],
          ['Entalpia', fmt(s.h, 2), 'kJ/kg'], ['Entropia', fmt(s.s, 4), 'kJ/kg·K'],
          ['Título', s.x == null ? '–' : fmt(s.x, 4), ''], ['Temperatura de saturação', fmt(Engine.props.tsat(s.P), 2), '°C'], ['Estado', ph, '']
        ])}</div>`;
      } else h += `<div class="hint">Calcule o ciclo para ver o estado desta corrente.</div>`;
      h += `<div class="row-btns"><button class="btn" id="iDel">Excluir conexão</button></div>`;
      el.innerHTML = h;
      el.querySelector('#iDel').onclick = delSel;
      return;
    }
  }
  let h = `<h3 class="insp-title">Resultados do ciclo</h3>`;
  if (!state.components.length) h += `<div class="hint">Os resultados globais (potência, eficiências, heat rate) aparecem aqui depois que o ciclo for montado e calculado.</div>`;
  else if (!result) h += `<div class="hint">Clique em Calcular para resolver o ciclo.</div>`;
  else if (result.ok && !stale) {
    const t = result.totals;
    const rows = [
      ['Potência líquida', fmt(t.Wliq / 1000, 2), 'MW', 1], ['Potência das turbinas', fmt(t.Wturb / 1000, 2), 'MW'],
      ['Consumo das bombas', fmt(t.Wbomb / 1000, 3), 'MW'], ['Calor absorvido na caldeira', fmt(t.Qcald / 1000, 2), 'MW'],
      ['Calor do combustível', fmt(t.Qcomb / 1000, 2), 'MW'], ['Eficiência do ciclo', fmt(t.etaCiclo * 100, 2), '%', 1],
      ['Eficiência da planta', fmt(t.etaPlanta * 100, 2), '%'], ['Heat rate', fmt(t.heatRate, 0), 'kJ/kWh'],
      ['Calor rejeitado no condensador', fmt(t.Qcond / 1000, 2), 'MW']
    ];
    if (t.Qproc > 0) rows.push(['Calor útil de processo', fmt(t.Qproc / 1000, 2), 'MW', 1], ['Fator de utilização de energia', fmt(t.fue * 100, 1), '%']);
    rows.push(['Fechamento do balanço de energia', fmt(t.closure, 3), 'kW']);
    h += `<p class="sub">Eficiências líquidas, descontado o consumo das bombas.</p><div class="field-group">${kvRows(rows)}</div>`;
  } else if (stale) h += `<div class="hint">O modelo mudou desde o último cálculo. Clique em Calcular.</div>`;
  const ml = stale ? '' : msgList();
  if (ml) h += `<div class="field-group"><h2>${result.ok ? 'Alertas' : 'Problemas encontrados'}</h2>${ml}</div>`;
  h += `<div class="hint">Propriedades da água e do vapor: IAPWS-IF97 (regiões 1, 2 e 4), via steam.js do hub. Selecione um componente ou corrente para ver detalhes.</div>`;
  el.innerHTML = h;
  el.querySelectorAll('.msgs li[data-c]').forEach(li => li.onclick = () => { sel = { k: 'c', id: li.dataset.c }; renderAll(); });
}

// ---------------------------------------------------------------------------
// Alterações de modelo, desfazer, cálculo
// ---------------------------------------------------------------------------
function push() { hist.push(JSON.stringify({ components: state.components, connections: state.connections })); if (hist.length > 120) hist.shift(); }
function undo() {
  if (!hist.length) return;
  const h = JSON.parse(hist.pop());
  state.components = h.components; state.connections = h.connections; sel = null; changed();
}
function markDirty(v = true) { project.dirty = v; renderProjectName(); }
function renderAll() { renderFlow(); renderInsp(); refreshViews(); }
function changed(reInsp = true) {
  stale = true; markDirty(); renderFlow();
  if (reInsp) renderInsp();
  if (activeView === 'prop') drawProp();
  if ($('#auto').checked) { clearTimeout(calcTimer); calcTimer = setTimeout(recalc, 180); }
}
function nextId(type) { const b = D[type].short.toLowerCase(); let i = 1; while (comp(b + i)) i++; return b + i; }
function nextName(type) {
  const base = D[type].name, names = new Set(state.components.map(c => c.name));
  if (!names.has(base)) return base;
  let i = 2; while (names.has(`${base} ${i}`)) i++; return `${base} ${i}`;
}
function addComp(type, x, y, params, flip = false) {
  push();
  const p = {}; D[type].params.forEach(q => p[q.k] = q.v);
  if (params) Object.assign(p, params);
  const c = { id: nextId(type), type, name: nextName(type), x: Math.round(x / 5) * 5, y: Math.round(y / 5) * 5, flip, params: p };
  state.components.push(c);
  sel = { k: 'c', id: c.id };
  changed();
}
function delSel() {
  if (!sel) return;
  push();
  if (sel.k === 'c') {
    state.components = state.components.filter(c => c.id !== sel.id);
    state.connections = state.connections.filter(cn => cn.from.c !== sel.id && cn.to.c !== sel.id);
  } else state.connections = state.connections.filter(cn => cn.id !== sel.id);
  sel = null; changed();
}
function nextLinkId() { const ids = new Set(state.connections.map(c => c.id)); let i = 1; while (ids.has('k' + i)) i++; return 'k' + i; }
function engineParams() { return { components: clone(state.components), connections: clone(state.connections) }; }

// Valida o state, chama Engine.run() e redesenha os painéis
function recalc() {
  clearTimeout(calcTimer);
  if (!state.components.length) { result = null; stale = true; renderAll(); return; }
  const t0 = performance.now();
  try { result = Engine.run(engineParams()); }
  catch (e) { result = { ok: false, errors: [{ msg: 'erro interno no cálculo: ' + e.message }], warnings: [], streams: [], streamMap: {}, comps: {} }; }
  result.ms = Math.max(1, Math.round(performance.now() - t0));
  stale = false;
  renderAll();
}

// ---------------------------------------------------------------------------
// Interação no fluxograma
// ---------------------------------------------------------------------------
function toWorld(e) { const r = svg.getBoundingClientRect(); return { x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k }; }
function zoomAt(f, cx, cy) {
  const k = Math.min(2.5, Math.max(0.25, view.k * f)); f = k / view.k;
  view.x = cx - (cx - view.x) * f; view.y = cy - (cy - view.y) * f; view.k = k; renderFlow();
}
function fit() {
  if (!state.components.length) { view = { x: 40, y: 30, k: 1 }; renderFlow(); return; }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  state.components.forEach(c => { const g = GEOM[c.type]; x0 = Math.min(x0, c.x - 20); y0 = Math.min(y0, c.y - 30); x1 = Math.max(x1, c.x + g.w + 20); y1 = Math.max(y1, c.y + g.h + 26); });
  state.connections.forEach(cn => { // inclui as curvas e os rótulos das correntes
    const a = comp(cn.from.c), b = comp(cn.to.c); if (!a || !b) return;
    const m = bez(portGeo(a, cn.from.p), portGeo(b, cn.to.p)).mid;
    x0 = Math.min(x0, m.x - 50); x1 = Math.max(x1, m.x + 50); y0 = Math.min(y0, m.y - 36); y1 = Math.max(y1, m.y + 36);
  });
  const r = svg.getBoundingClientRect(), m = 40;
  if (!r.width) return;
  const k = Math.min(1.6, Math.max(0.25, Math.min((r.width - 2 * m) / (x1 - x0), (r.height - 2 * m) / (y1 - y0))));
  view = { k, x: (r.width - (x1 - x0) * k) / 2 - x0 * k, y: (r.height - (y1 - y0) * k) / 2 - y0 * k };
  renderFlow();
}
svg.addEventListener('pointerdown', e => {
  if (e.button > 0) return;
  const portEl = e.target.closest('[data-port]'), nodeEl = e.target.closest('.node'), linkEl = e.target.closest('[data-link]');
  svg.setPointerCapture(e.pointerId);
  const pt = toWorld(e);
  if (portEl) {
    const cid = portEl.dataset.c, pn = portEl.dataset.port, existing = connAt(cid, pn);
    let anchor;
    if (existing) {
      push();
      state.connections = state.connections.filter(x => x !== existing);
      anchor = existing.from.c === cid && existing.from.p === pn ? { c: existing.to.c, p: existing.to.p } : { c: existing.from.c, p: existing.from.p };
      stale = true;
    } else anchor = { c: cid, p: pn };
    drag = { mode: 'link', anchor, detached: !!existing };
    drawTmp(pt); renderFlow();
  } else if (nodeEl) {
    const c = comp(nodeEl.dataset.id);
    sel = { k: 'c', id: c.id };
    drag = { mode: 'move', c, dx: pt.x - c.x, dy: pt.y - c.y, start: JSON.stringify({ components: state.components, connections: state.connections }), moved: false };
    renderFlow(); renderInsp();
  } else if (linkEl) {
    sel = { k: 'l', id: linkEl.dataset.link }; drag = null; renderFlow(); renderInsp();
  } else {
    if (sel) { sel = null; renderFlow(); renderInsp(); }
    drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
    svg.classList.add('panning');
  }
});
svg.addEventListener('pointermove', e => {
  if (!drag) return;
  if (drag.mode === 'pan') { view.x = drag.vx + e.clientX - drag.sx; view.y = drag.vy + e.clientY - drag.sy; vp.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`); }
  else if (drag.mode === 'move') {
    const pt = toWorld(e), nx = Math.round((pt.x - drag.dx) / 5) * 5, ny = Math.round((pt.y - drag.dy) / 5) * 5;
    if (nx !== drag.c.x || ny !== drag.c.y) {
      if (!drag.moved) { hist.push(drag.start); drag.moved = true; }
      drag.c.x = nx; drag.c.y = ny; renderFlow();
    }
  } else if (drag.mode === 'link') drawTmp(toWorld(e));
});
function drawTmp(pt) {
  const a = comp(drag.anchor.c), g = portGeo(a, drag.anchor.p);
  const opp = { l: 'r', r: 'l', t: 'b', b: 't' }[g.side], io = D[a.type].ports[drag.anchor.p].io;
  const b = { x: pt.x, y: pt.y, side: opp };
  tmp.setAttribute('d', io === 'out' ? bez(g, b).d : bez(b, g).d);
}
function endDrag(e) {
  if (!drag) return;
  svg.classList.remove('panning');
  if (drag.mode === 'move' && drag.moved) markDirty();
  if (drag.mode === 'link') {
    tmp.setAttribute('d', '');
    const el = document.elementFromPoint(e.clientX, e.clientY), pe = el && el.closest && el.closest('[data-port]');
    const A = drag.anchor, pa = D[comp(A.c).type].ports[A.p];
    let made = false;
    if (pe) {
      const B = { c: pe.dataset.c, p: pe.dataset.port }, pb = D[comp(B.c).type].ports[B.p];
      if (B.c === A.c && B.p === A.p) { /* soltou na mesma porta */ }
      else if (pb.io === pa.io) toast(pa.io === 'out' ? 'Ligue uma saída a uma entrada.' : 'Ligue uma entrada a uma saída.');
      else if (B.c === A.c) toast('Não é possível ligar o componente a ele mesmo.');
      else if (connAt(B.c, B.p)) toast('Essa porta já está conectada. Arraste a partir dela para refazer a ligação.');
      else {
        if (!drag.detached) push();
        const from = pa.io === 'out' ? A : B, to = pa.io === 'out' ? B : A;
        state.connections.push({ id: nextLinkId(), from, to });
        made = true;
        const kf = D[comp(from.c).type].ports[from.p].kind, kt = D[comp(to.c).type].ports[to.p].kind;
        if (kf !== 'geral' && kt !== 'geral' && kf !== kt) toast('Atenção: ligação entre porta de vapor e porta de água.');
      }
    }
    if (made || drag.detached) changed(); else renderFlow();
  }
  drag = null;
}
svg.addEventListener('pointerup', endDrag);
svg.addEventListener('pointercancel', endDrag);
svg.addEventListener('dblclick', e => { if (e.target.closest('.node')) { const i = $('#iName'); if (i) { i.focus(); i.select(); } } });
svg.addEventListener('wheel', e => { e.preventDefault(); const r = svg.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
$('#zIn').onclick = () => { const r = svg.getBoundingClientRect(); zoomAt(1.2, r.width / 2, r.height / 2); };
$('#zOut').onclick = () => { const r = svg.getBoundingClientRect(); zoomAt(1 / 1.2, r.width / 2, r.height / 2); };
$('#zFit').onclick = fit;

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveCurrent(); return; }
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || document.querySelector('dialog[open]')) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); delSel(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  else if (e.key === 'Escape') { sel = null; renderAll(); }
});

// Paleta: arrastar para o diagrama ou clicar para inserir no centro
function buildPalette() {
  const list = $('#palList');
  list.innerHTML = PAL_ORDER.map(t => {
    const g = GEOM[t];
    return `<button class="pal-item" data-type="${t}" title="${esc(D[t].name)}">
      <svg viewBox="-4 -4 ${g.w + 8} ${g.h + 8}" aria-hidden="true"><g class="node">${icon(t)}</g></svg><span>${esc(D[t].name)}</span></button>`;
  }).join('');
  list.querySelectorAll('.pal-item').forEach(b => {
    b.addEventListener('pointerdown', e => {
      if (e.button > 0) return;
      e.preventDefault();
      const type = b.dataset.type, g = GEOM[type];
      if (activeView !== 'flow') setView('flow');
      let ghost = null, moved = false;
      const sx = e.clientX, sy = e.clientY;
      const mv = ev => {
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6) {
          moved = true;
          ghost = document.createElement('div'); ghost.className = 'ghost';
          ghost.innerHTML = `<svg width="${g.w * view.k}" height="${g.h * view.k}" viewBox="0 0 ${g.w} ${g.h}" style="overflow:visible"><g class="node">${icon(type)}</g></svg>`;
          document.body.appendChild(ghost);
        }
        if (ghost) { ghost.style.left = ev.clientX + 'px'; ghost.style.top = ev.clientY + 'px'; }
      };
      const up = ev => {
        document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up);
        if (ghost) ghost.remove();
        const r = svg.getBoundingClientRect();
        if (moved) {
          if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) { const pt = toWorld(ev); addComp(type, pt.x - g.w / 2, pt.y - g.h / 2); }
        } else {
          const off = (state.components.length % 6) * 14;
          addComp(type, (r.width / 2 - view.x) / view.k - g.w / 2 + off, (r.height / 2 - view.y) / view.k - g.h / 2 + off);
        }
      };
      document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
    });
  });
}

// ---------------------------------------------------------------------------
// Abas
// ---------------------------------------------------------------------------
function setView(v) {
  activeView = v;
  document.querySelectorAll('.tabs .tab').forEach(b => { b.classList.toggle('active', b.dataset.view === v); b.setAttribute('aria-selected', String(b.dataset.view === v)); });
  document.querySelectorAll('.panel').forEach(p => p.hidden = p.dataset.panel !== v);
  if (v === 'flow') renderFlow();
  if (v === 'prop') drawProp();
  if (v === 'curves') { buildCurveCtrls(); drawCurves(); }
}
document.querySelectorAll('.tabs .tab').forEach(b => b.onclick = () => setView(b.dataset.view));
function refreshViews() { if (activeView === 'prop') drawProp(); if (activeView === 'curves') { buildCurveCtrls(); drawCurves(); } }

// ---------------------------------------------------------------------------
// Diagrama T-s / h-s (Chart.js, gráfico de dispersão com linhas)
// ---------------------------------------------------------------------------
let propChart = null;
function chartColors() {
  return { text: cssVar('--text'), muted: cssVar('--muted'), line: cssVar('--line'), grid: cssVar('--grid'), bg: cssVar('--panel'),
    brass: cssVar('--brass-text'), steam: cssVar('--steam'), water: cssVar('--water'), mix: cssVar('--mix') };
}
const tickFmt = (v, i, ticks) => { const st = ticks.length > 1 ? Math.abs(ticks[1].value - ticks[0].value) : 1; return fmt(v, Math.max(0, -Math.floor(Math.log10(st) + 1e-9))); };
function drawProp() {
  const msg = $('#propMsg'), S = state.settings;
  document.querySelectorAll('.segb').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === S.propMode)));
  $('#pIso').checked = S.iso; $('#pNum').checked = S.nums; $('#pZoom').checked = S.zoom;
  const ok = result && result.ok && !stale;
  msg.hidden = ok;
  if (!ok) msg.textContent = !state.components.length ? 'Monte e calcule um ciclo para ver o diagrama.' : !result ? 'Calcule o ciclo para ver o diagrama.' : stale ? 'O modelo mudou. Calcule o ciclo para atualizar o diagrama.' : 'O ciclo tem problemas a resolver antes de gerar o diagrama. Veja a lista no painel à direita.';
  const C = chartColors(), yk = S.propMode === 'Ts' ? 'T' : 'h', Dm = Engine.dome();
  const pts = ok ? result.streams : [], paths = ok ? Engine.processPaths(engineParams(), result) : [];
  const xy = p => ({ x: p.s, y: p[yk] });
  // Faixas
  let sMin = 0, sMax = 9.4, yMin = 0, yMax = yk === 'T' ? 400 : 3600;
  pts.forEach(p => { sMax = Math.max(sMax, p.s + 0.3); yMax = Math.max(yMax, p[yk] * 1.06); });
  if (S.zoom && pts.length) {
    let base = pts;
    if (yk === 'h') { base = pts.filter(p => p.h > 1800); if (!base.length) base = pts; }
    const ss = base.map(p => p.s), yy = base.map(p => p[yk]);
    sMin = Math.max(0, Math.min(...ss) - 0.4); sMax = Math.max(...ss) + 0.4;
    yMin = Math.max(0, Math.min(...yy) - (yk === 'h' ? 200 : 20)); yMax = Math.max(...yy) + (yk === 'h' ? 120 : 25);
  }
  const ds = [];
  const line = (data, extra) => Object.assign({ data, showLine: true, pointRadius: 0, pointHitRadius: 0, borderWidth: 1.6, borderColor: C.text, fill: false, tension: 0 }, extra);
  const domeStyle = { _k: 'dome', borderColor: C.muted, borderWidth: 1.4 };
  ds.push(line(Dm.L.map(xy), domeStyle), line(Dm.V.map(xy), domeStyle),
    line([Dm.L[Dm.L.length - 1], Dm.C, Dm.V[Dm.V.length - 1]].map(xy), Object.assign({ borderDash: [3, 3] }, domeStyle)));
  const isoLabels = [];
  if (ok && S.iso) {
    const Ps = [...new Set(pts.map(p => +p.P.toPrecision(3)))].filter(P => P < Engine.PMAX_OK).sort((a, b) => a - b).slice(0, 12);
    const Tmax = Math.min(800, Math.max(...pts.map(p => p.T)) + 60);
    Ps.forEach(P => { const ip = Engine.isobar(P, Tmax).map(xy); ds.push(line(ip, { _k: 'iso', borderColor: C.muted, borderWidth: 0.9, borderDash: [4, 3] })); isoLabels.push({ P, pts: ip }); });
  }
  const hlC = sel && sel.k === 'c' ? sel.id : null, hlL = sel && sel.k === 'l' ? sel.id : null;
  paths.forEach(p => ds.push(line(p.pts.map(xy), { _k: 'path', _c: p.c, pointHitRadius: 6, borderColor: p.c === hlC ? C.brass : C.text, borderWidth: p.c === hlC ? 3.6 : (p.exp ? 2.4 : 2) })));
  const colOf = p => ({ vap: C.steam, mix: C.mix, liq: C.water })[phaseKey(p)];
  ds.push({ _k: 'pts', data: pts.map(p => ({ x: p.s, y: p[yk], id: p.id })), showLine: false,
    pointRadius: pts.map(p => p.id === hlL ? 7 : 4.5), pointHoverRadius: 7, pointHitRadius: 6,
    pointBackgroundColor: pts.map(colOf), pointBorderColor: pts.map(p => p.id === hlL ? C.brass : C.bg), pointBorderWidth: pts.map(p => p.id === hlL ? 3 : 1.5) });

  const domePoly = Dm.L.concat([Dm.C], Dm.V.slice().reverse()).map(xy);
  const plugin = {
    id: 'ciclovapProp',
    beforeDatasetsDraw(ch) {
      const { ctx, chartArea: a, scales: { x, y } } = ch;
      ctx.save(); ctx.beginPath(); ctx.rect(a.left, a.top, a.width, a.height); ctx.clip();
      ctx.beginPath();
      domePoly.forEach((p, i) => { const px = x.getPixelForValue(p.x), py = y.getPixelForValue(p.y); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
      ctx.closePath(); ctx.globalAlpha = 0.09; ctx.fillStyle = C.mix; ctx.fill(); ctx.restore();
    },
    afterDatasetsDraw(ch) {
      const { ctx, chartArea: a, scales: { x, y } } = ch;
      ctx.save(); ctx.font = `500 11px ${cssVar('--mono')}`; ctx.textBaseline = 'bottom';
      const used = [];
      isoLabels.forEach(({ P, pts: ip }) => {
        for (let i = ip.length - 1; i >= 0; i--) {
          const px = x.getPixelForValue(ip[i].x), py = y.getPixelForValue(ip[i].y);
          if (px > a.left && px < a.right - 50 && py > a.top + 12 && py < a.bottom - 4) {
            if (!used.some(u => Math.abs(u.x - px) < 50 && Math.abs(u.y - py) < 13)) { used.push({ x: px, y: py }); ctx.fillStyle = C.muted; ctx.fillText(`${fmt(P, P < 1 ? 2 : P < 10 ? 1 : 0)} bar`, px + 4, py - 2); }
            break;
          }
        }
      });
      if (S.nums) {
        ctx.font = `600 11.5px ${cssVar('--mono')}`; ctx.lineWidth = 3; ctx.strokeStyle = C.bg; ctx.fillStyle = C.text;
        pts.forEach(p => {
          const px = x.getPixelForValue(p.s) + 6, py = y.getPixelForValue(p[yk]) - 5;
          if (px < a.left || px > a.right || py < a.top || py > a.bottom) return;
          const t = String(streamNo(p.id)); ctx.strokeText(t, px, py); ctx.fillText(t, px, py);
        });
      }
      if (ch._cross) {
        const { x: cx, y: cy } = ch._cross;
        if (cx >= a.left && cx <= a.right && cy >= a.top && cy <= a.bottom) {
          ctx.setLineDash([2, 3]); ctx.strokeStyle = C.muted; ctx.lineWidth = 0.8;
          ctx.beginPath(); ctx.moveTo(cx, a.top); ctx.lineTo(cx, a.bottom); ctx.moveTo(a.left, cy); ctx.lineTo(a.right, cy); ctx.stroke();
        }
      }
      ctx.restore();
    },
    afterEvent(ch, args) {
      const e = args.event, a = ch.chartArea;
      if (e.type === 'mouseout' || e.x < a.left || e.x > a.right || e.y < a.top || e.y > a.bottom) { ch._cross = null; $('#readout').textContent = ''; }
      else {
        ch._cross = { x: e.x, y: e.y };
        const sv = ch.scales.x.getValueForPixel(e.x), yv = ch.scales.y.getValueForPixel(e.y);
        $('#readout').textContent = `s = ${fmt(sv, 3)} kJ/kg·K   ${yk === 'T' ? `T = ${fmt(yv, 1)} °C` : `h = ${fmt(yv, 0)} kJ/kg`}`;
      }
      args.changed = true;
    }
  };
  const axisTitle = t => ({ display: true, text: t, color: C.text, font: { family: cssVar('--sans'), size: 13 } });
  const axis = (min, max, t) => ({ type: 'linear', min, max, title: axisTitle(t), grid: { color: C.grid }, border: { color: C.line }, ticks: { color: C.muted, callback: tickFmt, includeBounds: false } });
  if (propChart) propChart.destroy();
  propChart = new Chart($('#propCanvas'), {
    type: 'scatter', data: { datasets: ds }, plugins: [plugin],
    options: {
      animation: false, responsive: true, maintainAspectRatio: false, events: ['mousemove', 'mouseout', 'click'],
      interaction: { mode: 'nearest', intersect: true },
      scales: { x: axis(sMin, sMax, 'Entropia s (kJ/kg·K)'), y: axis(yMin, yMax, yk === 'T' ? 'Temperatura T (°C)' : 'Entalpia h (kJ/kg)') },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: it => it.dataset._k === 'pts' || it.dataset._k === 'path',
          callbacks: {
            title: items => {
              const it = items[0];
              if (it.dataset._k === 'path') return comp(it.dataset._c).name;
              const p = result.streamMap[it.raw.id], cn = state.connections.find(c => c.id === p.id);
              return `Corrente ${streamNo(p.id)}: ${comp(cn.from.c).name} para ${comp(cn.to.c).name}`;
            },
            label: it => {
              if (it.dataset._k === 'path') return 'Linha de processo';
              const p = result.streamMap[it.raw.id];
              return [`${fmt(p.P, p.P < 1 ? 3 : 1)} bar, ${fmt(p.T, 1)} °C`, `h = ${fmt(p.h, 1)} kJ/kg, s = ${fmt(p.s, 3)} kJ/kg·K`].concat(p.x != null ? [`x = ${fmt(p.x, 3)}`] : []);
            }
          }
        }
      },
      onClick: (evt, els) => {
        const hit = els.map(e => ({ d: propChart.data.datasets[e.datasetIndex], i: e.index })).sort((a, b) => (a.d._k === 'pts' ? -1 : 1) - (b.d._k === 'pts' ? -1 : 1))[0];
        if (hit && hit.d._k === 'pts') sel = { k: 'l', id: hit.d.data[hit.i].id };
        else if (hit && hit.d._k === 'path') sel = { k: 'c', id: hit.d._c };
        else sel = null;
        renderFlow(); renderInsp(); drawProp();
      }
    }
  });
}
document.querySelectorAll('.segb').forEach(b => b.onclick = () => { state.settings.propMode = b.dataset.mode; markDirty(); drawProp(); });
$('#pIso').onchange = e => { state.settings.iso = e.target.checked; markDirty(); drawProp(); };
$('#pNum').onchange = e => { state.settings.nums = e.target.checked; markDirty(); drawProp(); };
$('#pZoom').onchange = e => { state.settings.zoom = e.target.checked; markDirty(); drawProp(); };

// ---------------------------------------------------------------------------
// Curvas de eficiência (estudo paramétrico: Engine.run() em cada ponto)
// ---------------------------------------------------------------------------
const YOPTS = [
  ['etaCiclo', 'Eficiência do ciclo', '%', v => v * 100], ['etaPlanta', 'Eficiência da planta', '%', v => v * 100],
  ['heatRate', 'Heat rate', 'kJ/kWh', v => v], ['Wliq', 'Potência líquida', 'MW', v => v / 1000],
  ['Wturb', 'Potência das turbinas', 'MW', v => v / 1000], ['Wbomb', 'Consumo das bombas', 'MW', v => v / 1000],
  ['Qcald', 'Calor absorvido na caldeira', 'MW', v => v / 1000], ['Qcomb', 'Calor do combustível', 'MW', v => v / 1000],
  ['Qcond', 'Calor rejeitado no condensador', 'MW', v => v / 1000], ['Qproc', 'Calor útil de processo', 'MW', v => v / 1000],
  ['fue', 'Fator de utilização de energia', '%', v => v * 100]
];
const SOPTS = [['m', 'vazão', 'kg/s'], ['T', 'temperatura', '°C'], ['x', 'título', '–']];
let sweep = { data: null, cfg: null, running: false, sig: null, cancel: false };
let curveChart = null;
const modelSig = () => JSON.stringify(state.components.map(c => [c.id, c.type, c.params])) + JSON.stringify(state.connections);
const r3 = v => +(+v).toPrecision(3);
const parseNum = s => parseFloat(String(s).trim().replace(',', '.'));
function numParams() {
  const out = [];
  state.components.forEach(c => D[c.type].params.forEach(p => {
    if (p.type === 'select' || (p.when && !p.when(c.params))) return;
    out.push({ key: c.id + '|' + p.k, c, p, label: `${c.name}: ${p.label}`, u: p.u === '–' ? '' : p.u });
  }));
  return out;
}
const findParam = key => numParams().find(q => q.key === key);
function yInfo(key) {
  const t = YOPTS.find(o => o[0] === key);
  if (t) return { label: t[1], u: t[2], get: r => r.totals && Number.isFinite(r.totals[t[0]]) ? t[3](r.totals[t[0]]) : NaN };
  const [, id, v] = key.split(':'), so = SOPTS.find(o => o[0] === v);
  return { label: `Corrente ${streamNo(id)}, ${so ? so[1] : v}`, u: so ? so[2] : '', get: r => { const s = r.streams && r.streams[id]; return s && s[v] != null ? s[v] : NaN; } };
}
function buildCurveCtrls() {
  const P = numParams(), sw = state.settings.sweep, cp = $('#cP'), cf = $('#cF'), cy = $('#cY');
  const opt = q => `<option value="${q.key}">${esc(q.label)}${q.u ? ` (${esc(q.u)})` : ''}</option>`;
  cp.innerHTML = P.map(opt).join('');
  cf.innerHTML = `<option value="">Nenhuma (curva única)</option>` + P.map(opt).join('');
  let yh = `<optgroup label="Desempenho do ciclo">${YOPTS.map(o => `<option value="${o[0]}">${esc(o[1])} (${esc(o[2])})</option>`).join('')}</optgroup><optgroup label="Correntes">`;
  state.connections.forEach((cn, i) => {
    const a = comp(cn.from.c), b = comp(cn.to.c); if (!a || !b) return;
    SOPTS.forEach(([k, nm]) => { yh += `<option value="s:${cn.id}:${k}">Corrente ${i + 1} (${esc(a.name)} para ${esc(b.name)}), ${nm}</option>`; });
  });
  cy.innerHTML = yh + '</optgroup>';
  if (!P.find(q => q.key === sw.pk)) { sw.pk = (P.find(q => q.c.type === 'caldeira' && q.p.k === 'P') || P[0] || {}).key || ''; sw.from = sw.to = ''; }
  if (sw.fk && !P.find(q => q.key === sw.fk)) { sw.fk = ''; sw.fv = ''; }
  if (![...cy.options].some(o => o.value === sw.y)) sw.y = 'etaCiclo';
  if (sw.pk && (sw.from === '' || sw.to === '')) setRangeDefaults(sw);
  cp.value = sw.pk; cf.value = sw.fk; cy.value = sw.y;
  $('#cFrom').value = sw.from; $('#cTo').value = sw.to; $('#cN').value = sw.n; $('#cFv').value = sw.fv; $('#cFv').disabled = !sw.fk;
}
function setRangeDefaults(sw) {
  const q = findParam(sw.pk); if (!q) return;
  const v = +q.c.params[q.p.k];
  let a = v * 0.6, b = v * 1.4;
  if (q.p.u === '%') { a = Math.max(v - 15, 1); b = Math.min(v + 10, 100); }
  if (q.p.u === '°C' && /Temperatura/.test(q.p.label)) { a = v - 80; b = v + 60; }
  if (q.p.u === '–') { a = 0; b = Math.min(1, v * 2 || 0.5); }
  if (q.c.type === 'caldeira' && q.p.k === 'P') b = Math.min(b, 160);
  sw.from = r3(a); sw.to = r3(b);
}
function setFamDefaults(sw) {
  const q = findParam(sw.fk); if (!q) { sw.fv = ''; return; }
  const v = +q.c.params[q.p.k];
  const vals = q.p.u === '°C' ? [v - 40, v, v + 40] : q.p.u === '%' ? [v - 5, v, Math.min(100, v + 5)] : [v * 0.8, v, v * 1.2];
  sw.fv = vals.map(r3).map(x => String(x).replace('.', ',')).join('; ');
}
$('#cP').onchange = e => { const sw = state.settings.sweep; sw.pk = e.target.value; setRangeDefaults(sw); buildCurveCtrls(); markDirty(); };
$('#cF').onchange = e => { const sw = state.settings.sweep; sw.fk = e.target.value; setFamDefaults(sw); buildCurveCtrls(); markDirty(); };
$('#cY').onchange = e => { state.settings.sweep.y = e.target.value; markDirty(); drawCurves(); };
['cFrom', 'cTo', 'cN', 'cFv'].forEach(id => $('#' + id).addEventListener('change', e => {
  const sw = state.settings.sweep, k = { cFrom: 'from', cTo: 'to', cN: 'n', cFv: 'fv' }[id];
  sw[k] = id === 'cFv' ? e.target.value : (id === 'cN' ? Math.round(parseNum(e.target.value)) : parseNum(e.target.value));
  markDirty();
}));
$('#cRun').onclick = () => {
  if (sweep.running) { sweep.cancel = true; return; }
  const sw = state.settings.sweep, pk = sw.pk, fk = sw.fk;
  const a = parseNum(sw.from), b = parseNum(sw.to), n = Math.round(parseNum(sw.n));
  if (!pk) { toast('Monte um ciclo com parâmetros numéricos primeiro.'); return; }
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) { toast('Informe um intervalo válido (De e Até diferentes).'); return; }
  if (!(n >= 2 && n <= 60)) { toast('Use entre 2 e 60 pontos.'); return; }
  let fv = [null];
  if (fk) {
    fv = String(sw.fv).split(/[;\s]+/).map(parseNum).filter(Number.isFinite).slice(0, 8);
    if (!fv.length) { toast('Informe os valores da família separados por ponto e vírgula.'); return; }
    if (fk === pk) { toast('A família precisa ser um parâmetro diferente do eixo horizontal.'); return; }
  }
  const base = engineParams(), [pc, pp] = pk.split('|'), [fc, fp] = fk ? fk.split('|') : [];
  const jobs = [];
  fv.forEach((f, si) => { for (let i = 0; i < n; i++) jobs.push({ si, f, x: a + (b - a) * i / (n - 1) }); });
  const data = fv.map(f => ({ f, pts: [] }));
  sweep = { running: true, cancel: false, data: null, cfg: { pk, fk, a, b, n, fv }, sig: modelSig() };
  $('#cRun').textContent = 'Parar';
  let k = 0;
  const step = () => {
    const t0 = performance.now();
    while (k < jobs.length && performance.now() - t0 < 40 && !sweep.cancel) {
      const J = jobs[k++], M = clone(base);
      M.components.find(c => c.id === pc).params[pp] = J.x;
      if (fk) M.components.find(c => c.id === fc).params[fp] = J.f;
      let r; try { r = Engine.run(M); } catch (e) { r = { ok: false }; }
      const streams = {};
      (r.streams || []).forEach(s => streams[s.id] = { m: s.m, T: s.T, x: s.x, P: s.P, h: s.h });
      data[J.si].pts.push({ x: J.x, ok: !!r.ok, totals: r.totals, streams, err: r.ok ? '' : (r.errors && r.errors[0] ? r.errors[0].msg : '') });
    }
    $('#cStat').textContent = `Calculando ${k} de ${jobs.length}…`;
    if (k < jobs.length && !sweep.cancel) { setTimeout(step, 0); return; }
    sweep.running = false; sweep.data = data; $('#cRun').textContent = 'Calcular curvas';
    const bad = data.reduce((s, d) => s + d.pts.filter(p => !p.ok).length, 0);
    $('#cStat').textContent = sweep.cancel ? 'Cálculo interrompido.' : bad ? `${bad} ponto${bad > 1 ? 's' : ''} sem solução válida (lacunas na curva).` : `${jobs.length} pontos calculados.`;
    drawCurves();
  };
  step();
};
function drawCurves() {
  const msg = $('#curveMsg'), tb = $('#cTable');
  if (curveChart) { curveChart.destroy(); curveChart = null; }
  if (!sweep.data) {
    tb.innerHTML = ''; msg.hidden = false;
    msg.textContent = state.components.length ? 'Escolha o parâmetro a variar e clique em Calcular curvas. Use a família de curvas para comparar, por exemplo, várias temperaturas de vapor.' : 'Monte um ciclo para gerar curvas paramétricas.';
    return;
  }
  const cfg = sweep.cfg, Y = yInfo(state.settings.sweep.y), qx = findParam(cfg.pk), qf = cfg.fk ? findParam(cfg.fk) : null, C = chartColors();
  const xl = qx ? `${qx.label}${qx.u ? ` (${qx.u})` : ''}` : 'Parâmetro';
  const yl = `${Y.label}${Y.u && Y.u !== '–' ? ` (${Y.u})` : ''}`;
  const series = sweep.data.map((d, i) => ({
    name: qf ? `${qf.p.label} = ${fmt(d.f, Number.isInteger(d.f) ? 0 : 2)}${qf.u ? ' ' + qf.u : ''}` : Y.label,
    col: cssVar(`--s${(i % 6) + 1}`),
    pts: d.pts.map(p => ({ x: p.x, y: p.ok ? Y.get(p) : NaN, err: p.err }))
  }));
  const any = series.some(se => se.pts.some(p => Number.isFinite(p.y)));
  msg.hidden = any;
  if (!any) { tb.innerHTML = ''; msg.textContent = 'Nenhum ponto teve solução válida para essa grandeza. Reduza o intervalo ou confira as especificações.'; return; }
  const ds = series.map(se => ({ label: se.name, data: se.pts.map(p => ({ x: p.x, y: Number.isFinite(p.y) ? p.y : null })), showLine: true, spanGaps: false,
    borderColor: se.col, backgroundColor: se.col, borderWidth: 2.2, pointRadius: 3, tension: 0 }));
  const showCur = result && result.ok && !stale && sweep.sig === modelSig() && qx;
  if (showCur) {
    const cx = +qx.c.params[qx.p.k], cyv = Y.get({ totals: result.totals, streams: result.streamMap });
    const inFam = !qf || cfg.fv.some(f => Math.abs(f - qf.c.params[qf.p.k]) < 1e-9);
    if (Number.isFinite(cyv) && inFam) ds.push({ label: 'Ponto atual do modelo', data: [{ x: cx, y: cyv }], showLine: false, pointRadius: 7, pointHoverRadius: 8, pointBorderWidth: 2.5, borderColor: C.brass, backgroundColor: 'transparent', pointStyle: 'circle' });
  }
  const axisTitle = t => ({ display: true, text: t, color: C.text, font: { family: cssVar('--sans'), size: 13 } });
  curveChart = new Chart($('#curveCanvas'), {
    type: 'scatter', data: { datasets: ds },
    options: {
      animation: false, responsive: true, maintainAspectRatio: false,
      scales: {
        x: { type: 'linear', min: Math.min(cfg.a, cfg.b), max: Math.max(cfg.a, cfg.b), title: axisTitle(xl), grid: { color: C.grid }, border: { color: C.line }, ticks: { color: C.muted, callback: tickFmt, includeBounds: false } },
        y: { title: axisTitle(yl), grid: { color: C.grid }, border: { color: C.line }, ticks: { color: C.muted, callback: tickFmt } }
      },
      plugins: {
        legend: { position: 'top', align: 'start', labels: { color: C.text, usePointStyle: true, boxHeight: 6, font: { family: cssVar('--sans'), size: 12.5 } } },
        tooltip: { callbacks: { label: it => `${it.dataset.label}: ${fmt(it.raw.y, 3)} ${Y.u === '–' ? '' : Y.u}`, title: items => `${xl}: ${fmt(items[0].raw.x, 3)}` } }
      }
    }
  });
  const ymax = Math.max(...series.flatMap(se => se.pts.map(p => Math.abs(p.y))).filter(Number.isFinite));
  const dec = ymax >= 1000 ? 0 : ymax >= 100 ? 1 : ymax >= 10 ? 2 : 3;
  let h = `<div class="table-head"><span class="hint-inline">${esc(yl)}${sweep.sig !== modelSig() ? '. O modelo mudou desde este cálculo.' : ''}</span><button class="btn" id="cCopy">Copiar tabela</button></div>`;
  h += `<div class="table-scroll"><table><thead><tr><th>${esc(xl)}</th>${series.map(se => `<th>${esc(qf ? se.name : Y.label)}</th>`).join('')}</tr></thead><tbody>`;
  for (let i = 0; i < cfg.n; i++) h += `<tr><td>${fmt(series[0].pts[i].x, 3)}</td>${series.map(se => { const p = se.pts[i]; return `<td${p && p.err ? ` title="${esc(p.err)}"` : ''}>${p && Number.isFinite(p.y) ? fmt(p.y, dec) : '–'}</td>`; }).join('')}</tr>`;
  tb.innerHTML = h + '</tbody></table></div>';
  $('#cCopy').onclick = async () => {
    const rows = [[xl, ...series.map(se => qf ? se.name : Y.label)]];
    for (let i = 0; i < cfg.n; i++) rows.push([series[0].pts[i].x, ...series.map(se => Number.isFinite(se.pts[i].y) ? se.pts[i].y : '')].map(v => typeof v === 'number' ? String(+v.toPrecision(8)).replace('.', ',') : v));
    try { await navigator.clipboard.writeText(rows.map(r => r.join('\t')).join('\n')); toast('Tabela copiada. Cole no Excel.'); }
    catch (e) { toast('Não foi possível acessar a área de transferência.'); }
  };
}

// ---------------------------------------------------------------------------
// Barra do app (abaixo da hubnav)
// ---------------------------------------------------------------------------
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3000); }
function loadExample(key) {
  if (state.components.length && !confirm('Substituir o diagrama atual pelo exemplo? Você pode desfazer depois.')) return;
  push();
  const ex = EXAMPLES[key].build();
  state.components = ex.components; state.connections = ex.connections;
  sel = null; result = null; sweep = { data: null, cfg: null, running: false, sig: null, cancel: false };
  state.settings.sweep = DEFAULT_SETTINGS().sweep;
  markDirty(); renderAll(); setTimeout(fit, 0); recalc();
}
const exSel = $('#ex');
Object.entries(EXAMPLES).forEach(([k, v]) => { const o = document.createElement('option'); o.value = k; o.textContent = v.title; exSel.appendChild(o); });
exSel.onchange = () => { if (exSel.value) loadExample(exSel.value); exSel.value = ''; };
$('#lbl').onchange = e => { state.settings.labelMode = e.target.value; markDirty(); renderFlow(); };
$('#bCalc').onclick = recalc;
$('#auto').onchange = e => { if (e.target.checked) recalc(); };
$('#bUndo').onclick = undo;
$('#bClear').onclick = () => {
  if (!state.components.length) return;
  if (!confirm('Apagar todo o diagrama? Você pode desfazer depois.')) return;
  push(); state.components = []; state.connections = []; sel = null; result = null; changed();
};

// =============================================================================
// Integração com o hub: tema, usuário, projetos (Abrir / Salvar / Salvar como)
// -----------------------------------------------------------------------------
// ATENÇÃO: o ARCHITECTURE.md manda copiar buildProjectData, applyProjectData,
// openFileBrowser/fbList/fbConfirm, saveCurrent e wireProjectToolbar do
// public/apps/peval/ui.js "quase literalmente". Aquele arquivo não estava
// disponível na adaptação, então este bloco foi escrito a partir da descrição
// da API no ARCHITECTURE.md e lê as respostas de forma tolerante. Se algo não
// casar com o servidor real, substitua este bloco pelas funções do PEVAL
// (trocando só o APP_ID) — o resto do app só usa buildProjectData() e
// applyProjectData().
// =============================================================================
function buildProjectData() {
  return { appId: APP_ID, version: 1, name: project.name || 'Sem título', savedAt: new Date().toISOString(), state: clone(state) };
}
function applyProjectData(data) {
  if (!data || typeof data !== 'object' || !data.state) throw new Error('arquivo sem o campo "state"');
  if (data.appId && data.appId !== APP_ID && !confirm(`Este arquivo foi salvo pelo app "${data.appId}", não pelo CICLOVAP. Tentar abrir mesmo assim?`)) return false;
  const st = data.state;
  const comps = Array.isArray(st.components) ? st.components.filter(c => D[c.type]) : [];
  comps.forEach(c => { const p = {}; D[c.type].params.forEach(q => p[q.k] = q.v); c.params = Object.assign(p, c.params || {}); c.x = +c.x || 0; c.y = +c.y || 0; c.flip = !!c.flip; });
  const ids = new Set(comps.map(c => c.id));
  const conns = Array.isArray(st.connections) ? st.connections.filter(cn => cn && cn.from && cn.to && ids.has(cn.from.c) && ids.has(cn.to.c)) : [];
  const settings = Object.assign(DEFAULT_SETTINGS(), st.settings || {});
  settings.sweep = Object.assign(DEFAULT_SETTINGS().sweep, (st.settings && st.settings.sweep) || {});
  state = { components: comps, connections: conns, settings };
  project.name = data.name || '';
  hist = []; sel = null; result = null; stale = true;
  sweep = { data: null, cfg: null, running: false, sig: null, cancel: false };
  $('#lbl').value = settings.labelMode;
  return true;
}
function renderProjectName() {
  const el = $('#projName');
  el.textContent = (project.name || 'Sem título') + (project.dirty ? ' •' : '');
  el.title = project.path ? project.path : 'Projeto ainda não salvo';
}
async function api(url, opts) {
  const r = await fetch(url, Object.assign({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }, opts || {}));
  if (r.status === 401) { toast('Sessão expirada. Faça login novamente.'); setTimeout(() => { location.href = '/'; }, 1200); throw new Error('não autenticado'); }
  let body = null; const txt = await r.text();
  try { body = txt ? JSON.parse(txt) : null; } catch (e) { body = txt; }
  if (!r.ok) { const err = new Error((body && (body.error || body.message)) || `erro ${r.status}`); err.status = r.status; throw err; }
  return body;
}
const joinPath = (a, b) => [a, b].filter(Boolean).join('/').replace(/\/+/g, '/');
const fb = { mode: 'open', path: '', selected: null };
function openFileBrowser(mode) {
  fb.mode = mode; fb.selected = null;
  const startDir = project.path ? project.path.split('/').slice(0, -1).join('/') : fb.path;
  $('#fbTitle').textContent = mode === 'open' ? 'Abrir projeto' : 'Salvar projeto como';
  $('#fbOk').textContent = mode === 'open' ? 'Abrir' : 'Salvar';
  $('#fbSaveRow').hidden = mode === 'open';
  $('#fbName').value = mode === 'saveas' ? (project.name || 'ciclo') + '.json' : '';
  $('#fbDlg').showModal();
  fbList(startDir || '');
}
async function fbList(path) {
  const list = $('#fbList');
  list.innerHTML = '<div class="fb-empty">Carregando…</div>';
  try {
    const j = await api('/api/browse?path=' + encodeURIComponent(path || ''));
    const dirs = [], files = [];
    const arr = Array.isArray(j) ? j : (j && (j.entries || j.items || j.list));
    if (arr) arr.forEach(e => {
      const name = typeof e === 'string' ? e : e.name;
      const isDir = typeof e === 'object' && (e.type === 'dir' || e.type === 'directory' || e.type === 'folder' || e.isDir || e.isDirectory || e.dir === true);
      (isDir ? dirs : files).push(name);
    });
    else if (j) {
      (j.dirs || j.folders || j.directories || []).forEach(d => dirs.push(typeof d === 'string' ? d : d.name));
      (j.files || []).forEach(f => files.push(typeof f === 'string' ? f : f.name));
    }
    fb.path = (j && typeof j.path === 'string') ? j.path.replace(/^\/+/, '') : (path || '');
    renderFb(dirs.sort((a, b) => a.localeCompare(b)), files.filter(f => /\.json$/i.test(f)).sort((a, b) => a.localeCompare(b)));
  } catch (e) { list.innerHTML = `<div class="fb-empty">Não foi possível listar a pasta: ${esc(e.message)}</div>`; }
}
function renderFb(dirs, files) {
  const parts = fb.path ? fb.path.split('/') : [];
  $('#fbPath').innerHTML = `<button class="crumb" data-p="">Projetos</button>` + parts.map((p, i) => `<span>/</span><button class="crumb" data-p="${esc(parts.slice(0, i + 1).join('/'))}">${esc(p)}</button>`).join('');
  $('#fbPath').querySelectorAll('.crumb').forEach(b => b.onclick = () => fbList(b.dataset.p));
  let h = '';
  if (fb.path) h += `<button class="fb-item dir" data-up="1">📁 ..</button>`;
  h += dirs.map(d => `<button class="fb-item dir" data-dir="${esc(d)}">📁 ${esc(d)}</button>`).join('');
  h += files.map(f => `<button class="fb-item file${fb.selected === f ? ' sel' : ''}" data-file="${esc(f)}">📄 ${esc(f)}</button>`).join('');
  if (!dirs.length && !files.length) h += `<div class="fb-empty">Pasta vazia.</div>`;
  const list = $('#fbList'); list.innerHTML = h;
  list.querySelectorAll('[data-up]').forEach(b => b.onclick = () => fbList(fb.path.split('/').slice(0, -1).join('/')));
  list.querySelectorAll('[data-dir]').forEach(b => b.onclick = () => fbList(joinPath(fb.path, b.dataset.dir)));
  list.querySelectorAll('[data-file]').forEach(b => {
    b.onclick = () => { fb.selected = b.dataset.file; if (fb.mode === 'saveas') $('#fbName').value = fb.selected; list.querySelectorAll('.file').forEach(x => x.classList.toggle('sel', x === b)); };
    b.ondblclick = () => { fb.selected = b.dataset.file; if (fb.mode === 'saveas') $('#fbName').value = fb.selected; fbConfirm(); };
  });
}
async function fbConfirm() {
  if (fb.mode === 'open') {
    if (!fb.selected) { toast('Selecione um arquivo.'); return; }
    const path = joinPath(fb.path, fb.selected);
    try {
      let data = await api('/api/file?path=' + encodeURIComponent(path));
      if (data && data.content !== undefined && !data.state) data = data.content;
      if (typeof data === 'string') data = JSON.parse(data);
      if (typeof data === 'string') data = JSON.parse(data);
      if (!applyProjectData(data)) return;
      project.path = path; if (!project.name) project.name = fb.selected.replace(/\.json$/i, '');
      $('#fbDlg').close(); markDirty(false);
      renderAll(); setTimeout(fit, 0); recalc(); markDirty(false);
      toast('Projeto aberto.');
    } catch (e) { toast('Não foi possível abrir: ' + e.message); }
  } else {
    let name = $('#fbName').value.trim();
    if (!name) { toast('Informe o nome do arquivo.'); return; }
    if (!/\.json$/i.test(name)) name += '.json';
    if (/[\\/]/.test(name)) { toast('O nome não pode conter barras. Navegue até a pasta desejada.'); return; }
    const path = joinPath(fb.path, name), prevName = project.name;
    project.name = name.replace(/\.json$/i, '');
    try { await writeProject(path, false); }
    catch (e) {
      if (e.status === 409 || /exist/i.test(e.message)) {
        if (!confirm(`"${name}" já existe nesta pasta. Substituir?`)) { project.name = prevName; return; }
        try { await writeProject(path, true); } catch (e2) { project.name = prevName; toast('Não foi possível salvar: ' + e2.message); return; }
      } else { project.name = prevName; toast('Não foi possível salvar: ' + e.message); return; }
    }
    project.path = path; $('#fbDlg').close(); markDirty(false); toast('Projeto salvo.');
  }
}
async function writeProject(path, overwrite) {
  await api('/api/file', { method: 'POST', body: JSON.stringify({ path, content: buildProjectData(), overwrite }) });
}
async function saveCurrent() {
  if (!project.path) { openFileBrowser('saveas'); return; }
  try { await writeProject(project.path, true); markDirty(false); toast('Projeto salvo.'); }
  catch (e) { toast('Não foi possível salvar: ' + e.message); }
}
function wireProjectToolbar() {
  $('#btnOpen').onclick = () => {
    if (project.dirty && state.components.length && !confirm('Há alterações não salvas. Abrir outro projeto mesmo assim?')) return;
    openFileBrowser('open');
  };
  $('#btnSave').onclick = saveCurrent;
  $('#btnSaveAs').onclick = () => openFileBrowser('saveas');
  $('#fbCancel').onclick = () => $('#fbDlg').close();
  $('#fbOk').onclick = fbConfirm;
  $('#fbName').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); fbConfirm(); } });
  $('#fbMkdir').onclick = async () => {
    const n = prompt('Nome da nova pasta:');
    if (!n || !n.trim()) return;
    if (/[\\/]/.test(n)) { toast('O nome da pasta não pode conter barras.'); return; }
    try { await api('/api/mkdir', { method: 'POST', body: JSON.stringify({ path: joinPath(fb.path, n.trim()) }) }); fbList(joinPath(fb.path, n.trim())); }
    catch (e) { toast('Não foi possível criar a pasta: ' + e.message); }
  };
  $('#btnLogout').onclick = async () => {
    if (project.dirty && state.components.length && !confirm('Há alterações não salvas. Sair mesmo assim?')) return;
    project.dirty = false;
    try { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); } catch (e) { }
    location.href = '/';
  };
  $('#themeBtn').onclick = () => {
    const cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', cur);
    try { localStorage.setItem('hub-theme', cur); } catch (e) { }
    refreshViews();
  };
  window.addEventListener('beforeunload', e => { if (project.dirty && state.components.length) { e.preventDefault(); e.returnValue = ''; } });
  fetch('/api/whoami', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).then(j => {
    if (!j) return;
    const u = typeof j === 'string' ? j : (j.user && (j.user.name || j.user.username || j.user)) || j.username || j.name || '';
    $('#hubUser').textContent = typeof u === 'string' ? u : '';
  }).catch(() => { });
}

// ---------------------------------------------------------------------------
// Início: app em branco (sem exemplo pré-carregado)
// ---------------------------------------------------------------------------
buildPalette();
wireProjectToolbar();
renderProjectName();
renderAll();
let rzT;
const ro = new ResizeObserver(() => { clearTimeout(rzT); rzT = setTimeout(() => { if (activeView === 'flow') renderFlow(); }, 60); });
ro.observe(svg);
})();
