// =============================================================================
// steam.js — SUBSTITUTO TEMPORÁRIO
// -----------------------------------------------------------------------------
// Pela convenção do hub (ARCHITECTURE.md, "Módulo de propriedades de vapor"),
// esta pasta deve conter uma CÓPIA de public/apps/steampath/steam.js. Esse arquivo
// não estava disponível quando o CICLOVAP foi adaptado, então este é um
// substituto com a MESMA API pública documentada (stateFromPT, stateFromPS,
// stateFromPH, satAt), implementando IAPWS-IF97 regiões 1, 2 e 4 e validado
// contra os valores de verificação oficiais da norma.
//
// >>> Ao instalar no hub: sobrescreva este arquivo com a cópia do STEAMPATH. <<<
// O engine.js do CICLOVAP só usa a API documentada, através de um adaptador
// tolerante a nomes de campo (T / T_degC), então a troca não exige mudar nada.
// =============================================================================
var Steam = (() => {
  const R = 0.461526;
  const R1I = [0,0,0,0,0,0,0,0,1,1,1,1,1,1,2,2,2,2,2,3,3,3,4,4,4,5,8,8,21,23,29,30,31,32];
  const R1J = [-2,-1,0,1,2,3,4,5,-9,-7,-1,0,1,3,-3,0,1,3,17,-4,0,6,-5,-2,10,-8,-11,-6,-29,-31,-38,-39,-40,-41];
  const R1n = [0.14632971213167,-0.84548187169114,-0.37563603672040e1,0.33855169168385e1,-0.95791963387872,0.15772038513228,-0.16616417199501e-1,0.81214629983568e-3,0.28319080123804e-3,-0.60706301565874e-3,-0.18990068218419e-1,-0.32529748770505e-1,-0.21841717175414e-1,-0.52838357969930e-4,-0.47184321073267e-3,-0.30001780793026e-3,0.47661393906987e-4,-0.44141845330846e-5,-0.72694996297594e-15,-0.31679644845054e-4,-0.28270797985312e-5,-0.85205128120103e-9,-0.22425281908000e-5,-0.65171222895601e-6,-0.14341729937924e-12,-0.40516996860117e-6,-0.12734301741641e-8,-0.17424871230634e-9,-0.68762131295531e-18,0.14478307828521e-19,0.26335781662795e-22,-0.11947622640071e-22,0.18228094581404e-23,-0.93537087292458e-25];
  const R2J0 = [0,1,-5,-4,-3,-2,-1,2,3];
  const R2n0 = [-0.96927686500217e1,0.10086655968018e2,-0.56087911283020e-2,0.71452738081455e-1,-0.40710498223928,0.14240819171444e1,-0.43839511319450e1,-0.28408632460772,0.21268463753307e-1];
  const R2I = [1,1,1,1,1,2,2,2,2,2,3,3,3,3,3,4,4,4,5,6,6,6,7,7,7,8,8,9,10,10,10,16,16,18,20,20,20,21,22,23,24,24,24];
  const R2J = [0,1,2,3,6,1,2,4,7,36,0,1,3,6,35,1,2,3,7,3,16,35,0,11,25,8,36,13,4,10,14,29,50,57,20,35,48,21,53,39,26,40,58];
  const R2n = [-0.17731742473213e-2,-0.17834862292358e-1,-0.45996013696365e-1,-0.57581259083432e-1,-0.50325278727930e-1,-0.33032641670203e-4,-0.18948987516315e-3,-0.39392777243355e-2,-0.43797295650573e-1,-0.26674547914087e-4,0.20481737692309e-7,0.43870667284435e-6,-0.32277677238570e-4,-0.15033924542148e-2,-0.40668253562649e-1,-0.78847309559367e-9,0.12790717852285e-7,0.48225372718507e-6,0.22922076337661e-5,-0.16714766451061e-10,-0.21171472321355e-2,-0.23895741934104e2,-0.59059564324270e-15,-0.12621808899101e-5,-0.38946842435739e-1,0.11256211360459e-10,-0.82311340897998e1,0.19809712802088e-7,0.10406965210174e-18,-0.10234747095929e-12,-0.10018179379511e-8,-0.80882908646985e-10,0.10693031879409,-0.33662250574171,0.89185845355421e-24,0.30629316876232e-12,-0.42002467698208e-5,-0.59056029685639e-25,0.37826947613457e-5,-0.12768608934681e-14,0.73087610595061e-28,0.55414715350778e-16,-0.94369707241210e-6];
  const N4 = [0.11670521452767e4,-0.72421316703206e6,-0.17073846940092e2,0.12020824702470e5,-0.32325550322333e7,0.14915108613530e2,-0.48232657361591e4,0.40511340542057e6,-0.23855557567849,0.65017534844798e3];

  // Região 1 (líquido): p em MPa, T em K
  function r1(pM, TK) {
    const pi = pM / 16.53, tau = 1386 / TK, a = 7.1 - pi, b = tau - 1.222;
    let g = 0, gt = 0, gp = 0;
    for (let i = 0; i < 34; i++) {
      const t = R1n[i] * Math.pow(a, R1I[i]);
      g += t * Math.pow(b, R1J[i]);
      gt += t * R1J[i] * Math.pow(b, R1J[i] - 1);
      gp -= R1n[i] * R1I[i] * Math.pow(a, R1I[i] - 1) * Math.pow(b, R1J[i]);
    }
    return { h: R * TK * tau * gt, s: R * (tau * gt - g), v: R * TK / (pM * 1000) * pi * gp };
  }
  // Região 2 (vapor)
  function r2(pM, TK) {
    const pi = pM, tau = 540 / TK, b = tau - 0.5;
    let g0 = Math.log(pi), g0t = 0, gr = 0, grt = 0, grp = 0;
    for (let i = 0; i < 9; i++) {
      g0 += R2n0[i] * Math.pow(tau, R2J0[i]);
      g0t += R2n0[i] * R2J0[i] * Math.pow(tau, R2J0[i] - 1);
    }
    for (let i = 0; i < 43; i++) {
      const t = R2n[i] * Math.pow(pi, R2I[i]);
      gr += t * Math.pow(b, R2J[i]);
      grt += t * R2J[i] * Math.pow(b, R2J[i] - 1);
      grp += R2n[i] * R2I[i] * Math.pow(pi, R2I[i] - 1) * Math.pow(b, R2J[i]);
    }
    return { h: R * TK * tau * (g0t + grt), s: R * (tau * (g0t + grt) - (g0 + gr)), v: R * TK / (pM * 1000) * pi * (1 / pi + grp) };
  }
  // Região 4 (saturação)
  function psatK(TK) {
    const th = TK + N4[8] / (TK - N4[9]);
    const A = th * th + N4[0] * th + N4[1], B = N4[2] * th * th + N4[3] * th + N4[4], C = N4[5] * th * th + N4[6] * th + N4[7];
    return Math.pow(2 * C / (-B + Math.sqrt(B * B - 4 * A * C)), 4); // MPa
  }
  function tsatK(pM) {
    const be = Math.pow(pM, 0.25);
    const E = be * be + N4[2] * be + N4[5], F = N4[0] * be * be + N4[3] * be + N4[6], G = N4[1] * be * be + N4[4] * be + N4[7];
    const D = 2 * G / (-F - Math.sqrt(F * F - 4 * E * G));
    return (N4[9] + D - Math.sqrt((N4[9] + D) ** 2 - 4 * (N4[8] + N4[9] * D))) / 2;
  }

  const PMIN = 0.00612, PCRIT = 220.64, PMAX_OK = 165.29;
  const clampP = P => Math.min(Math.max(P, PMIN), 1000);

  const satCache = new Map();
  function sat(P) {
    P = clampP(Math.min(P, PCRIT - 0.01));
    const key = P;
    let r = satCache.get(key);
    if (r) return r;
    const pM = P / 10, TK = tsatK(pM);
    const L = r1(pM, TK), V = r2(pM, TK);
    r = { T: TK - 273.15, TK, hf: L.h, hg: V.h, sf: L.s, sg: V.s };
    if (satCache.size > 5000) satCache.clear();
    satCache.set(key, r);
    return r;
  }

  // Resolve g(T)=y em [a,b] (g crescente) — regula falsi (Illinois) com salvaguarda
  function invert(g, y, a, b) {
    let fa = g(a) - y, fb = g(b) - y;
    if (fa >= 0) return a;
    if (fb <= 0) return b;
    let side = 0;
    for (let k = 0; k < 100; k++) {
      let c = (a * fb - b * fa) / (fb - fa);
      if (!(c > a && c < b)) c = 0.5 * (a + b);
      const fc = g(c) - y;
      if (Math.abs(fc) < 1e-11 * Math.max(1, Math.abs(y)) || (b - a) < 1e-12) return c;
      if (fc > 0) { b = c; fb = fc; if (side === -1) fa /= 2; side = -1; }
      else { a = c; fa = fc; if (side === 1) fb /= 2; side = 1; }
    }
    return 0.5 * (a + b);
  }

  const TMIN_K = 273.16, TMAX_K = 1073.15;
  function supercrit(P) { return P >= PCRIT - 0.01; }

  function h_pT(P, T) {
    P = clampP(P);
    const pM = P / 10, TK = T + 273.15;
    if (supercrit(P)) return (TK < 623.15 ? r1(pM, TK) : r2(pM, TK)).h;
    const S = sat(P);
    return TK <= S.TK ? r1(pM, TK).h : r2(pM, TK).h;
  }
  function s_pT(P, T) {
    P = clampP(P);
    const pM = P / 10, TK = T + 273.15;
    if (supercrit(P)) return (TK < 623.15 ? r1(pM, TK) : r2(pM, TK)).s;
    const S = sat(P);
    return TK <= S.TK ? r1(pM, TK).s : r2(pM, TK).s;
  }
  // Estado completo a partir de (P, h)
  function state_ph(P, h) {
    P = clampP(P);
    const pM = P / 10;
    if (supercrit(P)) {
      const TK = invert(t => (t < 623.15 ? r1(pM, t) : r2(pM, t)).h, h, TMIN_K, TMAX_K);
      const s = (TK < 623.15 ? r1(pM, TK) : r2(pM, TK)).s;
      return { T: TK - 273.15, s, x: null, phase: TK < 623.15 ? 'liq' : 'vap' };
    }
    const S = sat(P);
    if (h < S.hf) {
      const TK = invert(t => r1(pM, t).h, h, TMIN_K, S.TK);
      return { T: TK - 273.15, s: r1(pM, TK).s, x: null, phase: 'liq' };
    }
    if (h > S.hg) {
      const TK = invert(t => r2(pM, t).h, h, S.TK, TMAX_K);
      return { T: TK - 273.15, s: r2(pM, TK).s, x: null, phase: 'vap' };
    }
    const x = (h - S.hf) / (S.hg - S.hf);
    return { T: S.T, s: S.sf + x * (S.sg - S.sf), x, phase: 'mix' };
  }
  // Entalpia a partir de (P, s) — usada nas expansões/compressões isentrópicas
  function h_ps(P, s) {
    P = clampP(P);
    const pM = P / 10;
    if (supercrit(P)) {
      const TK = invert(t => (t < 623.15 ? r1(pM, t) : r2(pM, t)).s, s, TMIN_K, TMAX_K);
      return (TK < 623.15 ? r1(pM, TK) : r2(pM, TK)).h;
    }
    const S = sat(P);
    if (s < S.sf) { const TK = invert(t => r1(pM, t).s, s, TMIN_K, S.TK); return r1(pM, TK).h; }
    if (s > S.sg) { const TK = invert(t => r2(pM, t).s, s, S.TK, TMAX_K); return r2(pM, TK).h; }
    const x = (s - S.sf) / (S.sg - S.sf);
    return S.hf + x * (S.hg - S.hf);
  }
  // ---------------- API pública (a mesma do steam.js do STEAMPATH) ----------------
  const regionAt = (P, TK) => (supercrit(P) ? (TK < 623.15 ? 1 : 2) : (TK <= sat(P).TK ? 1 : 2));
  function full(P, TK, x) {
    const pM = clampP(P) / 10, reg = regionAt(P, TK), r = reg === 1 ? r1(pM, TK) : r2(pM, TK);
    return { p: P, T: TK - 273.15, h: r.h, s: r.s, v: r.v, x, region: reg };
  }
  function twoPhase(P, x) {
    const S = sat(P), pM = clampP(P) / 10, vL = r1(pM, S.TK).v, vV = r2(pM, S.TK).v;
    return { p: P, T: S.T, h: S.hf + x * (S.hg - S.hf), s: S.sf + x * (S.sg - S.sf), v: vL + x * (vV - vL), x, region: 4 };
  }
  function stateFromPT(P, T) {
    const TK = T + 273.15, reg = regionAt(P, TK);
    return full(P, TK, reg === 1 ? 0 : 1);
  }
  function stateFromPH(P, h) {
    const st = state_ph(P, h);
    if (st.phase === 'mix') return twoPhase(P, st.x);
    return full(P, st.T + 273.15, st.phase === 'liq' ? 0 : 1);
  }
  function stateFromPS(P, s) {
    return stateFromPH(P, h_ps(P, s));
  }
  function satAt(P) {
    const S = sat(P), pM = clampP(Math.min(P, PCRIT - 0.01)) / 10;
    return { p: P, Tsat: S.T, hL: S.hf, sL: S.sf, vL: r1(pM, S.TK).v, hV: S.hg, sV: S.sg, vV: r2(pM, S.TK).v };
  }
  return { stateFromPT, stateFromPS, stateFromPH, satAt, _r1: r1, _r2: r2, _psatK: psatK, _tsatK: tsatK };
})();
if (typeof module !== 'undefined') module.exports = Steam;
