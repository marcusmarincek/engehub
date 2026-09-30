// ============================================================================
// STEAMPATH — Motor de cálculo (linha média, multiestágio, ação/impulso)
// Puro: sem DOM, sem fetch. Engine.run(params) recebe o estado do formulário
// e devolve os resultados. Testável isoladamente com `node -e "..."`.
//
// Metodologia (fase 1 — linha média única): equação de energia (Euler),
// triângulos de velocidade, perdas (perfil por coeficiente de velocidade,
// atrito/ventilação, vazamento em labirinto pela fórmula de Stodola, umidade),
// continuidade (vazão através da garganta do injetor/diafragma e da palheta
// móvel, vazão de tomada/extração por estágio) e convergência (a perda na
// válvula de admissão é ajustada até a marcha estágio-a-estágio fechar na
// pressão de escape informada — o mesmo papel que a macro
// `IteraçãoPerdaValvula` cumpria na planilha original).
//
// α1 (ângulo de saída do bocal) e β2e (ângulo de saída da palheta móvel) NÃO
// são dados de entrada — os dois são calculados pela mesma relação
// geométrica garganta/passo (sin ângulo = z·e/(π·dm)), exatamente como no
// programa original (validado: para o estágio 1 da CTU-TM5000 o β2e
// calculado bateu em 21,43° contra 21,4° do desenho real).
//
// Propriedades de vapor: IAPWS-IF97 (Steam, em steam.js — mesma biblioteca
// pública que a planilha original usava em VBA), garantindo fidelidade aos
// resultados termodinâmicos já validados.
//
// Campos de entrada capturados no formulário mas AINDA NÃO usados nesta
// versão do cálculo (guardados no projeto para as próximas evoluções —
// perfil/tipo de pé/material de palheta, geometria de diafragma além de
// d1n/d2n/dak, furos de equalização de pressão, flanges): eles não entram em
// nenhuma fórmula aqui, apenas trafegam no `state` do ui.js.
// ============================================================================
(function (global) {
  const Steam = (typeof module !== 'undefined' && typeof require === 'function')
    ? require('./steam.js') : global.Steam;

  // ---------------------------------------------------------------------
  // Spline cúbico — porte literal da função `cubic_spline` da planilha
  // original (natural cubic spline, com a mesma rotina de busca do
  // intervalo, inclusive a forma pouco usual de calcular o meio do
  // intervalo). Reproduzida assim de propósito, para bater exatamente com
  // os números da planilha em vez de uma bisseção "mais correta" que daria
  // um resultado ligeiramente diferente.
  // ---------------------------------------------------------------------
  function cubicSpline(xsIn, ysIn, x) {
    const n = xsIn.length;
    const xin = [0].concat(xsIn), yin = [0].concat(ysIn); // 1-based, como no VBA
    const yt = new Array(n + 1).fill(0);
    const u = new Array(n).fill(0);
    yt[1] = 0; u[1] = 0;
    for (let i = 2; i <= n - 1; i++) {
      const sig = (xin[i] - xin[i - 1]) / (xin[i + 1] - xin[i - 1]);
      const p = sig * yt[i - 1] + 2;
      yt[i] = (sig - 1) / p;
      let ui = (yin[i + 1] - yin[i]) / (xin[i + 1] - xin[i]) - (yin[i] - yin[i - 1]) / (xin[i] - xin[i - 1]);
      ui = (6 * ui / (xin[i + 1] - xin[i - 1]) - sig * u[i - 1]) / p;
      u[i] = ui;
    }
    const qn = 0, un = 0;
    yt[n] = (un - qn * u[n - 1]) / (qn * yt[n - 1] + 1);
    for (let k = n - 1; k >= 1; k--) yt[k] = yt[k] * yt[k + 1] + u[k];

    let klo = 1, khi = n, K;
    do {
      K = khi - klo;
      if (xin[K] > x) khi = K; else klo = K;
      K = khi - klo;
    } while (K > 1);

    const h = xin[khi] - xin[klo];
    const a = (xin[khi] - x) / h, b = (x - xin[klo]) / h;
    return a * yin[klo] + b * yin[khi] + ((a * a * a - a) * yt[klo] + (b * b * b - b) * yt[khi]) * (h * h) / 6;
  }

  // ---------------------------------------------------------------------
  // Coeficiente de descarga dos furos de equalização de pressão — carta
  // "MiDes" da planilha original (interpolação dupla por spline cúbico:
  // 1) ao longo de sdes/torif² para cada coluna udes/cdes conhecida;
  // 2) ao longo de udes/cdes com os pontos obtidos no passo 1).
  // ---------------------------------------------------------------------
  const MIDES_SDES_TORIF2 = [0.002, 0.004, 0.006, 0.008, 0.01, 0.012, 0.013];
  const MIDES_UDES_CDES_COLS = [3.5, 3, 2.5, 2.25, 2, 1.75, 1.5, 1.25, 1, 0.75];
  const MIDES_TABLE = {
    3.5: [0.21864406779661, 0.270338983050847, 0.314406779661017, 0.340677966101694, 0.350847457627118, 0.353389830508474, 0.354237288135593],
    3: [0.22457627118644, 0.278813559322033, 0.323728813559322, 0.350847457627118, 0.360169491525423, 0.362711864406779, 0.362711864406779],
    2.5: [0.232203389830508, 0.28728813559322, 0.335593220338983, 0.364406779661017, 0.376271186440678, 0.377966101694915, 0.377966101694915],
    2.25: [0.238983050847457, 0.295762711864406, 0.346610169491525, 0.376271186440678, 0.38728813559322, 0.388983050847457, 0.389830508474576],
    2: [0.246610169491525, 0.305084745762711, 0.358474576271186, 0.388983050847457, 0.4, 0.405084745762711, 0.406779661016949],
    1.75: [0.252542372881355, 0.319491525423728, 0.372881355932203, 0.406779661016949, 0.417796610169491, 0.42457627118644, 0.425423728813559],
    1.5: [0.259322033898305, 0.333050847457627, 0.394067796610169, 0.430508474576271, 0.445762711864406, 0.451694915254237, 0.452542372881355],
    1.25: [0.270338983050847, 0.352542372881355, 0.420338983050847, 0.461864406779661, 0.479661016949152, 0.489830508474576, 0.490677966101694],
    1: [0.291525423728813, 0.38728813559322, 0.461864406779661, 0.50593220338983, 0.528813559322033, 0.539830508474576, 0.541525423728813],
    0.75: [0.320338983050847, 0.430508474576271, 0.513559322033898, 0.567796610169491, 0.595762711864406, 0.607627118644067, 0.607627118644067]
  };
  function miDes(sdes_torif2, udes_cdes) {
    // passo 1: um ponto por coluna conhecida de udes/cdes, interpolando ao longo de sdes/torif²
    const profile = MIDES_UDES_CDES_COLS.map(col => cubicSpline(MIDES_SDES_TORIF2, MIDES_TABLE[col], sdes_torif2));
    // passo 2: ao longo de udes/cdes (ordem crescente: 0.75 → 3.5), no perfil obtido acima
    const xsAsc = MIDES_UDES_CDES_COLS.slice().reverse(); // 0.75 .. 3.5
    const ysAsc = profile.slice().reverse();
    return cubicSpline(xsAsc, ysAsc, udes_cdes);
  }

  // ---------------------------------------------------------------------
  // Coeficiente de vazão das fitas de labirinto — carta "Coef Vedação" da
  // planilha original, tipo "quina/quina" (o mesmo usado na fórmula do
  // coeficiente "k" do empuxo axial — ver `betaCoef` abaixo). Interpolação
  // simples (1D, mesma rotina de spline cúbico).
  // ---------------------------------------------------------------------
  const COEF_VEDACAO_QQ_X = [0.305, 0.339, 0.689, 1.005, 2.007, 2.516, 3.009, 4.998, 7.516];
  const COEF_VEDACAO_QQ_Y = [0.807, 0.787, 0.746, 0.731, 0.701, 0.689, 0.683, 0.679, 0.678];
  function miJ(deltaOverBigDelta) { return cubicSpline(COEF_VEDACAO_QQ_X, COEF_VEDACAO_QQ_Y, deltaOverBigDelta); }

  // ---------------------------------------------------------------------
  // Coeficiente "k" de diferencial de pressão entre discos (fórmula 5-21 da
  // metodologia original), calculado a partir da vazão relativa entre os
  // furos de equalização de pressão e a folga disco↔diafragma (alfa) e da
  // vazão relativa nas fitas de labirinto (beta). `mi_r` (coeficiente de
  // vazão entre disco e diafragma, carta "MiR" — função do nº de Reynolds e
  // de um parâmetro geométrico ainda não identificado com confiança, ver
  // ARCHITECTURE.md) segue como valor ajustável (`miR`) até isso fechar.
  // Sem geometria suficiente (furos de equalização e/ou folgas), cai de
  // volta no coeficiente fixo `kThrust` (comportamento anterior).
  // ---------------------------------------------------------------------
  function thrustPressureCoefficient(stageIn, h0, h1, h2) {
    const eq = stageIn.eqHoles, seals = stageIn.seals, dia = stageIn.diaphragm, rotor = stageIn.rotor;
    const kThrustFallback = (stageIn.kThrust != null && stageIn.kThrust > 0) ? stageIn.kThrust : 0.95;
    const haveEqHoles = eq && eq.diameter > 0 && eq.qty > 0 && eq.pitchDiameter > 0;
    const haveSeals = seals && seals.deltaDiscDiaphragm > 0 && seals.zj > 0 && seals.delta > 0 && seals.bigDelta > 0;
    const haveD1n = dia && dia.d1n > 0;
    if (!haveEqHoles || !haveSeals || !haveD1n) {
      return { k: kThrustFallback, computed: false };
    }
    const rho_medio = 1 - (h0 - h1) / (h0 - h2);
    const deltaDD = seals.deltaDiscDiaphragm; // mm
    const sdes_torif2 = deltaDD * eq.diameter / Math.pow(Math.PI * eq.pitchDiameter / eq.qty, 2);
    const cdes = Math.sqrt(Math.max(0, 2000 * Math.abs(h0 - h2) * Math.abs(rho_medio)));
    const udes = Math.PI * (eq.pitchDiameter / 1000) * (stageIn.n_rpm / 60);
    const udes_cdes = cdes > 0 ? udes / cdes : 0;
    const F_des = eq.qty * eq.diameter * eq.diameter * Math.PI / 4; // mm²
    const mi_des = clamp(miDes(sdes_torif2, udes_cdes), 0.05, 1);

    const F_r = (rotor.dm - rotor.l) * Math.PI * deltaDD; // mm² — mesma fórmula da planilha (aproximação de diâmetro de raiz)
    const F_j = dia.d1n * Math.PI * seals.delta; // mm² — área do labirinto
    const mi_j = clamp(miJ(seals.delta / seals.bigDelta), 0.3, 1);

    const miR = (stageIn.miR != null && stageIn.miR > 0) ? stageIn.miR : 0.7; // placeholder — ver ARCHITECTURE.md

    const alfa = (mi_des * F_des) / (miR * F_r);
    const beta = (mi_j * F_j * Math.sqrt((1 - Math.abs(rho_medio)) / Math.abs(rho_medio))) / (F_r * miR * Math.sqrt(seals.zj));
    const k = Math.pow((alfa * beta + Math.sqrt(1 + alfa * alfa + beta * beta)) / (1 + alfa * alfa), 2);
    return { k, computed: true, rho_medio, sdes_torif2, udes_cdes, mi_des, alfa, beta, miR };
  }

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  // Busca de raiz por bisseção — robusta, usada em todos os laços de
  // continuidade/convergência (não depende de derivadas, tolera pequenos
  // degraus numéricos vindos da IAPWS-IF97).
  function bisect(fn, lo, hi, tol, maxIter) {
    let flo = fn(lo), fhi = fn(hi);
    if (isNaN(flo) || isNaN(fhi)) return { x: NaN, ok: false, reason: 'função inválida nos limites' };
    if (flo * fhi > 0) {
      return { x: Math.abs(flo) < Math.abs(fhi) ? lo : hi, ok: false, reason: 'sem troca de sinal no intervalo' };
    }
    let a = lo, b = hi, fa = flo;
    for (let i = 0; i < maxIter; i++) {
      const m = 0.5 * (a + b), fm = fn(m);
      if (Math.abs(fm) < tol || (b - a) < 1e-7 * Math.max(1, Math.abs(m))) return { x: m, ok: true };
      if (fa * fm <= 0) { b = m; } else { a = m; fa = fm; }
    }
    return { x: 0.5 * (a + b), ok: true, reason: 'iterações esgotadas (tolerância aproximada)' };
  }

  // ---------------------------------------------------------------------
  // Vazão mássica ideal através de um bocal convergente (garganta de área A,
  // m²), partindo de um estado de estagnação (h0,s0) até a pressão estática
  // p1 (bar). Devolve também se a garganta está afogada (choked) na razão
  // crítica de pressão para vapor (k≈1.3 superaquecido).
  // ---------------------------------------------------------------------
  function nozzleMassFlow(h0, s0, p0_bar, p1_bar, A_m2, k) {
    const rc = Math.pow(2 / (k + 1), k / (k - 1));
    const pStar = Math.max(p1_bar, rc * p0_bar);
    const st = Steam.stateFromPS(pStar, s0);
    const dh = h0 - st.h;
    if (dh <= 0) return { mdot: 0, c1: 0, state: st, choked: false };
    const c1 = Math.sqrt(2000 * dh);
    const mdot = A_m2 * c1 / st.v;
    return { mdot, c1, state: st, choked: pStar > p1_bar + 1e-9 };
  }

  function solveNozzleExitPressure(h0, s0, p0_bar, pDown_bar, A_m2, k, mdotTarget) {
    const rc = Math.pow(2 / (k + 1), k / (k - 1));
    const pCrit = rc * p0_bar;
    const critFlow = nozzleMassFlow(h0, s0, p0_bar, pCrit, A_m2, k);
    if (critFlow.mdot <= mdotTarget + 1e-9) {
      return { p1: pCrit, choked: true, mdotAtCrit: critFlow.mdot, ok: critFlow.mdot >= mdotTarget * 0.999 };
    }
    const res = bisect((p1) => nozzleMassFlow(h0, s0, p0_bar, p1, A_m2, k).mdot - mdotTarget, Math.max(pCrit, pDown_bar * 0.999999), p0_bar * 0.999999, 1e-5, 80);
    return { p1: res.x, choked: false, ok: res.ok };
  }

  // ---------------------------------------------------------------------
  // Vazamento em labirinto — fórmula clássica de Stodola para escoamento
  // compressível através de z dentes em série:
  //   ṁ = ψ·A·√( (p1²−p2²) / (z·v1·p1) )      [SI: Pa, m³/kg, m² → kg/s]
  // A = π·D·δ (D = diâmetro de selagem, δ = folga radial). ψ ≈ 0,7–0,85.
  // Referências: Stodola/Traupel; mesma família de fórmula usada na aba
  // "Coef Vedação" da planilha original (lá tabelada por carta, aqui em
  // forma fechada — próxima evolução pode substituir por interpolação da
  // carta real se a diferença importar).
  // ---------------------------------------------------------------------
  function stodolaLabyrinthLeak(p1_bar, v1, p2_bar, D_mm, delta_mm, zTeeth, psi) {
    if (!D_mm || !delta_mm || !zTeeth || zTeeth <= 0) return 0;
    const A = Math.PI * (D_mm / 1000) * (delta_mm / 1000);
    const p1Pa = p1_bar * 1e5, p2Pa = Math.min(p2_bar, p1_bar * 0.9999) * 1e5;
    const inside = (p1Pa * p1Pa - p2Pa * p2Pa) / (zTeeth * v1 * p1Pa);
    if (!(inside > 0)) return 0;
    return (psi || 0.75) * A * Math.sqrt(inside);
  }

  // Laminação isentálpica (throttling): entalpia constante, pressão cai,
  // entropia sobe. Usada para a válvula de admissão e para a "perda por
  // setor" (caminhos longos / válvulas intermediárias) de cada estágio.
  function throttle(p_from_bar, h, p_to_bar) {
    const st = Steam.stateFromPH(p_to_bar, h);
    return { p: p_to_bar, h, s: st.s };
  }

  // ---------------------------------------------------------------------
  // Cálculo de um estágio (linha média, diâmetro médio único).
  // ---------------------------------------------------------------------
  function stageCalc(inp) {
    const { h0: h0in, s0: s0in, p0: p0in, n_rpm, nozzle, rotor, mdot, pDownGuess, kGas, carryOverKE, extras } = inp;
    const warnings = [];

    // --- perda por setor (caminhos longos / válvulas intermediárias), se houver ---
    let p0 = p0in, h0 = h0in, s0 = s0in;
    const sectorLossPct = (extras && extras.sectorLossPct) || 0;
    if (sectorLossPct > 0) {
      const p0_thr = p0in * (1 - sectorLossPct / 100);
      const thr = throttle(p0in, h0in, p0_thr);
      p0 = thr.p; s0 = thr.s; // h0 não muda (laminação isentálpica)
      warnings.push(`Perda por setor de ${sectorLossPct.toFixed(1)}% aplicada antes do bocal (${p0in.toFixed(3)} → ${p0.toFixed(3)} bar).`);
    }

    // --- geometria derivada ---
    const A1 = (nozzle.z * nozzle.e * nozzle.l) * 1e-6; // mm² -> m²
    const A2 = (rotor.z * rotor.e * rotor.l) * 1e-6;
    const dm2_m = rotor.dm / 1000;
    const u = Math.PI * dm2_m * n_rpm / 60; // m/s

    // --- 1) bocal fixo: continuidade define a pressão estática na garganta ---
    const nz = solveNozzleExitPressure(h0, s0, p0, pDownGuess, A1, kGas, mdot);
    const p1 = nz.p1;
    if (!nz.ok) warnings.push('Bocal do injetor possivelmente subdimensionado para a vazão exigida (afogado).');
    const dh_s_nozzle = h0 - Steam.stateFromPS(p1, s0).h;
    const c1s = Math.sqrt(Math.max(0, 2000 * dh_s_nozzle));
    const phi = Math.sqrt(Math.max(0, 1 - nozzle.zeta));
    const c1 = phi * c1s;
    const h1 = h0 - c1 * c1 / 2000;

    let sinA1 = clamp((nozzle.z * nozzle.e) / (Math.PI * nozzle.dm), 0.02, 0.999);
    const alpha1 = Math.asin(sinA1);
    const cu1 = c1 * Math.cos(alpha1), ca1 = c1 * Math.sin(alpha1);
    const wu1 = cu1 - u, wa1 = ca1;
    const w1 = Math.hypot(wu1, wa1);
    const beta1 = Math.atan2(wa1, wu1);
    const st1 = Steam.stateFromPH(p1, h1);
    const s1 = st1.s;

    // --- 2) palheta móvel: continuidade define a pressão estática de saída (p2) ---
    const psi = Math.sqrt(Math.max(0, 1 - rotor.zeta));
    // β2e NÃO é dado de entrada (no programa original é calculado, não solicitado):
    // mesma relação geométrica garganta/passo usada para α1 no bocal, agora
    // para a garganta da palheta móvel.
    const sinBeta2e = clamp((rotor.z * rotor.e) / (Math.PI * rotor.dm), 0.02, 0.999);
    const beta2e = Math.asin(sinBeta2e);
    const h0rel = h1 + w1 * w1 / 2000;

    const rc_rotor = Math.pow(2 / (kGas + 1), kGas / (kGas - 1));
    const p2Crit = rc_rotor * p1;
    function rotorMdotAt(p2_bar) {
      const pThroat = Math.max(p2_bar, p2Crit);
      const st2s = Steam.stateFromPS(pThroat, s1);
      const dh = h0rel - st2s.h;
      if (dh <= 0) return { mdot: 0, w2: 0, h2: h0rel, st2: st2s, choked: false };
      const w2s = Math.sqrt(2000 * dh);
      const w2 = psi * w2s;
      const h2throat = h0rel - w2 * w2 / 2000;
      const stThroat = Steam.stateFromPH(pThroat, h2throat);
      const mdotVal = A2 * w2 / stThroat.v;
      return { mdot: mdotVal, w2, h2: h2throat, st2: stThroat, choked: pThroat > p2_bar + 1e-9 };
    }
    const critRotorFlow = rotorMdotAt(p2Crit);
    let p2, rotorState;
    if (critRotorFlow.mdot <= mdot + 1e-9) {
      p2 = p2Crit;
      rotorState = critRotorFlow;
      if (critRotorFlow.mdot < mdot * 0.999) warnings.push('Garganta da palheta móvel possivelmente subdimensionada para a vazão exigida (afogada).');
    } else {
      const rr = bisect((p2b) => rotorMdotAt(p2b).mdot - mdot, Math.max(0.02, p2Crit), p1 * 0.999999, 1e-5, 80);
      if (!rr.ok) warnings.push('Continuidade da palheta móvel não convergiu com precisão total (' + (rr.reason || '') + ').');
      p2 = rr.x;
      rotorState = rotorMdotAt(p2);
    }
    const w2 = rotorState.w2, h2 = rotorState.h2, st2 = rotorState.st2;
    const s2 = st2.s;

    // Convenção C = W + U em todo o triângulo (mesma na entrada e na saída).
    // Na saída a pá vira o escoamento relativo para o lado oposto ao da
    // entrada, por isso a componente tangencial relativa entra com sinal
    // trocado antes de somar u.
    const wu2 = -w2 * Math.cos(beta2e), wa2 = w2 * Math.sin(beta2e);
    const cu2 = wu2 + u, ca2 = wa2;
    const c2 = Math.hypot(cu2, ca2);
    const alpha2 = Math.atan2(ca2, cu2);

    // --- 3) equação de energia (Euler) e potência do estágio ---
    const dh_u = u * (cu1 - cu2) / 1000; // kJ/kg

    // vazamento em labirinto (diafragma→eixo), fórmula de Stodola
    let mdot_leak = 0;
    const seals = extras && extras.seals;
    if (seals && seals.zj > 0 && seals.delta > 0 && seals.sealDiam > 0) {
      const v0 = Steam.stateFromPH(p0, h0).v;
      mdot_leak = stodolaLabyrinthLeak(p0, v0, p2, seals.sealDiam, seals.delta, seals.zj, seals.psi);
    }
    const mdot_through_blades = Math.max(0, mdot - mdot_leak);
    const powerGross = mdot_through_blades * dh_u;

    const kFriction = (extras && extras.kFriction) || 1.1;
    const rhoAvg = 1 / ((Steam.stateFromPH(p0, h0).v + st2.v) / 2);
    const P_friction = kFriction * 1.05e-6 * rhoAvg * Math.pow(dm2_m, 2) * Math.pow(u, 3);

    const xIn = Steam.stateFromPH(p0, h0).x, xOut = st2.x;
    const xAvg = ((xIn != null ? xIn : 1) + (xOut != null ? xOut : 1)) / 2;
    const wetnessLossFactor = xAvg < 1 ? clamp(0.5 * (1 - xAvg), 0, 0.15) : 0;
    const powerNet = powerGross * (1 - wetnessLossFactor) - P_friction;

    const exitKELoss = carryOverKE ? 0 : (c2 * c2 / 2000);

    const dh_isentropic_total = h0 - Steam.stateFromPS(p2, s0).h;
    const etaStage = dh_isentropic_total > 0 ? clamp((dh_u * (1 - wetnessLossFactor) - P_friction / Math.max(mdot_through_blades, 1e-6)) / dh_isentropic_total, 0, 1) : 0;

    return {
      p0, p1, p2, h0, h1, h2, s0, s1, s2, u, c1, c2, w1, w2,
      alpha1: alpha1 * 180 / Math.PI, alpha2: alpha2 * 180 / Math.PI,
      beta1: beta1 * 180 / Math.PI, beta2: beta2e * 180 / Math.PI,
      cu1, ca1, cu2, ca2, wu1, wa1,
      dh_u, dh_isentropic_total, powerGross, powerNet, P_friction,
      mdot_leak, mdot_through_blades, exitKELoss, etaStage, xAvg,
      choked: nz.choked, sectorLossApplied: sectorLossPct > 0, warnings
    };
  }

  // ---------------------------------------------------------------------
  // Marcha completa estágio-a-estágio. `mdot0_kgs` é a vazão que entra no
  // primeiro estágio; a vazão de tomada (extração) de cada estágio, se
  // houver, é subtraída para os estágios seguintes.
  // ---------------------------------------------------------------------
  function marchStages(p0_1, T0_or_h0_is_h, stages_in, n_rpm, mdot0_kgs, pExhaust, kGas) {
    let h0 = T0_or_h0_is_h.h, s0 = T0_or_h0_is_h.s, p0 = p0_1;
    let mdotCur = mdot0_kgs;
    const out = [];
    const N = stages_in.length;
    for (let i = 0; i < N; i++) {
      const st = stages_in[i];
      const frac = (i + 1) / N;
      const pDownGuess = Math.exp(Math.log(p0_1) + frac * (Math.log(pExhaust) - Math.log(p0_1)));
      const carry = !st.discardExitKE;
      const extras = {
        kFriction: st.kFriction,
        sectorLossPct: st.sectorLossPct,
        seals: st.seals
      };
      const res = stageCalc({
        h0, s0, p0, n_rpm, nozzle: st.nozzle, rotor: st.rotor, mdot: mdotCur,
        pDownGuess, kGas, carryOverKE: carry, extras
      });
      res.mdot_stage = mdotCur;
      out.push(res);
      h0 = res.h2; s0 = res.s2; p0 = res.p2;
      if (st.extractionKgh > 0) {
        mdotCur = Math.max(1e-6, mdotCur - st.extractionKgh / 3600);
      }
    }
    return { stages: out, pFinal: p0, hFinal: h0, sFinal: s0, mdotFinal: mdotCur };
  }

  // Ângulo efetivo de saída de uma fileira de pás (fixa ou móvel) a partir da
  // geometria da garganta: sin(ângulo) = z·e/(π·dm). Mesma relação para o
  // bocal (α1) e para a palheta móvel (β2e — que por isso NÃO é pedido como
  // dado de entrada, é sempre calculado). Exposta para o ui.js mostrar uma
  // prévia ao vivo no formulário, sem precisar rodar o Engine.run inteiro.
  function calcBladeAngleDeg(z, e, dm) {
    if (!z || !e || !dm) return null;
    const s = clamp((z * e) / (Math.PI * dm), 0.02, 0.999);
    return Math.asin(s) * 180 / Math.PI;
  }

  const EngineAPI = {
    Steam,
    calcBladeAngleDeg,
    _internal: { bisect, nozzleMassFlow, solveNozzleExitPressure, stodolaLabyrinthLeak, throttle, stageCalc, marchStages, cubicSpline, miDes, miJ, thrustPressureCoefficient },

    run(params) {
      const warnings = [];
      const n_rpm = params.n_rpm;
      const P_adm = params.P_adm_bar, T_adm = params.T_adm_degC, P_exh = params.P_exh_bar;
      const mdot_kgh = params.mdot_kgh;
      const mdot_kgs = mdot_kgh / 3600;
      const kGas = params.kGas || 1.3;
      const valveLossPct0 = (params.valveLossPct != null) ? params.valveLossPct / 100 : 0.02;
      // Tol. Consumo (%) informado no Excel vira a tolerância física (em bar)
      // do laço de convergência da válvula, em vez de uma tolerância fixa.
      const tolBar = Math.max(1e-5, P_exh * ((params.tolConsumoPct != null ? params.tolConsumoPct : 3) / 100) * 0.1);

      const admState = Steam.stateFromPT(P_adm, T_adm);
      if (admState.warning) warnings.push(admState.warning);

      function afterValve(lossFrac) {
        const p0_1 = P_adm * (1 - lossFrac);
        const st = Steam.stateFromPH(p0_1, admState.h);
        return { p0_1, h: st.h, s: st.s };
      }

      let lossFrac = valveLossPct0;
      let march = null;
      if (params.stages && params.stages.length) {
        const objective = (lf) => {
          const av = afterValve(clamp(lf, 0, 0.35));
          march = marchStages(av.p0_1, av, params.stages, n_rpm, mdot_kgs, P_exh, kGas);
          return march.pFinal - P_exh;
        };
        const conv = bisect(objective, 0.0001, 0.35, tolBar, 60);
        lossFrac = conv.x;
        if (!conv.ok) warnings.push('Convergência da perda de válvula não fechou perfeitamente na pressão de escape (' + (conv.reason || '') + ') — verifique se a geometria informada é compatível com a vazão e a razão de pressões pedidas.');
        objective(lossFrac);
      } else {
        warnings.push('Nenhum estágio definido.');
      }

      let powerInternal = 0, frictionTotal = 0, leakTotal = 0;
      const stages = march ? march.stages : [];
      stages.forEach(s => { powerInternal += s.powerNet; frictionTotal += s.P_friction; leakTotal += s.mdot_leak; s.warnings.forEach(w => warnings.push(w)); });
      const lastStage = stages[stages.length - 1];
      const mdotLast = lastStage ? lastStage.mdot_through_blades : mdot_kgs;
      const exitKELossLast = lastStage ? lastStage.exitKELoss * mdotLast : 0;
      const powerInternalFinal = powerInternal - exitKELossLast;

      const gearboxEff = params.gearboxEff != null ? params.gearboxEff : 0.985;
      const generatorEff = params.generatorEff != null ? params.generatorEff : 0.96;
      const powerShaft = powerInternalFinal * gearboxEff * generatorEff;

      const dh_isentropic_overall = admState.h - Steam.stateFromPS(P_exh, admState.s).h;
      const etaInternal = dh_isentropic_overall > 0 ? powerInternalFinal / (mdot_kgs * dh_isentropic_overall) : 0;
      const etaOverall = dh_isentropic_overall > 0 ? powerShaft / (mdot_kgs * dh_isentropic_overall) : 0;
      const specificConsumption = powerShaft > 0 ? mdot_kgh / powerShaft : NaN;

      // ======================================================================
      // EMPUXO AXIAL — reproduzindo a metodologia real da planilha (Output,
      // linhas 200-238), não mais uma aproximação de 1ª ordem. Estrutura,
      // termo a termo (nomes conforme a planilha original):
      //
      //  RaI[estágio]  = ṁ_móvel·(ca1−ca2)                    (força de momento)
      //                + Δp_rotor · (π·dm2·l2) · 0,1           (força de pressão no disco)
      //    onde Δp_rotor = p1 − p2 (queda de pressão SÓ NO ROTOR — "P méd"
      //    menos "P2" na planilha — NÃO é p0−p2: o bocal fica na parte fixa,
      //    não empurra o disco).
      //  RaIII[estágio] = p1 · π·(d2n²−d1n²)/40                (pressão média
      //    agindo na face anular do eixo entre "antes" e "depois" do disco,
      //    só quando d1n e d2n são informados).
      //  (RaII e RaIV existem na planilha mas NÃO entram na soma final — a
      //   fórmula H234 só soma RaI e RaIII; ver ARCHITECTURE.md.)
      //  Empuxo a favor  = Σ(RaI + RaIII) + Fant+
      //  Empuxo contra   = Σ Fak- (um por pistão de compensação)
      //  Empuxo resultante = a favor − contra                  [N]
      //  Pressão específica no mancal = resultante / área do mancal   [MPa]
      //
      //  Pistão(ões) de compensação (AK): cada diafragma com `dak>0` é um
      //  degrau da mesma cadeia — a área de cada um é a diferença entre o
      //  seu próprio dak² e o dak² do degrau anterior (ou d2n do 1º estágio,
      //  se for o primeiro degrau), pressurizada pela pressão de admissão do
      //  estágio referenciado em "akStage" (Fak-, contra o empuxo). O último
      //  degrau tem ainda uma face traseira, do tamanho do trem inteiro
      //  (d2n do 1º estágio até o dak do último AK), pressurizada pela
      //  pressão de escape (Fant+, a favor do empuxo) — representa a câmara
      //  de baixa pressão do lado de fora do pistão.
      // ======================================================================
      let sumRaFavor = 0;
      const axialByStage = stages.map((s, i) => {
        const st = params.stages[i];
        // "k" = coeficiente de diferencial de pressão entre discos. Calculado
        // pela fórmula real (furos de equalização + labirintos, ver
        // thrustPressureCoefficient) sempre que a geometria necessária foi
        // informada; senão cai de volta no valor ajustável kThrust.
        const kRes = thrustPressureCoefficient({ ...st, n_rpm }, s.h0, s.h1, s.h2);
        const dPdisc_bar = (s.p1 - s.p2) * kRes.k; // queda de pressão só no rotor, corrigida por k
        const A_disc_mm2 = Math.PI * st.rotor.dm * st.rotor.l; // π·dm2·l2 (mesma aproximação da planilha)
        const F_pressure = dPdisc_bar * A_disc_mm2 * 0.1; // bar·mm² → N
        const F_momentum = s.mdot_through_blades * (s.ca1 - s.ca2); // N
        const F_RaI = F_pressure + F_momentum;

        let F_RaIII = 0;
        const dia = st.diaphragm;
        if (dia && dia.d1n > 0 && dia.d2n > 0) {
          F_RaIII = s.p1 * Math.PI * (dia.d2n * dia.d2n - dia.d1n * dia.d1n) / 40; // já inclui a conversão bar·mm²→N (/10) e a área anular (/4)
        }
        const F_total = F_RaI + F_RaIII;
        sumRaFavor += F_total;
        if (kRes.computed) warnings.push(`Estágio ${i + 1}: coeficiente k do empuxo calculado a partir dos furos de equalização e labirintos (k=${kRes.k.toFixed(4)}, α=${kRes.alfa.toFixed(4)}, β=${kRes.beta.toFixed(4)}, μ_r=${kRes.miR.toFixed(2)} — placeholder, ver ARCHITECTURE.md).`);
        return { F_pressure, F_momentum, F_RaI, F_RaIII, F_total, kThrustUsed: kRes.k, kComputed: kRes.computed };
      });

      // Cadeia do(s) pistão(ões) de compensação (AK) — definidos numa lista
      // própria da máquina (params.akDevices), NÃO dentro de cada estágio:
      // fisicamente o(s) AK pode(m) ficar em qualquer diafragma e nem sempre
      // há um por estágio. Cada item: { dak (mm), akStage (nº do estágio,
      // 1-based, cuja pressão de admissão pressuriza aquele degrau) }.
      const firstDiaphragm = params.stages[0] && params.stages[0].diaphragm;
      const baseD_mm = (firstDiaphragm && firstDiaphragm.d2n > 0) ? firstDiaphragm.d2n : 0;
      const akList = (params.akDevices || []).filter(ak => ak && ak.dak > 0);

      let sumFakContra = 0, F_antFavor = 0;
      if (akList.length > 0 && baseD_mm > 0) {
        let prevD_mm = baseD_mm;
        akList.forEach(ak => {
          let refIdx1based = parseInt(ak.akStage, 10);
          if (isNaN(refIdx1based) || refIdx1based < 1 || refIdx1based > stages.length) refIdx1based = 1;
          const pRef_bar = stages[refIdx1based - 1].p0; // "pressão ligação AK" = pressão de admissão do estágio referenciado
          const A_m2 = Math.PI / 4 * (Math.pow(ak.dak / 1000, 2) - Math.pow(prevD_mm / 1000, 2));
          sumFakContra += pRef_bar * 1e5 * A_m2;
          prevD_mm = ak.dak;
        });
        const A_ant_m2 = Math.PI / 4 * (Math.pow(prevD_mm / 1000, 2) - Math.pow(baseD_mm / 1000, 2));
        F_antFavor = P_exh * 1e5 * A_ant_m2;
      } else if (akList.length > 0 && baseD_mm <= 0) {
        warnings.push('Pistão(ões) de compensação informado(s), mas o Ø depois do disco (d2n) do 1º estágio não foi preenchido — necessário como diâmetro-base da cadeia. Empuxo do(s) AK não computado.');
      }
      if (params.controlWheelType === 'Curtis') {
        warnings.push('Roda de regulagem tipo Curtis: a planilha original soma uma correção extra do canal do disco Curtis ao empuxo — ainda não implementada aqui.');
      }

      const axialThrustTotal = sumRaFavor + F_antFavor - sumFakContra;

      // Pressão específica no mancal axial — o valor que a planilha original
      // chama de "Empuxo Axial Específico" (MPa), a partir da área da
      // pastilha do mancal (α·π/4·(De²−Di²), ou uma área informada direto).
      let thrustPadArea_mm2 = 0;
      if (params.thrustPad) {
        const tp = params.thrustPad;
        thrustPadArea_mm2 = tp.areaOverride > 0 ? tp.areaOverride
          : (tp.De > 0 && tp.Di > 0) ? (tp.alpha || 1) * Math.PI / 4 * (tp.De * tp.De - tp.Di * tp.Di) : 0;
      }
      const axialSpecificPressureMPa = thrustPadArea_mm2 > 0 ? axialThrustTotal / thrustPadArea_mm2 : null;
      if (axialThrustTotal !== 0 && !(thrustPadArea_mm2 > 0)) {
        warnings.push('Área do mancal axial não informada — não foi possível calcular a pressão específica (MPa), só a força resultante (N).');
      }

      return {
        warnings,
        valveLossPct: lossFrac * 100,
        admState,
        stages,
        axialByStage,
        summary: {
          powerInternal: powerInternalFinal,
          powerShaft,
          etaInternal, etaOverall,
          specificConsumption,
          mdot_kgh, mdot_kgs,
          mdotFinal_kgs: march ? march.mdotFinal : mdot_kgs,
          frictionTotal, leakTotal,
          pFinalComputed: march ? march.pFinal : NaN,
          pExhTarget: P_exh,
          axialThrustTotal, sumFakContra, F_antFavor,
          thrustPadArea_mm2, axialSpecificPressureMPa
        }
      };
    }
  };

  if (typeof module !== 'undefined') module.exports = EngineAPI;
  else global.Engine = EngineAPI;
})(typeof window !== 'undefined' ? window : globalThis);
