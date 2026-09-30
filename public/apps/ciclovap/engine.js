// =============================================================================
// CICLOVAP — engine.js
// Motor de cálculo de ciclos a vapor (balanço de massa e energia de um
// fluxograma arbitrário). Sem DOM, sem fetch, sem localStorage.
//
// Requer steam.js (API do hub: stateFromPT / stateFromPS / stateFromPH / satAt)
// carregado ANTES deste arquivo. Testável isoladamente:
//   node -e "global.Steam=require('./steam.js'); const E=require('./engine.js'); ..."
//
// Entrada de Engine.run(params):
//   params = { components: [{id, type, name, params:{...}}],
//              connections: [{id, from:{c,p}, to:{c,p}}] }
//   (campos de desenho como x/y/flip são ignorados aqui)
// Saída: { ok, errors[], warnings[], streams[], streamMap{}, comps{}, totals,
//          iterations, newton, residual }
//
// Método (orientado a equações):
//   1. Cada corrente tem 3 incógnitas: vazão m [kg/s], pressão P [bar], entalpia h [kJ/kg].
//   2. Cada componente contribui equações na forma "variável = f(outras)",
//      com formas alternativas (ex.: m_saida = m_entrada OU m_entrada = m_saida).
//   3. Um emparelhamento equação↔variável (algoritmo de Kuhn) verifica os graus
//      de liberdade antes de calcular e diz exatamente o que está sub ou
//      sobre-especificado.
//   4. Substituição sucessiva (Gauss-Seidel) com as formas emparelhadas dá a
//      estimativa; Newton-Raphson (Jacobiano por diferenças finitas) fecha
//      reciclos e polimento. Tolerância: resíduo escalado < 1e-7.
// =============================================================================
var Engine = (() => {
  // ---------------------------------------------------------------------------
  // Adaptador para o steam.js do hub. Todo acesso a propriedades passa por aqui,
  // então o motor não depende de detalhes internos do steam.js (só da API
  // documentada no ARCHITECTURE.md). Unidades: bar, °C, kJ/kg, kJ/kg·K.
  // ---------------------------------------------------------------------------
  const SteamLib = (typeof Steam !== 'undefined') ? Steam : (typeof require !== 'undefined' ? require('./steam.js') : null);
  if (!SteamLib || typeof SteamLib.stateFromPT !== 'function') throw new Error('CICLOVAP: steam.js (API do hub) precisa ser carregado antes do engine.js.');
  const St = (() => {
    const PMIN = 0.00612, PCRIT = 220.64, PMAX_OK = 165.29;
    const clampP = P => Math.min(Math.max(P, PMIN), 1000);
    const pick = (o, ks) => { for (const k of ks) if (o && Number.isFinite(o[k])) return o[k]; return NaN; };
    const cache = new Map();
    function sat(P) {
      P = clampP(Math.min(P, PCRIT - 0.01));
      let r = cache.get(P);
      if (r) return r;
      const q = SteamLib.satAt(P);
      r = { T: pick(q, ['Tsat', 'T', 'T_degC']), hf: q.hL, hg: q.hV, sf: q.sL, sg: q.sV };
      if (cache.size > 5000) cache.clear();
      cache.set(P, r);
      return r;
    }
    const tsat = P => sat(P).T;
    const h_pT = (P, T) => SteamLib.stateFromPT(clampP(P), T).h;
    const s_pT = (P, T) => SteamLib.stateFromPT(clampP(P), T).s;
    function state_ph(P, h) {
      P = clampP(P);
      if (P < PCRIT - 0.01) {
        const S = sat(P);
        if (h >= S.hf && h <= S.hg) {
          const x = (h - S.hf) / (S.hg - S.hf);
          return { T: S.T, s: S.sf + x * (S.sg - S.sf), x, phase: 'mix' };
        }
        const q = SteamLib.stateFromPH(P, h);
        return { T: pick(q, ['T', 'T_degC', 't']), s: q.s, x: null, phase: h < S.hf ? 'liq' : 'vap' };
      }
      const q = SteamLib.stateFromPH(P, h), T = pick(q, ['T', 'T_degC', 't']);
      return { T, s: q.s, x: null, phase: T < 350 ? 'liq' : 'vap' };
    }
    function h_ps(P, s) {
      P = clampP(P);
      if (P < PCRIT - 0.01) {
        const S = sat(P);
        if (s >= S.sf && s <= S.sg) { const x = (s - S.sf) / (S.sg - S.sf); return S.hf + x * (S.hg - S.hf); }
      }
      return SteamLib.stateFromPS(P, s).h;
    }
    function psat(T) { // inversa de tsat por bisseção em log(P)
      let a = Math.log(PMIN), b = Math.log(PCRIT - 0.02);
      for (let i = 0; i < 80; i++) { const c = (a + b) / 2; if (tsat(Math.exp(c)) < T) a = c; else b = c; }
      return Math.exp((a + b) / 2);
    }
    return { sat, tsat, psat, h_pT, s_pT, state_ph, h_ps, hf: P => sat(P).hf, hg: P => sat(P).hg, PMIN, PCRIT, PMAX_OK };
  })();
// ===== Componentes, montagem do sistema e solver

  function expand(P1, h1, P2, eta) {
    const s1 = St.state_ph(P1, h1).s;
    const h2s = St.h_ps(P2, s1);
    return h1 - eta * (h1 - h2s);
  }
  function compress(P1, h1, P2, eta) {
    const s1 = St.state_ph(P1, h1).s;
    const h2s = St.h_ps(P2, s1);
    return h1 + (h2s - h1) / eta;
  }
  const pos = (v, lo) => Math.max(v, lo);

  // kind: 'vapor' | 'agua' | 'geral'; side: l r t b
  const DEFS = {
    caldeira: {
      name: 'Caldeira', short: 'CAL',
      ports: {
        entrada: { io: 'in', kind: 'agua', label: 'Água de alimentação' },
        saida: { io: 'out', kind: 'vapor', label: 'Vapor vivo' }
      },
      params: [
        { k: 'P', label: 'Pressão do vapor', u: 'bar', v: 100 },
        { k: 'T', label: 'Temperatura do vapor', u: '°C', v: 540 },
        { k: 'm', label: 'Vazão de vapor', u: 'kg/s', v: 100 },
        { k: 'eta', label: 'Eficiência da caldeira', u: '%', v: 88 }
      ],
      eqs(c, S, E) {
        const p = c.params;
        E([['saida', 'm', () => p.m]]);
        E([['saida', 'P', () => p.P]]);
        E([['saida', 'h', () => St.h_pT(p.P, p.T)]]);
      },
      post(c, S, R) {
        const p = c.params;
        const Q = S.m('saida') * (S.h('saida') - S.h('entrada'));
        R.Qcald += Q; R.Qcomb += Q / (p.eta / 100);
        const Ts = St.tsat(p.P);
        if (p.T <= Ts + 1) R.err(c, `temperatura do vapor (${f1(p.T)} °C) não está acima da saturação (${f1(Ts)} °C a ${f1(p.P)} bar).`);
        if (S.P('entrada') < p.P) R.warn(c, `pressão da água de alimentação (${f1(S.P('entrada'))} bar) menor que a do vapor (${f1(p.P)} bar).`);
        const dm = S.m('entrada') - S.m('saida');
        if (Math.abs(dm) > 1e-4 * Math.max(1, p.m)) R.warn(c, `a vazão de água que retorna (${f2(S.m('entrada'))} kg/s) difere da vazão de vapor. Confira se todo o fluido volta ao ciclo.`);
        return [['Calor absorvido', Q / 1000, 'MW'], ['Calor do combustível', Q / (p.eta / 100) / 1000, 'MW'], ['Temperatura de saturação', Ts, '°C']];
      }
    },
    turbina: {
      name: 'Turbina', short: 'TV',
      ports: {
        entrada: { io: 'in', kind: 'vapor', label: 'Admissão' },
        saida: { io: 'out', kind: 'vapor', label: 'Exaustão' }
      },
      params: [
        { k: 'Ps', label: 'Pressão de exaustão', u: 'bar', v: 0.1 },
        { k: 'eta', label: 'Eficiência isentrópica', u: '%', v: 85 },
        { k: 'emg', label: 'Eficiência mecânica × gerador', u: '%', v: 97 }
      ],
      eqs(c, S, E) {
        const p = c.params;
        E([['saida', 'm', () => S.m('entrada')], ['entrada', 'm', () => S.m('saida')]]);
        E([['saida', 'P', () => p.Ps]]);
        E([['saida', 'h', () => expand(S.P('entrada'), S.h('entrada'), p.Ps, p.eta / 100)]]);
      },
      post(c, S, R) {
        const Wf = S.m('entrada') * (S.h('entrada') - S.h('saida'));
        const We = Wf * c.params.emg / 100;
        R.Wturb += We; R.Wturb_f += Wf;
        checkExhaust(c, S, R, 'saida');
        if (c.params.Ps >= S.P('entrada')) R.err(c, 'pressão de exaustão maior ou igual à de admissão.');
        return [['Potência elétrica', We / 1000, 'MW'], ['Potência no eixo', Wf / 1000, 'MW']];
      }
    },
    turbina_ext: {
      name: 'Turbina c/ extração', short: 'TVX',
      ports: {
        entrada: { io: 'in', kind: 'vapor', label: 'Admissão' },
        extracao: { io: 'out', kind: 'vapor', label: 'Extração' },
        saida: { io: 'out', kind: 'vapor', label: 'Exaustão' }
      },
      params: [
        { k: 'Pe', label: 'Pressão de extração', u: 'bar', v: 10 },
        { k: 'Ps', label: 'Pressão de exaustão', u: 'bar', v: 0.1 },
        { k: 'eta', label: 'Eficiência isentrópica', u: '%', v: 85 },
        { k: 'emg', label: 'Eficiência mecânica × gerador', u: '%', v: 97 }
      ],
      eqs(c, S, E) {
        const p = c.params;
        E([['extracao', 'P', () => p.Pe]]);
        E([['extracao', 'h', () => expand(S.P('entrada'), S.h('entrada'), p.Pe, p.eta / 100)]]);
        E([['saida', 'm', () => S.m('entrada') - S.m('extracao')],
           ['entrada', 'm', () => S.m('saida') + S.m('extracao')],
           ['extracao', 'm', () => S.m('entrada') - S.m('saida')]]);
        E([['saida', 'P', () => p.Ps]]);
        E([['saida', 'h', () => expand(p.Pe, S.h('extracao'), p.Ps, p.eta / 100)]]);
      },
      post(c, S, R) {
        const p = c.params;
        const Wf = S.m('entrada') * (S.h('entrada') - S.h('extracao')) + S.m('saida') * (S.h('extracao') - S.h('saida'));
        const We = Wf * p.emg / 100;
        R.Wturb += We; R.Wturb_f += Wf;
        if (!(p.Pe < S.P('entrada') && p.Ps < p.Pe)) R.err(c, 'as pressões devem cair na ordem admissão > extração > exaustão.');
        checkExhaust(c, S, R, 'saida');
        return [['Potência elétrica', We / 1000, 'MW'], ['Potência no eixo', Wf / 1000, 'MW'], ['Vazão de extração', S.m('extracao'), 'kg/s']];
      }
    },
    condensador: {
      name: 'Condensador', short: 'CD',
      ports: {
        entrada: { io: 'in', kind: 'vapor', label: 'Vapor de exaustão' },
        dreno: { io: 'in', kind: 'agua', label: 'Drenos (opcional)', optional: true },
        saida: { io: 'out', kind: 'agua', label: 'Condensado' }
      },
      params: [{ k: 'sub', label: 'Sub-resfriamento do condensado', u: '°C', v: 0 }],
      eqs(c, S, E) {
        const p = c.params;
        E([['saida', 'm', () => S.m('entrada') + S.m('dreno')],
           ['entrada', 'm', () => S.m('saida') - S.m('dreno')],
           ['dreno', 'm', () => S.m('saida') - S.m('entrada')]]);
        E([['saida', 'P', () => S.P('entrada')], ['entrada', 'P', () => S.P('saida')]]);
        E([['saida', 'h', () => p.sub > 0 ? St.h_pT(S.P('entrada'), St.tsat(S.P('entrada')) - p.sub) : St.hf(S.P('entrada'))]]);
      },
      post(c, S, R) {
        const Q = S.m('entrada') * S.h('entrada') + S.m('dreno') * S.h('dreno') - S.m('saida') * S.h('saida');
        R.Qcond += Q;
        return [['Calor rejeitado', Q / 1000, 'MW'], ['Temperatura de condensação', St.tsat(S.P('entrada')), '°C']];
      }
    },
    bomba: {
      name: 'Bomba', short: 'BB',
      ports: {
        entrada: { io: 'in', kind: 'agua', label: 'Sucção' },
        saida: { io: 'out', kind: 'agua', label: 'Recalque' }
      },
      params: [
        { k: 'Ps', label: 'Pressão de recalque', u: 'bar', v: 120 },
        { k: 'eta', label: 'Eficiência isentrópica', u: '%', v: 80 }
      ],
      eqs(c, S, E) {
        const p = c.params;
        E([['saida', 'm', () => S.m('entrada')], ['entrada', 'm', () => S.m('saida')]]);
        E([['saida', 'P', () => p.Ps]]);
        E([['saida', 'h', () => compress(S.P('entrada'), S.h('entrada'), p.Ps, p.eta / 100)]]);
      },
      post(c, S, R) {
        const W = S.m('entrada') * (S.h('saida') - S.h('entrada'));
        R.Wbomb += W;
        if (S.h('entrada') > St.hf(S.P('entrada')) + 0.5) R.warn(c, 'a sucção não está em líquido sub-resfriado (risco de cavitação).');
        if (c.params.Ps <= S.P('entrada')) R.err(c, 'pressão de recalque menor ou igual à de sucção.');
        return [['Potência consumida', W / 1000, 'MW']];
      }
    },
    aquecedor: {
      name: 'Aquecedor fechado', short: 'AQ',
      ports: {
        vapor: { io: 'in', kind: 'vapor', label: 'Vapor de extração' },
        dreno_in: { io: 'in', kind: 'agua', label: 'Dreno em cascata (opcional)', optional: true },
        agua_in: { io: 'in', kind: 'agua', label: 'Água (entrada)' },
        agua_out: { io: 'out', kind: 'agua', label: 'Água (saída)' },
        dreno: { io: 'out', kind: 'agua', label: 'Dreno' }
      },
      params: [
        { k: 'TTD', label: 'Diferença terminal (TTD)', u: '°C', v: 3 },
        { k: 'DCA', label: 'Aproximação do dreno (DCA), 0 = sem resfriador', u: '°C', v: 6 },
        { k: 'dP', label: 'Perda de carga lado água', u: 'bar', v: 1 }
      ],
      eqs(c, S, E) {
        const p = c.params;
        const hDr = () => {
          const Ps = S.P('vapor');
          if (p.DCA > 0) {
            const Tw = St.state_ph(S.P('agua_in'), S.h('agua_in')).T;
            return St.h_pT(Ps, Math.min(Tw + p.DCA, St.tsat(Ps)));
          }
          return St.hf(Ps);
        };
        E([['agua_out', 'm', () => S.m('agua_in')], ['agua_in', 'm', () => S.m('agua_out')]]);
        E([['agua_out', 'P', () => S.P('agua_in') - p.dP], ['agua_in', 'P', () => S.P('agua_out') + p.dP]]);
        E([['agua_out', 'h', () => St.h_pT(S.P('agua_out'), St.tsat(S.P('vapor')) - p.TTD)]]);
        E([['dreno', 'P', () => S.P('vapor')]]);
        E([['dreno', 'h', hDr]]);
        E([['dreno', 'm', () => S.m('vapor') + S.m('dreno_in')],
           ['vapor', 'm', () => S.m('dreno') - S.m('dreno_in')],
           ['dreno_in', 'm', () => S.m('dreno') - S.m('vapor')]]);
        E([['vapor', 'm', () => (S.m('agua_in') * (S.h('agua_out') - S.h('agua_in')) - S.m('dreno_in') * (S.h('dreno_in') - S.h('dreno'))) / pos(S.h('vapor') - S.h('dreno'), 50)],
           ['agua_in', 'm', () => (S.m('vapor') * (S.h('vapor') - S.h('dreno')) + S.m('dreno_in') * (S.h('dreno_in') - S.h('dreno'))) / pos(S.h('agua_out') - S.h('agua_in'), 1)]]);
      },
      post(c, S, R) {
        const Q = S.m('agua_in') * (S.h('agua_out') - S.h('agua_in'));
        const Tin = St.state_ph(S.P('agua_in'), S.h('agua_in')).T;
        const Tout = St.state_ph(S.P('agua_out'), S.h('agua_out')).T;
        if (Tout <= Tin) R.err(c, 'a água sairia mais fria do que entra: o vapor de extração tem pressão baixa demais para este ponto do ciclo.');
        if (S.h('vapor') <= S.h('dreno')) R.err(c, 'o vapor de aquecimento tem entalpia menor que o dreno.');
        return [['Calor trocado', Q / 1000, 'MW'], ['Vazão de vapor', S.m('vapor'), 'kg/s'], ['Temperatura de saturação do vapor', St.tsat(S.P('vapor')), '°C'], ['Elevação de temperatura da água', Tout - Tin, '°C']];
      }
    },
    desaerador: {
      name: 'Desaerador', short: 'DA',
      ports: {
        vapor: { io: 'in', kind: 'vapor', label: 'Vapor' },
        dreno_in: { io: 'in', kind: 'agua', label: 'Drenos (opcional)', optional: true },
        agua_in: { io: 'in', kind: 'agua', label: 'Condensado' },
        saida: { io: 'out', kind: 'agua', label: 'Água desaerada' }
      },
      params: [],
      note: 'Aquecedor de mistura: a pressão é a do vapor que entra e a água sai como líquido saturado. A vazão de vapor é calculada pelo balanço de energia.',
      eqs(c, S, E) {
        E([['saida', 'P', () => S.P('vapor')], ['vapor', 'P', () => S.P('saida')]]);
        E([['saida', 'h', () => St.hf(S.P('vapor'))]]);
        E([['saida', 'm', () => S.m('agua_in') + S.m('vapor') + S.m('dreno_in')],
           ['agua_in', 'm', () => S.m('saida') - S.m('vapor') - S.m('dreno_in')],
           ['vapor', 'm', () => S.m('saida') - S.m('agua_in') - S.m('dreno_in')],
           ['dreno_in', 'm', () => S.m('saida') - S.m('agua_in') - S.m('vapor')]]);
        E([['vapor', 'm', () => (S.m('agua_in') * (S.h('saida') - S.h('agua_in')) + S.m('dreno_in') * (S.h('saida') - S.h('dreno_in'))) / pos(S.h('vapor') - S.h('saida'), 50)],
           ['agua_in', 'm', () => (S.m('vapor') * (S.h('vapor') - S.h('saida')) - S.m('dreno_in') * (S.h('saida') - S.h('dreno_in'))) / pos(S.h('saida') - S.h('agua_in'), 1)]]);
      },
      post(c, S, R) {
        if (S.P('agua_in') < S.P('vapor')) R.warn(c, `o condensado chega com pressão (${f1(S.P('agua_in'))} bar) menor que a do desaerador (${f1(S.P('vapor'))} bar).`);
        if (S.m('vapor') < 0) R.err(c, 'vazão de vapor negativa: a água já chega mais quente que a saturação. Reduza o aquecimento a montante ou aumente a pressão do desaerador.');
        return [['Pressão de operação', S.P('vapor'), 'bar'], ['Temperatura', St.tsat(S.P('vapor')), '°C'], ['Vazão de vapor', S.m('vapor'), 'kg/s']];
      }
    },
    dessuperaquecedor: {
      name: 'Dessuperaquecedor', short: 'DSA',
      ports: {
        vapor: { io: 'in', kind: 'vapor', label: 'Vapor superaquecido' },
        agua: { io: 'in', kind: 'agua', label: 'Água de atemperação' },
        saida: { io: 'out', kind: 'vapor', label: 'Vapor atemperado' }
      },
      params: [{ k: 'T', label: 'Temperatura de saída', u: '°C', v: 220 }],
      eqs(c, S, E) {
        const p = c.params;
        E([['saida', 'P', () => S.P('vapor')]]);
        E([['saida', 'h', () => St.h_pT(S.P('vapor'), p.T)]]);
        E([['saida', 'm', () => S.m('vapor') + S.m('agua')],
           ['vapor', 'm', () => S.m('saida') - S.m('agua')],
           ['agua', 'm', () => S.m('saida') - S.m('vapor')]]);
        E([['agua', 'm', () => S.m('vapor') * (S.h('vapor') - S.h('saida')) / pos(S.h('saida') - S.h('agua'), 50)],
           ['vapor', 'm', () => S.m('agua') * (S.h('saida') - S.h('agua')) / pos(S.h('vapor') - S.h('saida'), 1)]]);
      },
      post(c, S, R) {
        const Ts = St.tsat(S.P('vapor'));
        if (c.params.T < Ts + 3) R.warn(c, `temperatura de saída muito próxima da saturação (${f1(Ts)} °C).`);
        if (S.m('agua') < 0) R.err(c, 'o vapor já chega abaixo da temperatura pedida (vazão de água negativa).');
        return [['Vazão de água', S.m('agua'), 'kg/s'], ['Superaquecimento na saída', c.params.T - Ts, '°C']];
      }
    },
    valvula: {
      name: 'Válvula', short: 'VR',
      ports: {
        entrada: { io: 'in', kind: 'geral', label: 'Entrada' },
        saida: { io: 'out', kind: 'geral', label: 'Saída' }
      },
      params: [{ k: 'Ps', label: 'Pressão de saída', u: 'bar', v: 5 }],
      note: 'Estrangulamento isentálpico (h constante).',
      eqs(c, S, E) {
        E([['saida', 'm', () => S.m('entrada')], ['entrada', 'm', () => S.m('saida')]]);
        E([['saida', 'P', () => c.params.Ps]]);
        E([['saida', 'h', () => S.h('entrada')], ['entrada', 'h', () => S.h('saida')]]);
      },
      post(c, S, R) {
        if (c.params.Ps > S.P('entrada')) R.err(c, 'pressão de saída maior que a de entrada.');
        return [['Queda de pressão', S.P('entrada') - S.P('saida'), 'bar']];
      }
    },
    divisor: {
      name: 'Divisor', short: 'DV',
      ports: {
        entrada: { io: 'in', kind: 'geral', label: 'Entrada' },
        saida1: { io: 'out', kind: 'geral', label: 'Saída 1' },
        saida2: { io: 'out', kind: 'geral', label: 'Saída 2' }
      },
      params: [
        { k: 'modo', label: 'Vazão da saída 2', type: 'select', v: 'livre', options: [['livre', 'Definida a jusante'], ['fracao', 'Fração da entrada']] },
        { k: 'f', label: 'Fração para a saída 2', u: '–', v: 0.1, when: p => p.modo === 'fracao' }
      ],
      eqs(c, S, E) {
        const p = c.params;
        E([['saida1', 'm', () => S.m('entrada') - S.m('saida2')],
           ['entrada', 'm', () => S.m('saida1') + S.m('saida2')],
           ['saida2', 'm', () => S.m('entrada') - S.m('saida1')]]);
        if (p.modo === 'fracao') E([['saida2', 'm', () => p.f * S.m('entrada')], ['entrada', 'm', () => S.m('saida2') / Math.max(p.f, 1e-6)]]);
        E([['saida1', 'P', () => S.P('entrada')], ['entrada', 'P', () => S.P('saida1')]]);
        E([['saida2', 'P', () => S.P('entrada')], ['entrada', 'P', () => S.P('saida2')]]);
        E([['saida1', 'h', () => S.h('entrada')], ['entrada', 'h', () => S.h('saida1')]]);
        E([['saida2', 'h', () => S.h('entrada')], ['entrada', 'h', () => S.h('saida2')]]);
      },
      post(c, S, R) {
        if (S.m('saida1') < -1e-6 || S.m('saida2') < -1e-6) R.err(c, 'uma das saídas ficou com vazão negativa.');
        return [['Fração na saída 2', S.m('saida2') / Math.max(S.m('entrada'), 1e-9), '–']];
      }
    },
    misturador: {
      name: 'Misturador', short: 'MX',
      ports: {
        entrada1: { io: 'in', kind: 'geral', label: 'Entrada 1' },
        entrada2: { io: 'in', kind: 'geral', label: 'Entrada 2' },
        saida: { io: 'out', kind: 'geral', label: 'Saída' }
      },
      params: [],
      note: 'Pressão de saída igual à da entrada 1; a entrada 2 é estrangulada até ela.',
      eqs(c, S, E) {
        E([['saida', 'm', () => S.m('entrada1') + S.m('entrada2')],
           ['entrada1', 'm', () => S.m('saida') - S.m('entrada2')],
           ['entrada2', 'm', () => S.m('saida') - S.m('entrada1')]]);
        E([['saida', 'P', () => S.P('entrada1')], ['entrada1', 'P', () => S.P('saida')]]);
        E([['saida', 'h', () => {
          const m = S.m('entrada1') + S.m('entrada2');
          return Math.abs(m) < 1e-9 ? S.h('entrada1') : (S.m('entrada1') * S.h('entrada1') + S.m('entrada2') * S.h('entrada2')) / m;
        }]]);
      },
      post(c, S, R) {
        if (S.P('entrada2') < S.P('entrada1') - 1e-6) R.warn(c, 'a entrada 2 tem pressão menor que a entrada 1 (o fluxo real não entraria).');
        return [];
      }
    },
    processo: {
      name: 'Consumidor de processo', short: 'PR',
      ports: {
        entrada: { io: 'in', kind: 'vapor', label: 'Vapor de processo' },
        saida: { io: 'out', kind: 'agua', label: 'Retorno de condensado' }
      },
      params: [
        { k: 'modo', label: 'Vazão de vapor', type: 'select', v: 'Q', options: [['Q', 'Definida pela carga térmica'], ['livre', 'Definida a montante']] },
        { k: 'Q', label: 'Carga térmica do processo', u: 'MW', v: 30, when: p => p.modo === 'Q' },
        { k: 'dP', label: 'Perda de carga', u: 'bar', v: 0.5 },
        { k: 'sub', label: 'Sub-resfriamento do retorno', u: '°C', v: 0 }
      ],
      note: 'Entrega calor ao processo e devolve condensado.',
      eqs(c, S, E) {
        const p = c.params;
        E([['saida', 'm', () => S.m('entrada')], ['entrada', 'm', () => S.m('saida')]]);
        if (p.modo === 'Q') E([['entrada', 'm', () => p.Q * 1000 / pos(S.h('entrada') - S.h('saida'), 50)]]);
        E([['saida', 'P', () => S.P('entrada') - p.dP], ['entrada', 'P', () => S.P('saida') + p.dP]]);
        E([['saida', 'h', () => {
          const P = S.P('entrada') - p.dP;
          return p.sub > 0 ? St.h_pT(P, St.tsat(P) - p.sub) : St.hf(P);
        }]]);
      },
      post(c, S, R) {
        const Q = S.m('entrada') * (S.h('entrada') - S.h('saida'));
        R.Qproc += Q;
        return [['Calor entregue ao processo', Q / 1000, 'MW']];
      }
    }
  };

  function checkExhaust(c, S, R, port) {
    const st = St.state_ph(S.P(port), S.h(port));
    if (st.phase === 'mix' && st.x < 0.86) R.warn(c, `título na exaustão de ${f3(st.x)} (umidade acima de 14%, risco de erosão das palhetas).`);
  }
  const f1 = v => (Math.round(v * 10) / 10).toLocaleString('pt-BR');
  const f2 = v => (Math.round(v * 100) / 100).toLocaleString('pt-BR');
  const f3 = v => (Math.round(v * 1000) / 1000).toLocaleString('pt-BR');

  // ---------- Montagem
  function build(model) {
    const errors = [];
    const comps = new Map(model.components.map(c => [c.id, c]));
    const portMap = new Map(); // "cid.port" -> stream index
    const streams = [];
    model.connections.forEach(cn => {
      const a = comps.get(cn.from.c), b = comps.get(cn.to.c);
      if (!a || !b) return;
      const idx = streams.length;
      streams.push(cn);
      portMap.set(cn.from.c + '.' + cn.from.p, idx);
      portMap.set(cn.to.c + '.' + cn.to.p, idx);
    });
    model.components.forEach(c => {
      const d = DEFS[c.type];
      for (const [pn, pd] of Object.entries(d.ports)) {
        if (!pd.optional && !portMap.has(c.id + '.' + pn)) errors.push({ c: c.id, msg: `porta "${pd.label}" não está conectada.` });
      }
    });
    return { comps, portMap, streams, errors };
  }

  const TYPE_IDX = { m: 0, P: 1, h: 2 };
  const VAR_NAME = ['vazão', 'pressão', 'entalpia'];
  const SCALE = [1, 1, 100];

  function solve(model, opts = {}) {
    const B = build(model);
    const out = { ok: false, errors: B.errors.slice(), warnings: [], streams: [], comps: {}, totals: null, iterations: 0, method: '' };
    if (!model.components.length) { out.errors.push({ msg: 'o diagrama está vazio.' }); return out; }
    if (out.errors.length) return out;
    const nS = B.streams.length, n = 3 * nS;
    const X = new Float64Array(n);
    // Estimativa inicial
    let mRef = 10;
    model.components.forEach(c => { if (c.type === 'caldeira') mRef = Math.max(mRef, c.params.m); });
    B.streams.forEach((cn, i) => {
      const fromDef = DEFS[comps(B, cn.from.c).type].ports[cn.from.p];
      const vap = fromDef.kind === 'vapor';
      X[3 * i] = mRef * (vap ? 0.5 : 0.5);
      X[3 * i + 1] = 10;
      X[3 * i + 2] = vap ? 2800 : 400;
    });
    const accessorFor = c => {
      const idx = pn => B.portMap.get(c.id + '.' + pn);
      return {
        m: pn => { const i = idx(pn); return i === undefined ? 0 : X[3 * i]; },
        P: pn => { const i = idx(pn); return i === undefined ? 0 : X[3 * i + 1]; },
        h: pn => { const i = idx(pn); return i === undefined ? 0 : X[3 * i + 2]; }
      };
    };
    const eqs = [];
    model.components.forEach(c => {
      const d = DEFS[c.type], S = accessorFor(c);
      d.eqs(c, S, forms => {
        const valid = [];
        forms.forEach(([pn, v, f], k) => {
          const i = B.portMap.get(c.id + '.' + pn);
          if (i !== undefined) valid.push({ t: 3 * i + TYPE_IDX[v], f, primary: k === 0 });
        });
        // A forma primária precisa existir para o resíduo; se o alvo primário está desconectado, a equação não se aplica
        if (valid.length && valid[0].primary) eqs.push({ c: c.id, forms: valid });
      });
    });

    const describeVar = v => {
      const s = B.streams[Math.floor(v / 3)];
      return `${VAR_NAME[v % 3]} da corrente ${label(B, s)}`;
    };
    // Emparelhamento equação ↔ variável (Kuhn), preferindo a forma primária
    const matchVar = new Int32Array(n).fill(-1), matchEq = new Int32Array(eqs.length).fill(-1);
    const order = eqs.map((e, i) => i).sort((a, b) => eqs[a].forms.length - eqs[b].forms.length);
    function aug(e, seen) {
      for (let k = 0; k < eqs[e].forms.length; k++) {
        const v = eqs[e].forms[k].t;
        if (seen[v]) continue; seen[v] = 1;
        if (matchVar[v] === -1 || aug(matchVar[v], seen)) { matchVar[v] = e; matchEq[e] = k; return true; }
      }
      return false;
    }
    const unmatchedEqs = [];
    order.forEach(e => { if (!aug(e, new Uint8Array(n))) unmatchedEqs.push(e); });
    const unmatchedVars = [];
    for (let v = 0; v < n; v++) if (matchVar[v] === -1) unmatchedVars.push(v);
    if (unmatchedEqs.length || unmatchedVars.length) {
      unmatchedVars.forEach(v => out.errors.push({ msg: `ninguém define a ${describeVar(v)}. Falta uma especificação (por exemplo, use um divisor com fração fixa ou conecte a corrente a um componente que a calcule).` }));
      unmatchedEqs.forEach(e => {
        const f = eqs[e].forms[0];
        out.errors.push({ c: eqs[e].c, msg: `excesso de especificações neste componente: a ${describeVar(f.t)} já é definida em outro ponto do ciclo. Libere uma das especificações (por exemplo, mude um divisor para "Definida a jusante").` });
      });
      return out;
    }

    const clampVar = (v, val) => {
      if (!isFinite(val)) return X[v];
      const t = v % 3;
      if (t === 1) return Math.min(Math.max(val, 0.01), 400);
      if (t === 2) return Math.min(Math.max(val, 5), 4300);
      return Math.min(Math.max(val, -1e6), 1e6);
    };
    // 1) Substituição sucessiva (Gauss-Seidel) com as formas emparelhadas
    let sweeps = 0, change = Infinity;
    for (; sweeps < (opts.maxSweeps || 400) && change > 1e-10; sweeps++) {
      change = 0;
      for (let e = 0; e < eqs.length; e++) {
        const F = eqs[e].forms[matchEq[e]];
        const nv = clampVar(F.t, F.f());
        const d = Math.abs(nv - X[F.t]) / SCALE[F.t % 3];
        if (d > change) change = d;
        X[F.t] = nv;
      }
    }
    // 2) Newton-Raphson nas formas primárias (polimento / convergência de reciclos)
    const resid = () => {
      const r = new Float64Array(eqs.length);
      for (let e = 0; e < eqs.length; e++) { const F = eqs[e].forms[0]; r[e] = (X[F.t] - F.f()) / SCALE[F.t % 3]; }
      return r;
    };
    const norm = r => { let s = 0; for (const v of r) s = Math.max(s, Math.abs(v)); return s; };
    let r = resid(), nr = norm(r), newtonIt = 0;
    const TOL = 1e-7;
    while (nr > TOL && newtonIt < 40) {
      newtonIt++;
      const J = [];
      for (let e = 0; e < n; e++) J.push(new Float64Array(n));
      for (let v = 0; v < n; v++) {
        const x0 = X[v], dx = 1e-6 * Math.max(1, Math.abs(x0));
        X[v] = x0 + dx;
        const r1 = resid();
        X[v] = x0;
        for (let e = 0; e < n; e++) J[e][v] = (r1[e] - r[e]) / dx;
      }
      const dxv = lsolve(J, Array.from(r, v => -v));
      if (!dxv) { out.errors.push({ msg: 'o sistema de equações ficou singular. Verifique se há especificações redundantes ou conexões fechando um laço sem saída.' }); return out; }
      let lam = 1, ok = false;
      const Xold = Float64Array.from(X);
      for (let k = 0; k < 12; k++) {
        for (let v = 0; v < n; v++) X[v] = clampVar(v, Xold[v] + lam * dxv[v]);
        const r2 = resid(), n2 = norm(r2);
        if (n2 < nr || n2 < TOL) { r = r2; nr = n2; ok = true; break; }
        lam /= 2;
      }
      if (!ok) { X.set(Xold); break; }
    }
    out.iterations = sweeps; out.newton = newtonIt; out.residual = nr;
    if (!(nr < 1e-4)) {
      out.errors.push({ msg: `o cálculo não convergiu (resíduo ${nr.toExponential(2)}). Confira pressões e especificações; valores fisicamente incoerentes costumam ser a causa.` });
    }

    // Pós-processamento
    out.streams = B.streams.map((cn, i) => {
      const m = X[3 * i], P = X[3 * i + 1], h = X[3 * i + 2];
      const st = St.state_ph(P, h);
      return { id: cn.id, m, P, h, T: st.T, s: st.s, x: st.x, phase: st.phase };
    });
    const R = {
      Wturb: 0, Wturb_f: 0, Wbomb: 0, Qcald: 0, Qcomb: 0, Qcond: 0, Qproc: 0,
      warn: (c, msg) => out.warnings.push({ c: c.id, msg }),
      err: (c, msg) => out.errors.push({ c: c.id, msg })
    };
    model.components.forEach(c => {
      const S = accessorFor(c);
      out.comps[c.id] = DEFS[c.type].post(c, S, R) || [];
    });
    out.streams.forEach((s, i) => {
      if (s.m < -1e-6) out.warnings.push({ msg: `a corrente ${label(B, B.streams[i])} ficou com vazão negativa (${f2(s.m)} kg/s).` });
      if (s.P > St.PMAX_OK && s.T > 350) out.warnings.push({ msg: `a corrente ${label(B, B.streams[i])} está na região 3 da IAPWS-IF97 (acima de 165 bar e 350 °C), que este protótipo ainda não modela com exatidão.` });
    });
    const Wliq = R.Wturb - R.Wbomb;
    const closure = R.Qcald + R.Wbomb - R.Wturb_f - R.Qcond - R.Qproc;
    out.totals = {
      Wturb: R.Wturb, Wbomb: R.Wbomb, Wliq, Qcald: R.Qcald, Qcomb: R.Qcomb, Qcond: R.Qcond, Qproc: R.Qproc,
      etaCiclo: R.Qcald > 0 ? Wliq / R.Qcald : NaN,
      etaPlanta: R.Qcomb > 0 ? Wliq / R.Qcomb : NaN,
      heatRate: Wliq > 0 ? 3600 * R.Qcomb / Wliq : NaN,
      fue: R.Qcomb > 0 ? (Wliq + R.Qproc) / R.Qcomb : NaN,
      closure, closureRel: R.Qcald > 0 ? closure / R.Qcald : 0
    };
    if (Math.abs(out.totals.closureRel) > 1e-4 && out.errors.length === 0) out.warnings.push({ msg: `o balanço global de energia fecha com erro de ${(out.totals.closureRel * 100).toFixed(3)}%. Verifique se há correntes entrando ou saindo do ciclo.` });
    out.ok = out.errors.length === 0;
    return out;
  }
  function comps(B, id) { return B.comps.get(id); }
  function label(B, cn) {
    const a = B.comps.get(cn.from.c), b = B.comps.get(cn.to.c);
    return `"${a.name || DEFS[a.type].name} → ${b.name || DEFS[b.type].name}"`;
  }
  function lsolve(A, b) {
    const n = b.length;
    for (let i = 0; i < n; i++) {
      let p = i, mx = Math.abs(A[i][i]);
      for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > mx) { mx = Math.abs(A[r][i]); p = r; }
      if (mx < 1e-14) return null;
      if (p !== i) { [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]]; }
      for (let r = i + 1; r < n; r++) {
        const f = A[r][i] / A[i][i];
        if (f === 0) continue;
        for (let k = i; k < n; k++) A[r][k] -= f * A[i][k];
        b[r] -= f * b[i];
      }
    }
    const x = new Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let s = b[i];
      for (let k = i + 1; k < n; k++) s -= A[i][k] * x[k];
      x[i] = s / A[i][i];
    }
    return x;
  }

  // ---------------------------------------------------------------------------
  // Traçado de processos para os diagramas T-s / h-s (física, sem desenho)
  // ---------------------------------------------------------------------------
  // Para cada componente: pares [porta de origem, porta de destino, expansão?]
  const PATHS = {
    caldeira: [['entrada', 'saida']], turbina: [['entrada', 'saida', 1]], turbina_ext: [['entrada', 'extracao', 1], ['extracao', 'saida', 1]],
    condensador: [['entrada', 'saida'], ['dreno', 'saida']], bomba: [['entrada', 'saida']],
    aquecedor: [['agua_in', 'agua_out'], ['vapor', 'dreno'], ['dreno_in', 'dreno']],
    desaerador: [['vapor', 'saida'], ['agua_in', 'saida'], ['dreno_in', 'saida']],
    dessuperaquecedor: [['vapor', 'saida'], ['agua', 'saida']], valvula: [['entrada', 'saida']], divisor: [],
    misturador: [['entrada1', 'saida'], ['entrada2', 'saida']], processo: [['entrada', 'saida']]
  };
  // Linhas de processo: expansões seguem a eficiência isentrópica ponto a ponto;
  // as demais interpolam P e h linearmente (isobárica exata quando P é constante,
  // isentálpica exata numa válvula).
  function processPaths(params, result) {
    const out = [], smap = result && result.streamMap ? result.streamMap : {};
    const connAt = (cid, pn) => params.connections.find(cn => (cn.from.c === cid && cn.from.p === pn) || (cn.to.c === cid && cn.to.p === pn));
    params.components.forEach(c => {
      (PATHS[c.type] || []).forEach(([a, b, exp]) => {
        const ca = connAt(c.id, a), cb = connAt(c.id, b);
        if (!ca || !cb) return;
        const A = smap[ca.id], B = smap[cb.id];
        if (!A || !B) return;
        const pts = [];
        if (exp) {
          const eta = c.params.eta / 100, s1 = A.s;
          for (let i = 0; i <= 24; i++) {
            const P = A.P * Math.pow(B.P / A.P, i / 24);
            const h = i === 24 ? B.h : A.h - eta * (A.h - St.h_ps(P, s1));
            const st = St.state_ph(P, h); pts.push({ T: st.T, s: st.s, h });
          }
        } else {
          for (let i = 0; i <= 30; i++) {
            const t = i / 30, P = A.P + (B.P - A.P) * t, h = A.h + (B.h - A.h) * t;
            const st = St.state_ph(P, h); pts.push({ T: st.T, s: st.s, h });
          }
        }
        out.push({ c: c.id, exp: !!exp, pts });
      });
    });
    return out;
  }
  // Curva de saturação (líquido e vapor), de 0,01 °C até 350 °C (limite da região 4
  // confiável sem região 3); o trecho até o ponto crítico é fechado à parte.
  let DOME = null;
  function dome() {
    if (DOME) return DOME;
    const L = [], V = [];
    for (let T = 0.01; T <= 350.001; T += (T < 300 ? 5 : 2.5)) {
      const S = St.sat(St.psat(T));
      L.push({ T: S.T, s: S.sf, h: S.hf }); V.push({ T: S.T, s: S.sg, h: S.hg });
    }
    DOME = { L, V, C: { T: 373.946, s: 4.412, h: 2087.5 } };
    return DOME;
  }
  function isobar(P, Tmax) {
    const pts = [], S = St.sat(P), Ts = S.T;
    for (let i = 0; i <= 30; i++) { const T = 1 + (Ts - 1.05) * i / 30; pts.push({ T, s: St.s_pT(P, T), h: St.h_pT(P, T) }); }
    pts.push({ T: Ts, s: S.sf, h: S.hf }, { T: Ts, s: S.sg, h: S.hg });
    for (let i = 1; i <= 40; i++) { const T = Ts + (Tmax - Ts) * i / 40; pts.push({ T, s: St.s_pT(P, T), h: St.h_pT(P, T) }); }
    return pts;
  }

  function run(params) {
    const r = solve(params);
    r.streamMap = {};
    (r.streams || []).forEach(s => r.streamMap[s.id] = s);
    return r;
  }
  return { run, DEFS, processPaths, dome, isobar, props: St, PMAX_OK: St.PMAX_OK };
})();
if (typeof module !== 'undefined') module.exports = Engine;
