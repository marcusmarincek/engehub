// ============================================================================
// INTERFACE — formulário, abas, gráficos e tabela
// ============================================================================
(function () {
  const CHART_COLORS = ['#5B8DB8', '#C08A3E', '#6FA97A', '#B47FC0'];
  const GRID = 'rgba(255,255,255,0.06)';
  const TICK = '#9AA4B2';

  Chart.defaults.color = TICK;
  Chart.defaults.font.family = "'IBM Plex Mono', monospace";
  Chart.defaults.font.size = 11;

  // ---------------- Estado ----------------
  let state = {
    Pvb: '', Tv: '', Pab: '', gama: '', DN: '',
    padf: 'N', Hstmax: '', GstTotal: '', PzstTotal: '', PotstTotal: '',
    tipo: '', os: '', cliente: '',
    valves: [
      { Hst: '', Fmin: '', D1: '', D2: '', R: '', Dhas: '', Di: '', ns: 2, alfar: ['', ''], pr: ['', ''] }
    ]
  };
  let result = null;
  let charts = {};

  function v(x) { return (x === '' || x === null || x === undefined) ? '' : x; }

  // ---------------- Formulário (sidebar) ----------------
  function renderSidebar() {
    const el = document.getElementById('sidebar');
    const PvbNum = parseFloat(state.Pvb), TvNum = parseFloat(state.Tv);
    const haveSteamInputs = !isNaN(PvbNum) && !isNaN(TvNum) && PvbNum > 0;
    const steamNow = haveSteamInputs ? Engine.steamSpecificVolume(PvbNum, TvNum) : null;
    el.innerHTML = `
      <div class="brand">
        <div class="mark">PV</div>
        <h1>PEVAL</h1>
      </div>
      <div class="sub">Perfil e desempenho de válvulas de regulagem</div>

      <div class="field-group">
        <h2>Identificação</h2>
        <div class="row">
          <div><label>Turbina</label><input type="text" id="f-tipo" value="${v(state.tipo)}"></div>
          <div><label>OS</label><input type="text" id="f-os" value="${v(state.os)}"></div>
        </div>
        <div><label>Cliente</label><input type="text" id="f-cliente" value="${v(state.cliente)}"></div>
      </div>

      <div class="field-group">
        <h2>Condições de vapor</h2>
        <div class="row">
          <div><label>Pressão vivo P<sub>v</sub> <span class="unit">(bar)</span></label><input type="number" step="0.01" id="f-pvb" value="${v(state.Pvb)}"></div>
          <div><label>Temperatura T<sub>v</sub> <span class="unit">(°C)</span></label><input type="number" step="0.1" id="f-tv" value="${v(state.Tv)}"></div>
        </div>
        <div class="row">
          <div><label>Pressão de escape P<sub>a</sub> <span class="unit">(bar)</span></label><input type="number" step="0.01" id="f-pab" value="${v(state.Pab)}"></div>
          <div><label>Razão de calores γ</label><input type="number" step="0.01" id="f-gama" value="${v(state.gama)}" placeholder="ex.: 1.3"></div>
        </div>
        <div class="row">
          <div><label>Ø tubulação D<sub>N</sub> <span class="unit">(mm)</span></label><input type="number" step="1" id="f-dn" value="${v(state.DN)}"></div>
          <div><label>Padrão de forças</label>
            <select id="f-padf">
              <option value="N" ${state.padf === 'N' ? 'selected' : ''}>N — duplo assento</option>
              <option value="Z" ${state.padf === 'Z' ? 'selected' : ''}>Z — Curtis (simples)</option>
            </select>
          </div>
        </div>
        <div class="row">
          <div>
            <label>Vol. específico V<sub>v</sub> <span class="unit">(m³/kg, IAPWS-97)</span></label>
            <input type="text" class="mono" id="f-vv-display" value="${steamNow ? steamNow.v.toFixed(6) : '—'}" readonly style="opacity:.75;">
          </div>
        </div>
        ${steamNow && steamNow.warning ? `<div class="hint" style="color:var(--amber);">${steamNow.warning}</div>` : `<div class="hint">V<sub>v</sub> é calculado automaticamente pela IAPWS-IF97 (Região 2, vapor superaquecido) a partir de P<sub>v</sub> e T<sub>v</sub>.</div>`}
      </div>

      <div class="field-group">
        <h2>Referência de projeto (curva de consumo)</h2>
        <div class="row">
          <div><label>Curso máx. H<sub>stmax</sub> <span class="unit">(mm)</span></label><input type="number" step="0.1" id="f-hstmax" value="${v(state.Hstmax)}"></div>
        </div>
        <div class="row">
          <div><label>G<sub>st</sub> total <span class="unit">(kg/h)</span></label><input type="number" step="1" id="f-gsttotal" value="${v(state.GstTotal)}"></div>
        </div>
        <div class="row">
          <div><label>Pz<sub>st</sub> total <span class="unit">(bar)</span></label><input type="number" step="0.001" id="f-pzsttotal" value="${v(state.PzstTotal)}"></div>
          <div><label>Pot<sub>st</sub> total <span class="unit">(kW)</span></label><input type="number" step="1" id="f-potsttotal" value="${v(state.PotstTotal)}"></div>
        </div>
        <div class="hint">Um único ponto de referência (vazão, pressão de câmara e potência nominais, geralmente na abertura plena). A vazão, pressão de câmara e potência de cada válvula são calculadas a partir da área de injetores (F<sub>min</sub>) de cada uma — não são mais dados de entrada.</div>
      </div>

      <div class="field-group" id="valves-group">
        <h2>Válvulas de regulagem</h2>
        <div id="valve-cards"></div>
        <button class="btn" id="btn-add-valve">+ adicionar válvula</button>
      </div>

      <button class="btn-primary" id="btn-calc">Calcular desempenho</button>

    `;
    renderValveCards();

    document.getElementById('btn-add-valve').onclick = () => {
      state.valves.push({ Hst: '', Fmin: '', D1: '', D2: '', R: '', Dhas: '', Di: '', ns: 2, alfar: ['', ''], pr: ['', ''] });
      renderValveCards();
    };
    document.getElementById('btn-calc').onclick = () => { readForm(); recalc(); };
    document.getElementById('f-pvb').addEventListener('change', () => { readForm(); renderSidebar(); });
    document.getElementById('f-tv').addEventListener('change', () => { readForm(); renderSidebar(); });
  }

  function renderValveCards() {
    const wrap = document.getElementById('valve-cards');
    wrap.innerHTML = state.valves.map((v, idx) => `
      <div class="valve-card" data-idx="${idx}">
        <div class="valve-card-head">
          <h3>Válvula ${idx + 1}</h3>
          ${state.valves.length > 1 ? `<button class="icon-btn" data-remove="${idx}" title="Remover">✕</button>` : ''}
        </div>
        <div class="row">
          <div><label>H<sub>st</sub> abertura <span class="unit">(mm)</span></label><input type="number" step="0.1" class="v-field" data-k="Hst" data-idx="${idx}" value="${v.Hst}"></div>
          <div><label>F<sub>min</sub> injetores <span class="unit">(mm²)</span></label><input type="number" step="0.1" class="v-field" data-k="Fmin" data-idx="${idx}" value="${v.Fmin}"></div>
        </div>
        <div class="hint" style="margin:-4px 0 8px;">Vazão, pressão de câmara e potência desta válvula são calculadas a partir de F<sub>min</sub> — não são dados de entrada.</div>
        <div class="row">
          <div><label>Raio de arredond. R <span class="unit">(mm)</span></label><input type="number" step="0.1" class="v-field" data-k="R" data-idx="${idx}" value="${v.R}"></div>
        </div>
        <div class="section-block">
          <div class="row">
            <div><label>Ø cesto D1 <span class="unit">(mm)</span></label><input type="number" step="0.1" class="v-field" data-k="D1" data-idx="${idx}" value="${v.D1}"></div>
            <div><label>Ø cesto D2 <span class="unit">(mm)</span></label><input type="number" step="0.1" class="v-field" data-k="D2" data-idx="${idx}" value="${v.D2}"></div>
          </div>
          <div class="row">
            <div><label>Ø haste <span class="unit">(mm)</span></label><input type="number" step="0.1" class="v-field" data-k="Dhas" data-idx="${idx}" value="${v.Dhas}"></div>
            <div><label>Ø haste interna Di <span class="unit">(mm)</span></label><input type="number" step="0.1" class="v-field" data-k="Di" data-idx="${idx}" value="${v.Di}"></div>
          </div>
        </div>
        <div class="section-block">
          <label>Nº de seções do cone</label>
          <select class="v-field" data-k="ns" data-idx="${idx}">
            ${[1, 2, 3].map(x => `<option value="${x}" ${v.ns === x ? 'selected' : ''}>${x}</option>`).join('')}
          </select>
          ${v.alfar.map((a, j) => `
            <div class="row" style="margin-top:6px;">
              <div><label>α${j + 1} <span class="unit">(graus)</span></label><input type="number" step="0.01" class="v-sec" data-arr="alfar" data-j="${j}" data-idx="${idx}" value="${a}"></div>
              <div><label>p${j + 1} <span class="unit">(mm)</span></label><input type="number" step="0.01" class="v-sec" data-arr="pr" data-j="${j}" data-idx="${idx}" value="${v.pr[j]}"></div>
            </div>`).join('')}
        </div>
      </div>
    `).join('');

    wrap.querySelectorAll('[data-remove]').forEach(btn => {
      btn.onclick = () => { state.valves.splice(parseInt(btn.dataset.remove), 1); readForm(false); renderValveCards(); };
    });
    wrap.querySelectorAll('select.v-field[data-k="ns"]').forEach(sel => {
      sel.onchange = () => {
        const idx = parseInt(sel.dataset.idx);
        const newNs = parseInt(sel.value);
        const v = state.valves[idx];
        while (v.alfar.length < newNs) { v.alfar.push(18); v.pr.push(v.pr[v.pr.length - 1] + 3 || 10); }
        v.alfar.length = newNs; v.pr.length = newNs; v.ns = newNs;
        renderValveCards();
      };
    });
  }

  function readForm(readTop = true) {
    if (readTop) {
      state.tipo = document.getElementById('f-tipo').value;
      state.os = document.getElementById('f-os').value;
      state.cliente = document.getElementById('f-cliente').value;
      state.Pvb = parseFloat(document.getElementById('f-pvb').value);
      state.Tv = parseFloat(document.getElementById('f-tv').value);
      state.Pab = parseFloat(document.getElementById('f-pab').value);
      state.gama = parseFloat(document.getElementById('f-gama').value);
      state.DN = parseFloat(document.getElementById('f-dn').value);
      state.padf = document.getElementById('f-padf').value;
      state.Hstmax = parseFloat(document.getElementById('f-hstmax').value);
      state.GstTotal = parseFloat(document.getElementById('f-gsttotal').value);
      state.PzstTotal = parseFloat(document.getElementById('f-pzsttotal').value);
      state.PotstTotal = parseFloat(document.getElementById('f-potsttotal').value);
    }
    document.querySelectorAll('.v-field[data-k]').forEach(inp => {
      const idx = parseInt(inp.dataset.idx), k = inp.dataset.k;
      if (k === 'ns') return;
      state.valves[idx][k] = parseFloat(inp.value);
    });
    document.querySelectorAll('.v-sec').forEach(inp => {
      const idx = parseInt(inp.dataset.idx), arr = inp.dataset.arr, j = parseInt(inp.dataset.j);
      state.valves[idx][arr][j] = parseFloat(inp.value);
    });
  }

  function validateState() {
    const missing = [];
    const req = [
      ['Pvb', 'Pressão vivo (Pv)'], ['Tv', 'Temperatura vivo (Tv)'], ['Pab', 'Pressão de escape (Pa)'],
      ['gama', 'Razão de calores (γ)'], ['DN', 'Diâmetro da tubulação (DN)'], ['Hstmax', 'Curso máximo (Hstmax)'],
      ['GstTotal', 'Gst total'], ['PzstTotal', 'Pzst total'], ['PotstTotal', 'Potst total']
    ];
    req.forEach(([k, label]) => { if (isNaN(state[k]) || state[k] === '' || state[k] === null) missing.push(label); });
    state.valves.forEach((val, idx) => {
      ['Hst', 'Fmin', 'D1', 'D2', 'R', 'Dhas', 'Di'].forEach(k => {
        if (isNaN(val[k]) || val[k] === '' || val[k] === null) missing.push(`Válvula ${idx + 1} — ${k}`);
      });
      val.alfar.forEach((a, j) => { if (isNaN(a) || a === '') missing.push(`Válvula ${idx + 1} — α${j + 1}`); });
      val.pr.forEach((p, j) => { if (isNaN(p) || p === '') missing.push(`Válvula ${idx + 1} — p${j + 1}`); });
    });
    return missing;
  }

  // ---------------- Cálculo ----------------
  function recalc() {
    const notices = document.getElementById('notices');
    notices.innerHTML = '';

    const missing = validateState();
    if (missing.length) {
      notices.innerHTML = `<div class="notice error"><strong>Preencha os campos antes de calcular:</strong> ${missing.join(', ')}.</div>`;
      renderEmptyState();
      return;
    }

    try {
      result = Engine.run({
        Pvb: state.Pvb, Tv: state.Tv, Pab: state.Pab, gama: state.gama, DN: state.DN,
        padf: state.padf, Hstmax: state.Hstmax, GstTotal: state.GstTotal, PzstTotal: state.PzstTotal, PotstTotal: state.PotstTotal,
        valves: state.valves
      });
    } catch (e) {
      notices.innerHTML = `<div class="notice error"><strong>Erro no cálculo:</strong> ${e.message}. Confira os dados de entrada (áreas, aberturas e razões de pressão devem ser fisicamente consistentes).</div>`;
      console.error(e);
      return;
    }
    document.getElementById('hdr-tipo').textContent = state.tipo || '—';
    document.getElementById('hdr-os').textContent = state.os || '—';
    document.getElementById('hdr-cliente').textContent = state.cliente || '—';

    if (result.warnings.length) {
      notices.innerHTML = `<div class="notice error"><strong>Avisos:</strong> ${result.warnings.join('; ')}</div>`;
    }

    renderResumo();
    renderVazao();
    renderPressao();
    renderConsumo();
    renderPerfil();
    renderForcas();
    renderTabela();
  }

  // ---------------- Resumo ----------------
  function renderResumo() {
    const r = result;
    const el = document.getElementById('panel-resumo');
    const potMax = Math.max(...Object.values(r.Pot).filter(x => x !== undefined));
    el.innerHTML = `
      <div class="card-grid">
        <div class="stat-card"><div class="label">Vazão máxima</div><div class="value">${fmt(r.Gt[r.ifora], 0)}<span class="unit">kg/h</span></div></div>
        <div class="stat-card"><div class="label">Pressão de câmara</div><div class="value">${fmt(r.Pz[r.ifora], 2)}<span class="unit">bar</span></div></div>
        <div class="stat-card"><div class="label">Potência máxima</div><div class="value">${fmt(potMax, 0)}<span class="unit">kW</span></div></div>
        <div class="stat-card"><div class="label">Velocidade máx. na tubulação</div><div class="value">${fmt(r.velm, 1)}<span class="unit">m/s</span></div></div>
        <div class="stat-card"><div class="label">Curso total percorrido</div><div class="value">${fmt(r.ifora, 0)}<span class="unit">mm</span></div></div>
        <div class="stat-card"><div class="label">Válvulas em operação</div><div class="value">${r.kv}<span class="unit">de ${r.n}</span></div></div>
      </div>
      <div class="chart-box">
        <h3>Sequência de abertura e vazão calculada por válvula</h3>
        <p class="desc">Curso em que cada válvula inicia a abertura, e sua vazão/pressão máximas — calculadas a partir da área de injetores (F<sub>min</sub>), não informadas manualmente.</p>
        <div class="table-scroll" style="max-height:220px;">
          <table>
            <thead><tr><th>Válvula</th><th>Abre em (mm)</th><th>F<sub>min</sub> (mm²)</th><th>Vazão máx. calc. (kg/h)</th><th>Pd máx. calc. (bar)</th></tr></thead>
            <tbody>${state.valves.map((v, idx) => {
              const k = idx + 1;
              const gMax = r.G[k] ? Math.max(...Object.values(r.G[k]).filter(x => x !== undefined)) : 0;
              const pdMax = r.Pd[k] ? Math.max(...Object.values(r.Pd[k]).filter(x => x !== undefined)) : 0;
              return `<tr><td>Válvula ${k}</td><td>${fmt(v.Hst, 1)}</td><td>${fmt(v.Fmin, 1)}</td><td>${fmt(gMax, 0)}</td><td>${fmt(pdMax, 2)}</td></tr>`;
            }).join('')}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ---------------- Vazão × Curso ----------------
  function renderVazao() {
    const r = result;
    const el = document.getElementById('panel-vazao');
    el.innerHTML = `
      <div class="chart-box">
        <h3>Vazão total × curso</h3>
        <p class="desc">G<sub>t</sub>(h) — vazão conjunta admitida pelo trem de válvulas conforme o curso de acionamento.</p>
        <div class="chart-wrap tall"><canvas id="chart-gt"></canvas></div>
      </div>
      <div class="chart-box">
        <h3>Contribuição individual de cada válvula</h3>
        <p class="desc">G<sub>k</sub>(h) — vazão através de cada válvula isoladamente (empilhada).</p>
        <div class="chart-wrap tall"><canvas id="chart-gk"></canvas></div>
      </div>
    `;
    const labels = range(1, r.ifora).map(i => i);
    destroy('gt'); destroy('gk');
    charts.gt = new Chart(document.getElementById('chart-gt'), {
      type: 'line',
      data: { labels, datasets: [{ label: 'Gt total (kg/h)', data: labels.map(i => r.Gt[i]), borderColor: CHART_COLORS[0], backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, tension: 0.15 }] },
      options: baseLineOpts('Curso h (mm)', 'Vazão (kg/h)')
    });
    charts.gk = new Chart(document.getElementById('chart-gk'), {
      type: 'line',
      data: {
        labels, datasets: range(1, r.n).map(k => ({
          label: 'Válvula ' + k, data: labels.map(i => r.G[k][i] || 0),
          borderColor: CHART_COLORS[(k - 1) % CHART_COLORS.length], backgroundColor: CHART_COLORS[(k - 1) % CHART_COLORS.length] + '33',
          fill: true, borderWidth: 1.5, pointRadius: 0, tension: 0.15
        }))
      },
      options: { ...baseLineOpts('Curso h (mm)', 'Vazão (kg/h)'), scales: { ...baseLineOpts().scales, y: { ...baseLineOpts().scales.y, stacked: true } } }
    });
  }

  // ---------------- Mapa de pressões ----------------
  function renderPressao() {
    const r = result;
    const el = document.getElementById('panel-pressao');
    el.innerHTML = `
      <div class="chart-box">
        <h3>Mapa de pressões</h3>
        <p class="desc">Pressão de vapor vivo (P<sub>v</sub>), pressão de câmara (P<sub>z</sub>) e pressão a jusante de cada válvula (P<sub>d</sub>) em função da vazão total.</p>
        <div class="chart-wrap tall"><canvas id="chart-press"></canvas></div>
      </div>
    `;
    const labels = range(1, r.ifora).map(i => (r.Gt[i] / 1000).toFixed(1));
    destroy('press');
    const datasets = [
      { label: 'Pv (vapor vivo)', data: labels.map(() => r.Pv), borderColor: '#5E6A79', borderDash: [4, 3], borderWidth: 1.3, pointRadius: 0 },
      { label: 'Pz (câmara)', data: range(1, r.ifora).map(i => r.Pz[i]), borderColor: CHART_COLORS[0], borderWidth: 2, pointRadius: 0, tension: 0.1 }
    ];
    for (let k = 1; k <= r.n; k++) {
      datasets.push({ label: 'Pd válvula ' + k, data: range(1, r.ifora).map(i => r.Pd[k][i] || null), borderColor: CHART_COLORS[k % CHART_COLORS.length], borderWidth: 1.3, borderDash: [2, 2], pointRadius: 0, spanGaps: true });
    }
    charts.press = new Chart(document.getElementById('chart-press'), {
      type: 'line',
      data: { labels, datasets },
      options: baseLineOpts('Vazão (ton/h)', 'Pressão (bar)')
    });
  }

  // ---------------- Curva de consumo ----------------
  function renderConsumo() {
    const r = result;
    const el = document.getElementById('panel-consumo');
    el.innerHTML = `
      <div class="chart-box">
        <h3>Curva de consumo de vapor</h3>
        <p class="desc">Consumo específico de vapor em função da potência interna gerada — calibrada pelos pontos de projeto (Pot<sub>st</sub>, G<sub>st</sub>) de cada válvula.</p>
        <div class="chart-wrap tall"><canvas id="chart-cons"></canvas></div>
      </div>
      <div class="chart-box">
        <h3>Perda de disponibilidade</h3>
        <p class="desc">Perda de queda entálpica disponível por laminação nas válvulas, ponderada pela vazão de cada uma.</p>
        <div class="chart-wrap"><canvas id="chart-perda"></canvas></div>
      </div>
    `;
    const idxWithPot = range(1, r.ifora).filter(i => r.Pot[i] !== undefined);
    destroy('cons'); destroy('perda');
    charts.cons = new Chart(document.getElementById('chart-cons'), {
      type: 'line',
      data: {
        labels: idxWithPot.map(i => Math.round(r.Pot[i])),
        datasets: [{ label: 'Consumo de vapor (t/h)', data: idxWithPot.map(i => r.Gt[i] / 1000), borderColor: CHART_COLORS[1], backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, tension: 0.15 }]
      },
      options: baseLineOpts('Potência interna (kW)', 'Consumo de vapor (t/h)')
    });
    charts.perda = new Chart(document.getElementById('chart-perda'), {
      type: 'line',
      data: {
        labels: range(1, r.ifora).map(i => i),
        datasets: [{ label: 'Perda (kJ/kg)', data: range(1, r.ifora).map(i => r.Perdat[i]), borderColor: CHART_COLORS[2], backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, tension: 0.15 }]
      },
      options: baseLineOpts('Curso h (mm)', 'Perda (kJ/kg)')
    });
  }

  // ---------------- Perfil das válvulas (SVG) ----------------
  function renderPerfil() {
    const r = result;
    const el = document.getElementById('panel-perfil');
    let html = '';
    for (let k = 1; k <= r.n; k++) {
      const prof = r.profiles[k];
      const idxs = range(1, prof.ifora);
      const maxP = Math.max(...idxs.map(i => prof.L[i] * Math.cos(0))); // just axial extent proxy
      html += `
      <div class="chart-box">
        <h3>Perfil calculado — Válvula ${k}</h3>
        <p class="desc">Geometria do obturador: dimensão radial (b) × dimensão axial (p), e área de passagem resultante (F<sub>reg</sub>) em função do curso.</p>
        <div class="chart-wrap"><canvas id="chart-prof-${k}"></canvas></div>
      </div>
      <div class="chart-box">
        <h3>Área de passagem × curso — Válvula ${k}</h3>
        <div class="chart-wrap"><canvas id="chart-freg-${k}"></canvas></div>
      </div>`;
    }
    el.innerHTML = html;
    for (let k = 1; k <= r.n; k++) {
      const prof = r.profiles[k];
      const idxs = range(1, prof.ifora);
      destroy('prof-' + k); destroy('freg-' + k);
      // b vs p (using p = h - Hst[k-1] approximated via B,L geometry: p = h - L*sin(alfa)) — reconstruct p from L,B via original relation p = sqrt(L^2-b^2)... simpler: plot B (radial) against cumulative axial using h directly.
      charts['prof-' + k] = new Chart(document.getElementById(`chart-prof-${k}`), {
        type: 'line',
        data: { labels: idxs.map(i => i), datasets: [{ label: 'b — dimensão radial (mm)', data: idxs.map(i => prof.B[i]), borderColor: CHART_COLORS[(k - 1) % CHART_COLORS.length], borderWidth: 2, pointRadius: 0, tension: 0.1 }] },
        options: baseLineOpts('Curso da válvula (mm)', 'b (mm)')
      });
      charts['freg-' + k] = new Chart(document.getElementById(`chart-freg-${k}`), {
        type: 'line',
        data: { labels: idxs.map(i => i), datasets: [{ label: 'Freg (mm²)', data: idxs.map(i => prof.Freg[i]), borderColor: CHART_COLORS[(k - 1) % CHART_COLORS.length], borderWidth: 2, pointRadius: 0, tension: 0.1, fill: true, backgroundColor: CHART_COLORS[(k - 1) % CHART_COLORS.length] + '22' }] },
        options: baseLineOpts('Curso da válvula (mm)', 'Área (mm²)')
      });
    }
  }

  // ---------------- Forças ----------------
  function renderForcas() {
    const r = result;
    const el = document.getElementById('panel-forcas');
    el.innerHTML = `
      <div class="chart-box">
        <h3>Força total no obturador × curso</h3>
        <p class="desc">F<sub>t</sub>(h) — soma das forças de impulso do escoamento sobre os obturadores de todas as válvulas ativas.</p>
        <div class="chart-wrap tall"><canvas id="chart-ft"></canvas></div>
      </div>
      <div class="chart-box">
        <h3>Força por válvula</h3>
        <div class="chart-wrap tall"><canvas id="chart-fk"></canvas></div>
      </div>
    `;
    const labels = range(1, r.ifora).map(i => i);
    destroy('ft'); destroy('fk');
    charts.ft = new Chart(document.getElementById('chart-ft'), {
      type: 'line',
      data: { labels, datasets: [{ label: 'Ft (N)', data: labels.map(i => r.Fot[i]), borderColor: CHART_COLORS[3], borderWidth: 2, pointRadius: 0, tension: 0.1 }] },
      options: baseLineOpts('Curso h (mm)', 'Força (N)')
    });
    charts.fk = new Chart(document.getElementById('chart-fk'), {
      type: 'line',
      data: {
        labels, datasets: range(1, r.n).map(k => ({
          label: 'Válvula ' + k, data: labels.map(i => r.Fo[k][i] || null),
          borderColor: CHART_COLORS[(k - 1) % CHART_COLORS.length], borderWidth: 1.5, pointRadius: 0, tension: 0.1, spanGaps: true
        }))
      },
      options: baseLineOpts('Curso h (mm)', 'Força (N)')
    });
  }

  // ---------------- Tabela ----------------
  function renderTabela() {
    const r = result;
    const el = document.getElementById('panel-tabela');
    const rows = range(1, r.ifora).map(i => `
      <tr>
        <td>${fmt(i, 1)}</td><td>${fmt(r.Gt[i], 0)}</td><td>${fmt(r.Pz[i], 2)}</td>
        <td>${fmt(r.Fot[i], 0)}</td><td>${fmt(r.Gpro[i], 1)}</td><td>${r.Pot[i] !== undefined ? fmt(r.Pot[i], 1) : '—'}</td>
        <td>${fmt(r.Perdat[i], 1)}</td>
      </tr>`).join('');
    el.innerHTML = `
      <div class="table-scroll">
        <table>
          <thead><tr><th>h (mm)</th><th>Gt (kg/h)</th><th>Pz (bar)</th><th>Ft (N)</th><th>%G</th><th>Pot (kW)</th><th>Perda (kJ/kg)</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  function toCSV() {
    const r = result;
    let csv = 'h_mm,Gt_kgh,Pz_bar,Ft_N,pctG,Pot_kW,Perda_kJkg\n';
    for (const i of range(1, r.ifora)) {
      csv += [i, r.Gt[i].toFixed(1), r.Pz[i].toFixed(3), r.Fot[i].toFixed(0), r.Gpro[i].toFixed(2), r.Pot[i] !== undefined ? r.Pot[i].toFixed(1) : '', r.Perdat[i].toFixed(2)].join(',') + '\n';
    }
    return csv;
  }

  // ---------------- Helpers ----------------
  function range(a, b) { const arr = []; for (let x = a; x <= b; x++) arr.push(x); return arr; }
  function fmt(x, d) { return (x === undefined || x === null || isNaN(x)) ? '—' : Number(x).toFixed(d); }
  function destroy(key) { if (charts[key]) { charts[key].destroy(); delete charts[key]; } }
  function baseLineOpts(xTitle, yTitle) {
    return {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: TICK, boxWidth: 12, font: { family: "'IBM Plex Sans', sans-serif", size: 11 } } }, tooltip: { backgroundColor: '#1F2530', borderColor: '#2B3340', borderWidth: 1, titleColor: '#E8E6E0', bodyColor: '#9AA4B2' } },
      scales: {
        x: { title: { display: !!xTitle, text: xTitle || '', color: TICK }, grid: { color: GRID }, ticks: { color: TICK, maxTicksLimit: 12 } },
        y: { title: { display: !!yTitle, text: yTitle || '', color: TICK }, grid: { color: GRID }, ticks: { color: TICK } }
      }
    };
  }

  // ---------------- Tabs ----------------
  function wireTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
      tab.onclick = () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
      };
    });
  }

  // ==========================================================================
  // PROJETOS — salvar / abrir / salvar como (arquivos no servidor local)
  // ==========================================================================
  const APP_ID = 'peval';
  let currentProjectPath = null; // caminho relativo à raiz de projetos, ou null se não salvo ainda

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
      if (!confirm(`Este arquivo foi salvo pelo app "${data.appId}", não pelo PEVAL. Tentar carregar mesmo assim?`)) return;
    }
    state = data.state;
    renderSidebar();
    recalc();
  }

  function updateProjectDisplay() {
    const disp = document.getElementById('project-path-display');
    disp.value = currentProjectPath ? currentProjectPath : '(projeto não salvo)';
  }

  // ---- File browser modal ----
  let fbMode = 'open'; // 'open' | 'save'
  let fbCurrentDir = '';
  let fbSelected = null; // {name, isDir}

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
    list.innerHTML = data.entries.map(e => `
      <div class="modal-row ${e.isDir ? 'dir' : ''}" data-name="${e.name}" data-isdir="${e.isDir}">
        <span class="ic">${e.isDir ? '\u{1F4C1}' : '\u{1F4C4}'}</span><span>${e.name}</span>
      </div>`).join('');
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
    let html = `<button data-path="">raiz</button>`;
    let acc = '';
    parts.forEach(p => {
      acc = acc ? acc + '/' + p : p;
      html += ` / <button data-path="${acc}">${p}</button>`;
    });
    bc.innerHTML = html;
    bc.querySelectorAll('button').forEach(b => { b.onclick = () => fbList(b.dataset.path); });
  }

  function openFileBrowser(mode) {
    fbMode = mode;
    document.getElementById('fb-title').textContent = mode === 'open' ? 'Abrir projeto' : 'Salvar projeto como';
    document.getElementById('fb-msg').textContent = '';
    document.getElementById('fb-filename').style.display = mode === 'save' ? '' : 'none';
    document.getElementById('fb-filename').value = currentProjectPath ? currentProjectPath.split('/').pop() : (state.tipo ? state.tipo.replace(/[^a-zA-Z0-9_-]+/g, '_') + '.json' : 'projeto.json');
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
      try { localStorage.setItem('hub-theme', next); } catch (e) { }
    };
  }

  // ---------------- Estado vazio (antes do primeiro cálculo) ----------------
  function renderEmptyState() {
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.getElementById('panel-resumo').classList.add('active');
    document.getElementById('panel-resumo').innerHTML = `
      <div class="notice" style="text-align:center;padding:40px 20px;">
        Preencha os dados na lateral e clique em <strong>Calcular desempenho</strong> — ou abra um projeto salvo com <strong>Abrir…</strong> no topo.
      </div>`;
    for (const id of ['vazao', 'pressao', 'consumo', 'perfil', 'forcas', 'tabela']) {
      document.getElementById('panel-' + id).innerHTML = '';
    }
  }

  // ---------------- Init ----------------
  function init() {
    renderSidebar();
    wireTabs();
    wireProjectToolbar();
    wireHubNav();
    wireTheme();
    document.getElementById('btn-recalc').onclick = () => { readForm(); recalc(); };
    document.getElementById('btn-csv').onclick = () => {
      if (!result) return;
      const blob = new Blob([toCSV()], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'peval_resultados.csv'; a.click();
      URL.revokeObjectURL(url);
    };
    renderEmptyState();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
