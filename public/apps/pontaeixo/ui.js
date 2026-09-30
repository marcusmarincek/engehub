// ============================================================================
// INTERFACE — formulário, abas, gráfico de comparação e integração hub
// ============================================================================
(function () {
  const CHART_COLORS = ['#5B8DB8', '#C08A3E', '#6FA97A', '#B47FC0'];
  const TICK = '#9AA4B2';
  if (window.Chart) {
    Chart.defaults.color = TICK;
    Chart.defaults.font.family = "'IBM Plex Mono', monospace";
    Chart.defaults.font.size = 11;
  }

  const CRITERION_LABEL = {
    goodman: 'Goodman', gerber: 'Gerber',
    asme_elliptic: 'ASME-Elíptico', soderberg: 'Soderberg'
  };

  // ---------------- Estado (nunca pré-carregado com dados de exemplo) ------
  let state = {
    tipo: '', os: '', cliente: '',
    P: '', n: '',
    torqueMode: 'auto', Ta: '', Tm: '',
    bendingMode: 'direct', Ma: '', Mm: '', F: '', L: '',
    Sut: '', Sy: '',
    finish: 'machined', reliability: 99, kd: 1, kfMisc: 1,
    scMode: 'table', scPreset: 'keyseat_profile',
    KtManual: '', KtsManual: '', rManual: '',
    criterion: 'goodman', nTarget: '',
    legacyFS: '', legacyChavetado: 'Sim'
  };
  let result = null;
  let charts = {};

  function v(x) { return (x === '' || x === null || x === undefined) ? '' : x; }
  function fmt(x, d) { return (x === null || x === undefined || isNaN(x)) ? '—' : Number(x).toFixed(d === undefined ? 2 : d); }
  function num(id) { const el = document.getElementById(id); return el ? parseFloat(el.value) : NaN; }

  // Torque efetivo (N.m) a partir do estado atual
  function effectiveTorque() {
    if (state.torqueMode === 'custom') {
      return { Ta: parseFloat(state.Ta) || 0, Tm: parseFloat(state.Tm) || 0 };
    }
    const T = Engine.torqueFromPower(state.P, state.n);
    return { Ta: 0, Tm: T };
  }
  function effectiveBending() {
    if (state.bendingMode === 'force') {
      const F = parseFloat(state.F) || 0, L = parseFloat(state.L) || 0;
      return { Ma: (F * L) / 1000, Mm: 0 }; // F[N]*L[mm]/1000 -> N.m
    }
    return { Ma: parseFloat(state.Ma) || 0, Mm: parseFloat(state.Mm) || 0 };
  }

  // ---------------- Sidebar (formulário) ------------------------------------
  function renderSidebar() {
    const el = document.getElementById('sidebar');
    const torque = effectiveTorque();
    el.innerHTML = `
      <div class="brand">
        <div class="mark">PE</div>
        <h1>Ponta de Eixo</h1>
      </div>
      <div class="sub">Dimensionamento à fadiga — Shigley (DE-Goodman/Gerber/ASME-Elíptico/Soderberg)</div>

      <div class="field-group">
        <h2>Identificação</h2>
        <div class="row">
          <div><label>Turbina</label><input type="text" id="f-tipo" value="${v(state.tipo)}"></div>
          <div><label>OS</label><input type="text" id="f-os" value="${v(state.os)}"></div>
        </div>
        <div><label>Cliente</label><input type="text" id="f-cliente" value="${v(state.cliente)}"></div>
      </div>

      <div class="field-group">
        <h2>Carregamento na ponta de eixo</h2>
        <div class="row">
          <div><label>Potência <span class="unit">(kW)</span></label><input type="number" step="any" id="f-P" value="${v(state.P)}"></div>
          <div><label>Rotação <span class="unit">(rpm)</span></label><input type="number" step="any" id="f-n" value="${v(state.n)}"></div>
        </div>
        <div class="hint">Torque médio por potência: <span class="mono">${fmt(torque.Tm || Engine.torqueFromPower(state.P, state.n), 1)} N·m</span> (T = 60000·P/(2π·n)). Assume-se torque constante (T<sub>m</sub>=T, T<sub>a</sub>=0) — eixo girando com torque estável.</div>

        <details class="section-block" ${state.torqueMode === 'custom' ? 'open' : ''}>
          <summary class="sub-title">Torque flutuante (avançado)</summary>
          <div class="row" style="margin-top:8px;">
            <div><label><input type="radio" name="f-torqmode" value="auto" ${state.torqueMode === 'auto' ? 'checked' : ''}> automático (por P, n)</label></div>
            <div><label><input type="radio" name="f-torqmode" value="custom" ${state.torqueMode === 'custom' ? 'checked' : ''}> informar T<sub>a</sub>/T<sub>m</sub></label></div>
          </div>
          ${state.torqueMode === 'custom' ? `
          <div class="row">
            <div><label>T<sub>a</sub> alternado <span class="unit">(N·m)</span></label><input type="number" step="any" id="f-Ta" value="${v(state.Ta)}"></div>
            <div><label>T<sub>m</sub> médio <span class="unit">(N·m)</span></label><input type="number" step="any" id="f-Tm" value="${v(state.Tm)}"></div>
          </div>` : ''}
        </details>

        <details class="section-block" open>
          <summary class="sub-title">Momento fletor</summary>
          <div class="row" style="margin-top:8px;">
            <div><label><input type="radio" name="f-bendmode" value="direct" ${state.bendingMode === 'direct' ? 'checked' : ''}> M<sub>a</sub>/M<sub>m</sub> diretos</label></div>
            <div><label><input type="radio" name="f-bendmode" value="force" ${state.bendingMode === 'force' ? 'checked' : ''}> carga no balanço (F, L)</label></div>
          </div>
          ${state.bendingMode === 'direct' ? `
          <div class="row">
            <div><label>M<sub>a</sub> alternado <span class="unit">(N·m)</span></label><input type="number" step="any" id="f-Ma" value="${v(state.Ma)}" placeholder="0"></div>
            <div><label>M<sub>m</sub> médio <span class="unit">(N·m)</span></label><input type="number" step="any" id="f-Mm" value="${v(state.Mm)}" placeholder="0"></div>
          </div>
          <div class="hint">Deixe em branco (0) para torção pura — sem carga radial no acoplamento.</div>` : `
          <div class="row">
            <div><label>Força radial F <span class="unit">(N)</span></label><input type="number" step="any" id="f-F" value="${v(state.F)}"></div>
            <div><label>Braço L <span class="unit">(mm)</span></label><input type="number" step="any" id="f-L" value="${v(state.L)}"></div>
          </div>
          <div class="hint">Eixo girando com carga transversal fixa → flexão totalmente alternada: M<sub>a</sub> = F·L, M<sub>m</sub> = 0.</div>`}
        </details>
      </div>

      <div class="field-group">
        <h2>Material</h2>
        <div class="row">
          <div><label>S<sub>ut</sub> — resistência à ruptura <span class="unit">(MPa)</span></label><input type="number" step="any" id="f-Sut" value="${v(state.Sut)}"></div>
          <div><label>S<sub>y</sub> — resistência ao escoamento <span class="unit">(MPa)</span></label><input type="number" step="any" id="f-Sy" value="${v(state.Sy)}"></div>
        </div>
        <div class="hint">Informe conforme certificado de material ou norma (o valor depende do tratamento térmico/têmpera específicos — não há tabela genérica confiável para isso aqui).</div>
      </div>

      <div class="field-group">
        <h2>Acabamento e confiabilidade</h2>
        <div class="row">
          <div><label>Acabamento superficial</label>
            <select id="f-finish">
              <option value="ground" ${state.finish === 'ground' ? 'selected' : ''}>Retificado</option>
              <option value="machined" ${state.finish === 'machined' ? 'selected' : ''}>Usinado / trefilado</option>
              <option value="hot_rolled" ${state.finish === 'hot_rolled' ? 'selected' : ''}>Laminado a quente</option>
              <option value="forged" ${state.finish === 'forged' ? 'selected' : ''}>Forjado</option>
            </select>
          </div>
          <div><label>Confiabilidade</label>
            <select id="f-reliability">
              ${[50, 90, 95, 99, 99.9, 99.99, 99.999, 99.9999].map(function (rp) {
                return '<option value="' + rp + '" ' + (state.reliability == rp ? 'selected' : '') + '>' + rp + '%</option>';
              }).join('')}
            </select>
          </div>
        </div>
        <details class="section-block">
          <summary class="sub-title">Fatores adicionais (avançado)</summary>
          <div class="row" style="margin-top:8px;">
            <div><label>k<sub>d</sub> — temperatura</label><input type="number" step="any" id="f-kd" value="${v(state.kd)}"></div>
            <div><label>k<sub>f</sub> — miscelânea</label><input type="number" step="any" id="f-kfMisc" value="${v(state.kfMisc)}"></div>
          </div>
          <div class="hint">Deixe em 1 salvo casos especiais (operação em alta temperatura, corrosão, etc. — Shigley, cap. 6).</div>
        </details>
      </div>

      <div class="field-group">
        <h2>Concentração de tensão</h2>
        <div class="row">
          <div><label><input type="radio" name="f-scmode" value="table" ${state.scMode === 'table' ? 'checked' : ''}> Tabela 7-1 (1ª iteração)</label></div>
          <div><label><input type="radio" name="f-scmode" value="manual" ${state.scMode === 'manual' ? 'checked' : ''}> Informar Kt/Kts/raio</label></div>
        </div>
        ${state.scMode === 'table' ? `
        <div><label>Detalhe geométrico</label>
          <select id="f-scpreset">
            ${Object.keys(Engine.TABLE_7_1).map(function (k) {
              const p = Engine.TABLE_7_1[k];
              return '<option value="' + k + '" ' + (state.scPreset === k ? 'selected' : '') + '>' + p.label + '</option>';
            }).join('')}
          </select>
        </div>
        <div class="hint">${Engine.TABLE_7_1[state.scPreset].note} K<sub>t</sub>=${Engine.TABLE_7_1[state.scPreset].Kt}, K<sub>ts</sub>=${Engine.TABLE_7_1[state.scPreset].Kts}, r/d≈${Engine.TABLE_7_1[state.scPreset].rOverD}. O raio é refinado junto com o diâmetro a cada iteração.</div>
        ` : `
        <div class="row">
          <div><label>K<sub>t</sub> (flexão)</label><input type="number" step="any" id="f-Kt" value="${v(state.KtManual)}"></div>
          <div><label>K<sub>ts</sub> (torção)</label><input type="number" step="any" id="f-Kts" value="${v(state.KtsManual)}"></div>
        </div>
        <div><label>Raio de concordância r <span class="unit">(mm, opcional)</span></label><input type="number" step="any" id="f-r" value="${v(state.rManual)}"></div>
        <div class="hint">Sem raio informado, assume-se q=1 (K<sub>f</sub>=K<sub>t</sub>) — lado conservador.</div>
        `}
      </div>

      <div class="field-group">
        <h2>Critério e fator de segurança</h2>
        <div class="row">
          <div><label>Critério de fadiga</label>
            <select id="f-criterion">
              <option value="goodman" ${state.criterion === 'goodman' ? 'selected' : ''}>DE-Goodman</option>
              <option value="gerber" ${state.criterion === 'gerber' ? 'selected' : ''}>DE-Gerber</option>
              <option value="asme_elliptic" ${state.criterion === 'asme_elliptic' ? 'selected' : ''}>DE-ASME-Elíptico</option>
              <option value="soderberg" ${state.criterion === 'soderberg' ? 'selected' : ''}>DE-Soderberg</option>
            </select>
          </div>
          <div><label>Fator de segurança n<sub>d</sub></label><input type="number" step="any" id="f-nTarget" value="${v(state.nTarget)}"></div>
        </div>
      </div>

      <button class="btn-primary" id="btn-calc">Calcular</button>
    `;
    wireSidebarEvents();
  }

  function wireSidebarEvents() {
    document.getElementById('btn-calc').onclick = function () { readForm(); recalc(); };

    ['f-torqmode'].forEach(function () {
      document.querySelectorAll('input[name="f-torqmode"]').forEach(function (r) {
        r.onchange = function () { state.torqueMode = r.value; readForm(false); renderSidebar(); };
      });
    });
    document.querySelectorAll('input[name="f-bendmode"]').forEach(function (r) {
      r.onchange = function () { state.bendingMode = r.value; readForm(false); renderSidebar(); };
    });
    document.querySelectorAll('input[name="f-scmode"]').forEach(function (r) {
      r.onchange = function () { state.scMode = r.value; readForm(false); renderSidebar(); };
    });
    const presetSel = document.getElementById('f-scpreset');
    if (presetSel) presetSel.onchange = function () { state.scPreset = presetSel.value; readForm(false); renderSidebar(); };
  }

  function readForm(readTop) {
    if (readTop === undefined) readTop = true;
    function g(id) { const el = document.getElementById(id); return el ? el.value : undefined; }
    if (readTop) {
      state.tipo = g('f-tipo') || ''; state.os = g('f-os') || ''; state.cliente = g('f-cliente') || '';
      state.P = g('f-P') || ''; state.n = g('f-n') || '';
      if (state.torqueMode === 'custom') { state.Ta = g('f-Ta') || ''; state.Tm = g('f-Tm') || ''; }
      if (state.bendingMode === 'direct') { state.Ma = g('f-Ma') || ''; state.Mm = g('f-Mm') || ''; }
      else { state.F = g('f-F') || ''; state.L = g('f-L') || ''; }
      state.Sut = g('f-Sut') || ''; state.Sy = g('f-Sy') || '';
      state.finish = g('f-finish') || state.finish;
      state.reliability = parseFloat(g('f-reliability')) || state.reliability;
      const kdEl = g('f-kd'), kfEl = g('f-kfMisc');
      if (kdEl !== undefined) state.kd = kdEl; if (kfEl !== undefined) state.kfMisc = kfEl;
      if (state.scMode === 'manual') {
        state.KtManual = g('f-Kt') || ''; state.KtsManual = g('f-Kts') || ''; state.rManual = g('f-r') || '';
      }
      state.criterion = g('f-criterion') || state.criterion;
      state.nTarget = g('f-nTarget') || '';
    }
  }

  function validateState() {
    const missing = [];
    if (state.torqueMode === 'auto') {
      if (!state.P) missing.push('Potência');
      if (!state.n) missing.push('Rotação');
    } else {
      if (state.Ta === '' && state.Tm === '') missing.push('Torque alternado/médio');
    }
    if (state.bendingMode === 'force') {
      if (!state.F) missing.push('Força radial F');
      if (!state.L) missing.push('Braço L');
    }
    if (!state.Sut) missing.push('S_ut');
    if (!state.Sy) missing.push('S_y');
    if (state.scMode === 'manual') {
      if (!state.KtManual) missing.push('K_t');
      if (!state.KtsManual) missing.push('K_ts');
    }
    if (!state.nTarget) missing.push('Fator de segurança n_d');
    return missing;
  }

  // ---------------- Cálculo --------------------------------------------------
  function recalc() {
    const notices = document.getElementById('notices');
    notices.innerHTML = '';
    const missing = validateState();
    if (missing.length) {
      notices.innerHTML = '<div class="notice error"><strong>Preencha os campos antes de calcular:</strong> ' + missing.join(', ') + '.</div>';
      renderEmptyState();
      return;
    }
    const torque = effectiveTorque();
    const bending = effectiveBending();
    const input = {
      Ma: bending.Ma, Ta: torque.Ta, Mm: bending.Mm, Tm: torque.Tm,
      Sut: parseFloat(state.Sut), Sy: parseFloat(state.Sy),
      finish: state.finish, reliabilityPct: state.reliability,
      kd: state.kd, kfMisc: state.kfMisc,
      scMode: state.scMode, scPreset: state.scPreset,
      KtManual: state.KtManual, KtsManual: state.KtsManual, rManual: state.rManual,
      criterion: state.criterion, nTarget: parseFloat(state.nTarget)
    };
    try {
      result = Engine.designShaftEnd(input);
      result.comparison = Engine.compareCriteria(input, result);
      result.input = input;
    } catch (e) {
      notices.innerHTML = '<div class="notice error"><strong>Erro no cálculo:</strong> ' + e.message + '.</div>';
      console.error(e);
      return;
    }
    document.getElementById('hdr-tipo').textContent = state.tipo || '—';
    document.getElementById('hdr-os').textContent = state.os || '—';
    document.getElementById('hdr-cliente').textContent = state.cliente || '—';

    if (!result.converged) {
      notices.innerHTML = '<div class="notice error"><strong>Aviso:</strong> a iteração diâmetro↔fatores não convergiu em 25 passos — confira as entradas (resultado ainda é exibido, use com cautela).</div>';
    } else if (result.nYield < 1) {
      notices.innerHTML = '<div class="notice error"><strong>Escoamento previsto:</strong> o fator de segurança estático (n=' + fmt(result.nYield, 2) + ') é menor que 1 no primeiro ciclo. Reveja o carregamento ou o material.</div>';
    } else if (result.nYield < result.nAchieved) {
      notices.innerHTML = '<div class="notice"><strong>Atenção:</strong> o critério estático (n=' + fmt(result.nYield, 2) + ') é mais restritivo que o de fadiga (n=' + fmt(result.nAchieved, 2) + ') — o escoamento governa o dimensionamento aqui.</div>';
    }

    renderResumo();
    renderComparacao();
    renderEstatica();
    renderMemoria();
    renderLegado();
  }

  // ---------------- Resumo -----------------------------------------------
  function renderResumo() {
    const r = result;
    const el = document.getElementById('panel-resumo');
    el.innerHTML = `
      <div class="card-grid">
        <div class="stat-card"><div class="label">Diâmetro necessário</div><div class="value">${fmt(r.d, 1)}<span class="unit">mm</span></div></div>
        <div class="stat-card"><div class="label">Critério</div><div class="value" style="font-size:15px;">${CRITERION_LABEL[state.criterion]}</div></div>
        <div class="stat-card"><div class="label">n de fadiga alcançado</div><div class="value">${fmt(r.nAchieved, 2)}</div></div>
        <div class="stat-card"><div class="label">n de escoamento</div><div class="value">${fmt(r.nYield, 2)}</div></div>
        <div class="stat-card"><div class="label">K<sub>f</sub> / K<sub>fs</sub></div><div class="value" style="font-size:16px;">${fmt(r.Kf, 3)} / ${fmt(r.Kfs, 3)}</div></div>
        <div class="stat-card"><div class="label">S<sub>e</sub></div><div class="value">${fmt(r.se.Se, 1)}<span class="unit">MPa</span></div></div>
      </div>
      <div class="chart-box">
        <h3>Tensões de von Mises no diâmetro final</h3>
        <p class="desc">σ'<sub>a</sub> = ${fmt(r.sigmaA, 2)} MPa (alternada) · σ'<sub>m</sub> = ${fmt(r.sigmaM, 2)} MPa (média) · convergiu em ${r.iterations} iteração(ões), raio usado ${fmt(r.rUsed, 3)} mm.</p>
      </div>
    `;
  }

  // ---------------- Comparação de critérios -------------------------------
  function renderComparacao() {
    const r = result;
    const el = document.getElementById('panel-comparacao');
    el.innerHTML = `
      <div class="chart-box">
        <h3>Diâmetro necessário por critério de fadiga</h3>
        <p class="desc">Mesmos K<sub>f</sub>, K<sub>fs</sub> e S<sub>e</sub> (do critério selecionado, já convergido) — só muda a equação de dano acumulado. Gerber e ASME-Elíptico normalmente pedem menos diâmetro (ajustam melhor os dados de fadiga reais); Goodman e Soderberg são mais conservadores.</p>
        <div class="chart-wrap"><canvas id="chart-comp"></canvas></div>
      </div>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Critério</th><th>Diâmetro (mm)</th></tr></thead>
          <tbody>${r.comparison.map(function (c) {
            const isSel = c.criterion === state.criterion;
            return '<tr' + (isSel ? ' style="color:var(--brass);"' : '') + '><td>' + c.label + (isSel ? ' (selecionado)' : '') + '</td><td>' + fmt(c.d, 2) + '</td></tr>';
          }).join('')}</tbody>
        </table>
      </div>
    `;
    destroy('comp');
    charts.comp = new Chart(document.getElementById('chart-comp'), {
      type: 'bar',
      data: {
        labels: r.comparison.map(function (c) { return c.label; }),
        datasets: [{ label: 'Diâmetro (mm)', data: r.comparison.map(function (c) { return c.d; }), backgroundColor: CHART_COLORS }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: false, title: { display: true, text: 'mm' } } }
      }
    });
  }

  // ---------------- Verificação estática ----------------------------------
  function renderEstatica() {
    const r = result;
    const el = document.getElementById('panel-estatica');
    el.innerHTML = `
      <div class="chart-box">
        <h3>Verificação de escoamento no 1º ciclo</h3>
        <p class="desc">Estimativa conservadora σ'<sub>max</sub> ≈ σ'<sub>a</sub> + σ'<sub>m</sub> (Shigley, cap. 7) comparada a S<sub>y</sub>. Sempre necessária mesmo quando o dimensionamento é por fadiga — Goodman e Gerber não garantem isso sozinhos.</p>
        <div class="card-grid">
          <div class="stat-card"><div class="label">σ'<sub>max</sub> estimada</div><div class="value">${fmt(r.sigmaMax, 2)}<span class="unit">MPa</span></div></div>
          <div class="stat-card"><div class="label">S<sub>y</sub></div><div class="value">${fmt(r.input.Sy, 1)}<span class="unit">MPa</span></div></div>
          <div class="stat-card"><div class="label">n de escoamento</div><div class="value" style="color:${r.nYield < 1 ? 'var(--red)' : 'var(--ink)'};">${fmt(r.nYield, 2)}</div></div>
        </div>
      </div>
    `;
  }

  // ---------------- Memória de cálculo ------------------------------------
  function renderMemoria() {
    const r = result;
    const el = document.getElementById('panel-memoria');
    const se = r.se;
    el.innerHTML = `
      <div class="chart-box">
        <h3>Fatores de Marin — S<sub>e</sub> = k<sub>a</sub>·k<sub>b</sub>·k<sub>c</sub>·k<sub>d</sub>·k<sub>e</sub>·k<sub>f</sub>·S<sub>e</sub>'</h3>
        <div class="table-scroll">
          <table>
            <thead><tr><th>Fator</th><th>Valor</th></tr></thead>
            <tbody>
              <tr><td>S<sub>e</sub>' (=0,5·S<sub>ut</sub>, máx. 700 MPa)</td><td>${fmt(se.sePrime, 2)} MPa</td></tr>
              <tr><td>k<sub>a</sub> (acabamento)</td><td>${fmt(se.ka, 4)}</td></tr>
              <tr><td>k<sub>b</sub> (tamanho, d=${fmt(r.d, 1)} mm)</td><td>${fmt(se.kb, 4)}</td></tr>
              <tr><td>k<sub>c</sub> (carregamento combinado — DE)</td><td>${fmt(se.kc, 2)}</td></tr>
              <tr><td>k<sub>d</sub> (temperatura)</td><td>${fmt(se.kd, 3)}</td></tr>
              <tr><td>k<sub>e</sub> (confiabilidade ${state.reliability}%)</td><td>${fmt(se.ke, 3)}</td></tr>
              <tr><td>k<sub>f</sub> (miscelânea)</td><td>${fmt(se.kfMisc, 3)}</td></tr>
              <tr><td><strong>S<sub>e</sub></strong></td><td><strong>${fmt(se.Se, 2)} MPa</strong></td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="chart-box">
        <h3>Concentração de tensão</h3>
        <div class="table-scroll">
          <table>
            <thead><tr><th>Grandeza</th><th>Valor</th></tr></thead>
            <tbody>
              <tr><td>K<sub>t</sub> / K<sub>ts</sub></td><td>${fmt(r.Kt, 3)} / ${fmt(r.Kts, 3)}</td></tr>
              <tr><td>Raio usado</td><td>${fmt(r.rUsed, 3)} mm</td></tr>
              <tr><td>q / q<sub>s</sub> (Neuber)</td><td>${fmt(r.q, 3)} / ${fmt(r.qs, 3)}</td></tr>
              <tr><td>K<sub>f</sub> / K<sub>fs</sub></td><td>${fmt(r.Kf, 3)} / ${fmt(r.Kfs, 3)}</td></tr>
              <tr><td>Iterações até convergir</td><td>${r.iterations}</td></tr>
            </tbody>
          </table>
        </div>
        <p class="desc" style="margin-top:10px;">q e q<sub>s</sub> vêm da equação de Neuber (Shigley Eq. 6-33/6-35), estimados a partir de S<sub>ut</sub> e do raio de concordância. Para geometrias críticas, confirme K<sub>t</sub>/K<sub>ts</sub> reais na carta de Peterson (Fig. A-15-8/9) com o raio final definido em desenho.</p>
      </div>
    `;
  }

  // ---------------- Método simplificado (legado, torção pura) ------------
  function renderLegado() {
    const el = document.getElementById('panel-legado');
    el.innerHTML = `
      <div class="chart-box">
        <h3>Verificação rápida — torção estática pura (método simplificado)</h3>
        <p class="desc">Fórmula usada na planilha original do setor: d = 365,026·∛(FS·P/(σ<sub>adm</sub>·n)), com σ<sub>adm</sub> = S<sub>ut</sub>/5,56, reduzido em 25% se houver rasgo de chaveta. Não considera fadiga, flexão nem concentração de tensão detalhada — use só como referência cruzada rápida, não como critério final.</p>
        <div class="row">
          <div><label>Fator de serviço</label><input type="number" step="any" id="f-legFS" value="${v(state.legacyFS)}"></div>
          <div><label>Chavetado?</label>
            <select id="f-legChav">
              <option value="Sim" ${state.legacyChavetado === 'Sim' ? 'selected' : ''}>Sim</option>
              <option value="Não" ${state.legacyChavetado === 'Não' ? 'selected' : ''}>Não</option>
            </select>
          </div>
        </div>
        <button class="btn" id="btn-legado">Calcular (simplificado)</button>
        <div id="legado-result" style="margin-top:14px;"></div>
      </div>
    `;
    document.getElementById('btn-legado').onclick = function () {
      state.legacyFS = document.getElementById('f-legFS').value;
      state.legacyChavetado = document.getElementById('f-legChav').value;
      const Sut = parseFloat(state.Sut);
      const out = document.getElementById('legado-result');
      if (!Sut || !state.legacyFS || !state.P || !state.n) {
        out.innerHTML = '<div class="notice error">Preencha S<sub>ut</sub> (aba Material), Potência, Rotação e o Fator de serviço.</div>';
        return;
      }
      let sigmaAdm = Sut / (5 * 1.1111);
      if (state.legacyChavetado === 'Sim') sigmaAdm *= 0.75;
      const d = Engine.legacyStaticDiameter(state.legacyFS, state.P, state.n, sigmaAdm);
      out.innerHTML = '<div class="card-grid">' +
        '<div class="stat-card"><div class="label">σ admissível</div><div class="value">' + fmt(sigmaAdm, 2) + '<span class="unit">MPa</span></div></div>' +
        '<div class="stat-card"><div class="label">Diâmetro mínimo (simplificado)</div><div class="value">' + fmt(d, 2) + '<span class="unit">mm</span></div></div>' +
        '<div class="stat-card"><div class="label">Diâmetro pela fadiga (Shigley)</div><div class="value">' + (result ? fmt(result.d, 2) : '—') + '<span class="unit">mm</span></div></div>' +
        '</div>';
    };
  }

  function destroy(key) { if (charts[key]) { charts[key].destroy(); delete charts[key]; } }

  // ---------------- Tabs ----------------------------------------------------
  function wireTabs() {
    document.querySelectorAll('.tab').forEach(function (tab) {
      tab.onclick = function () {
        document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
        document.querySelectorAll('.panel').forEach(function (p) { p.classList.remove('active'); });
        tab.classList.add('active');
        document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
      };
    });
  }

  // ---------------- Estado vazio --------------------------------------------
  function renderEmptyState() {
    document.querySelectorAll('.panel').forEach(function (p) { p.classList.remove('active'); });
    document.getElementById('panel-resumo').classList.add('active');
    document.getElementById('panel-resumo').innerHTML = `
      <div class="notice" style="text-align:center;padding:40px 20px;">
        Preencha os dados na lateral e clique em <strong>Calcular</strong> — ou abra um projeto salvo com <strong>Abrir…</strong> no topo.
      </div>`;
    ['comparacao', 'estatica', 'memoria', 'legado'].forEach(function (id) {
      document.getElementById('panel-' + id).innerHTML = '';
    });
  }

  // ==========================================================================
  // PROJETOS — salvar / abrir / salvar como (padrão genérico do hub, ver
  // public/apps/peval/ui.js — só troca o APP_ID)
  // ==========================================================================
  const APP_ID = 'pontaeixo';
  let currentProjectPath = null;

  function buildProjectData(name) {
    return {
      appId: APP_ID, version: 1,
      name: name || (currentProjectPath ? currentProjectPath.split('/').pop().replace(/\.json$/i, '') : 'projeto'),
      savedAt: new Date().toISOString(), state: state
    };
  }
  function applyProjectData(data) {
    if (!data || !data.state) { alert('Arquivo de projeto inválido.'); return; }
    if (data.appId && data.appId !== APP_ID) {
      if (!confirm('Este arquivo foi salvo pelo app "' + data.appId + '", não pelo de Ponta de Eixo. Tentar carregar mesmo assim?')) return;
    }
    state = data.state;
    renderSidebar();
    recalc();
  }
  function updateProjectDisplay() {
    document.getElementById('project-path-display').value = currentProjectPath ? currentProjectPath : '(projeto não salvo)';
  }

  let fbMode = 'open', fbCurrentDir = '', fbSelected = null;

  async function fbList(dir) {
    const res = await fetch('/api/browse?path=' + encodeURIComponent(dir));
    if (!res.ok) { document.getElementById('fb-msg').textContent = 'Erro ao listar pasta.'; return; }
    const data = await res.json();
    fbCurrentDir = data.path; fbSelected = null;
    renderBreadcrumb();
    const list = document.getElementById('fb-list');
    if (!data.entries.length) {
      list.innerHTML = '<div class="modal-row" style="color:var(--ink-faint);cursor:default;">— pasta vazia —</div>';
      return;
    }
    list.innerHTML = data.entries.map(function (e) {
      return '<div class="modal-row ' + (e.isDir ? 'dir' : '') + '" data-name="' + e.name + '" data-isdir="' + e.isDir + '">' +
        '<span class="ic">' + (e.isDir ? '\u{1F4C1}' : '\u{1F4C4}') + '</span><span>' + e.name + '</span></div>';
    }).join('');
    list.querySelectorAll('.modal-row[data-name]').forEach(function (row) {
      row.onclick = function () {
        const name = row.dataset.name, isDir = row.dataset.isdir === 'true';
        if (isDir) { fbList(fbCurrentDir ? fbCurrentDir + '/' + name : name); }
        else {
          list.querySelectorAll('.modal-row').forEach(function (r) { r.classList.remove('selected'); });
          row.classList.add('selected');
          fbSelected = { name: name, isDir: isDir };
          if (fbMode === 'save') document.getElementById('fb-filename').value = name;
        }
      };
    });
  }
  function renderBreadcrumb() {
    const bc = document.getElementById('fb-breadcrumb');
    const parts = fbCurrentDir ? fbCurrentDir.split('/').filter(Boolean) : [];
    let html = '<button data-path="">raiz</button>', acc = '';
    parts.forEach(function (p) { acc = acc ? acc + '/' + p : p; html += ' / <button data-path="' + acc + '">' + p + '</button>'; });
    bc.innerHTML = html;
    bc.querySelectorAll('button').forEach(function (b) { b.onclick = function () { fbList(b.dataset.path); }; });
  }
  function openFileBrowser(mode) {
    fbMode = mode;
    document.getElementById('fb-title').textContent = mode === 'open' ? 'Abrir projeto' : 'Salvar projeto como';
    document.getElementById('fb-msg').textContent = '';
    document.getElementById('fb-filename').style.display = mode === 'save' ? '' : 'none';
    document.getElementById('fb-filename').value = currentProjectPath ? currentProjectPath.split('/').pop() : (state.tipo ? state.tipo.replace(/[^a-zA-Z0-9_-]+/g, '_') + '.json' : 'ponta_de_eixo.json');
    document.getElementById('fb-confirm').textContent = mode === 'open' ? 'Abrir' : 'Salvar aqui';
    document.getElementById('fb-overlay').classList.add('open');
    const startDir = currentProjectPath && currentProjectPath.includes('/') ? currentProjectPath.split('/').slice(0, -1).join('/') : '';
    fbList(startDir);
  }
  function closeFileBrowser() { document.getElementById('fb-overlay').classList.remove('open'); }
  async function fbConfirm() {
    const msg = document.getElementById('fb-msg'); msg.textContent = '';
    if (fbMode === 'open') {
      if (!fbSelected || fbSelected.isDir) { msg.textContent = 'Selecione um arquivo .json.'; return; }
      const rel = fbCurrentDir ? fbCurrentDir + '/' + fbSelected.name : fbSelected.name;
      const res = await fetch('/api/file?path=' + encodeURIComponent(rel));
      if (!res.ok) { msg.textContent = 'Erro ao carregar o arquivo.'; return; }
      const data = await res.json();
      currentProjectPath = rel; updateProjectDisplay(); applyProjectData(data.content); closeFileBrowser();
    } else {
      let filename = document.getElementById('fb-filename').value.trim();
      if (!filename) { msg.textContent = 'Digite um nome de arquivo.'; return; }
      if (!filename.toLowerCase().endsWith('.json')) filename += '.json';
      const rel = fbCurrentDir ? fbCurrentDir + '/' + filename : filename;
      const payload = buildProjectData(filename.replace(/\.json$/i, ''));
      const res = await fetch('/api/file', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: rel, content: payload, overwrite: true }) });
      if (!res.ok) { msg.textContent = 'Erro ao salvar.'; return; }
      currentProjectPath = rel; updateProjectDisplay(); closeFileBrowser();
    }
  }
  async function saveCurrent() {
    if (!currentProjectPath) { openFileBrowser('save'); return; }
    const payload = buildProjectData();
    const res = await fetch('/api/file', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: currentProjectPath, content: payload, overwrite: true }) });
    if (!res.ok) { alert('Erro ao salvar o projeto.'); return; }
    const btn = document.getElementById('btn-save'); const old = btn.textContent; btn.textContent = 'Salvo ✓';
    setTimeout(function () { btn.textContent = old; }, 1200);
  }
  function wireProjectToolbar() {
    document.getElementById('btn-open').onclick = function () { openFileBrowser('open'); };
    document.getElementById('btn-save').onclick = saveCurrent;
    document.getElementById('btn-saveas').onclick = function () { openFileBrowser('save'); };
    document.getElementById('fb-close').onclick = closeFileBrowser;
    document.getElementById('fb-confirm').onclick = fbConfirm;
    document.getElementById('fb-overlay').addEventListener('click', function (e) { if (e.target.id === 'fb-overlay') closeFileBrowser(); });
    document.getElementById('fb-newfolder').onclick = async function () {
      const name = prompt('Nome da nova pasta:'); if (!name) return;
      const rel = fbCurrentDir ? fbCurrentDir + '/' + name : name;
      await fetch('/api/mkdir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: rel }) });
      fbList(fbCurrentDir);
    };
    updateProjectDisplay();
  }
  async function wireHubNav() {
    const who = await fetch('/api/whoami').then(function (r) { return r.json(); }).catch(function () { return { authed: false }; });
    if (!who.authed) { window.location.href = '/login.html'; return; }
    document.getElementById('hubnav-who').textContent = who.username;
    document.getElementById('hubnav-logout').onclick = async function () {
      await fetch('/api/logout', { method: 'POST' }); window.location.href = '/login.html';
    };
  }
  function wireTheme() {
    const btn = document.getElementById('btn-theme'); if (!btn) return;
    btn.onclick = function () {
      const cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
      const next = cur === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('hub-theme', next); } catch (e) { /* tema não persiste, segue com o padrão */ }
    };
  }

  // ---------------- Init ----------------------------------------------------
  function init() {
    renderSidebar();
    wireTabs();
    wireProjectToolbar();
    wireHubNav();
    wireTheme();
    renderEmptyState();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
