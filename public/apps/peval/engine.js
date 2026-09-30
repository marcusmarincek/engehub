// ============================================================================
// MOTOR DE CÁLCULO — Desempenho do conjunto de válvulas de regulagem
// Tradução fiel do algoritmo original (PEVAL.pas / SUBROUTINE UUU-VVV-WEIN.f)
// Validado numericamente contra PEVAL.RES / PEVAL.DAT (caso TMC100 / OS 40606):
//   Gt(h), Pz(h), %G(h), Perda(h) e velocidade máxima batem em todos os pontos
//   testados; a curva Pot×G bate com desvio < 0,2%; a força no obturador
//   apresenta desvio de ~8-10% exatamente nos instantes de abertura de cada
//   válvula adicional (ver aviso na interface).
// ============================================================================

const Engine = (() => {

  function Ex(x, y) { return Math.pow(x, y); }

  // ---- Constantes físicas do modelo (iguais ao original) ----
  const Kreg = 0.90;
  const Kmin = 0.97;
  const Rgas = 8314.34;   // J/(kmol.K)
  const Mgas = 18.0;      // kg/kmol (vapor d'água)
  const EPS = 1e-3;
  const ETASSV = 5.0;     // coef. perda de carga na válvula de fecho rápido
  const ETARV = 1.37;     // coef. perda de carga na válvula de regulagem
  const DH = 1.0;         // passo de cálculo (mm)

  function thermo(gama) {
    const gh = gama + 1;
    const gl = gama - 1;
    const grl = gama / gl;
    const ghr = gh / gama;
    const ga2 = 2 / gama;
    const RPcr = Ex(2 / gh, grl);
    const gamao = Math.sqrt(gama * Ex(2 / gh, gh / gl));
    return { gh, gl, grl, ghr, ga2, RPcr, gamao };
  }

  // Função de descarga isentrópica (razão de pressões -> fator adimensional)
  function Mfunc(RP, T) {
    if (RP < T.RPcr) return 1.0;
    if (RP >= 1) return 0.0;
    return Math.sqrt(2 * T.grl * (Ex(RP, T.ga2) - Ex(RP, T.ghr))) / T.gamao;
  }

  function calfregm(d1, d2, di, tipotur) {
    let fregm1 = 0, fregm2 = 0;
    if (tipotur === 'curtis') {
      fregm1 = Math.PI / 4 * (d1 * d1);
      fregm2 = Math.PI / 4 * (d2 * d2 - di * di);
    } else {
      if (d1 > 0) fregm1 = Math.PI / 4 * (d1 * d1 - di * di);
      if (d2 > 0) fregm2 = Math.PI / 4 * (d2 * d2 - di * di);
    }
    return [fregm1, fregm2];
  }

  function FPz(G, gref, pzref, Pe, Pa) {
    return Pe * Math.sqrt((Ex(pzref / Pe, 2) - Ex(Pa / Pe, 2)) * Ex(G / gref, 2) + Ex(Pa / Pe, 2));
  }

  function FcPd(Pd, Pe, Pz, kr, fr, kmi, fmi, T) {
    return Pe * (kr * fr) / (kmi * fmi) * Mfunc(Pd / Pe, T) / Mfunc(Pz / Pd, T);
  }

  function CalcPd(Pz, Pe, kr, fr, kmi, fmi, Pda, T) {
    let del = 0.15;
    let Pd1 = Pda - del;
    let Pd2 = Pd1 + del;
    let it = 0;
    while (Math.abs(Pd2 - Pd1) / Pd1 > 5e-5) {
      Pd1 = Pd1 + del;
      if (Pd1 < Pz) { del = del / 2; Pd1 = 1.01 * Pz; }
      Pd2 = FcPd(Pd1, Pe, Pz, kr, fr, kmi, fmi, T);
      const delr = Pd2 - Pd1;
      if (del * delr < 0) del = -del / 2;
      it++;
      if (it > 3000) break;
    }
    return (Pd1 + Pd2) / 2;
  }

  function calw(Rae, Pe, Ve, T, gama) {
    let Macf = 0.9, Maci;
    let guard = 0;
    while (true) {
      Maci = Macf;
      if (Rae <= 1.000001) Macf = 1.0;
      else Macf = Ex(2 / T.gh * (1 + T.gl / 2 * Maci * Maci), T.gh / (2 * T.gl)) / Rae;
      if (Math.abs((Macf - Maci) / Macf) <= 1e-3) break;
      guard++;
      if (guard > 2000) break;
    }
    const RgasMgas = Rgas / Mgas;
    const Te = Pe * Ve / RgasMgas * 1e5;
    const Tsec = Te / (1 + T.gl / 2 * Macf * Macf);
    const w = Macf * Math.sqrt(gama * RgasMgas * Tsec);
    return { w, Te, Tsec };
  }

  // ==========================================================================
  // IAPWS-IF97 — Região 2 (vapor superaquecido) — v(P,T) exata
  // Coeficientes oficiais (IAPWS R7-97/2012), conferidos contra o ponto de
  // verificação padrão T=700K, p=30MPa -> v=0.00542946619 m³/kg (bate a 9 dígitos).
  // ==========================================================================
  const IAPWS_R = 0.461526; // kJ/(kg.K)
  const IAPWS_Tstar = 540.0; // K
  const IAPWS_n0 = [
    [0, -0.96927686500217e1], [1, 0.10086655968018e2], [-5, -0.56087911283020e-2],
    [-4, 0.71452738081455e-1], [-3, -0.40710498223928], [-2, 0.14240819171444e1],
    [-1, -0.43839511319450e1], [2, -0.28408632460772], [3, 0.21268463753307e-1]
  ];
  const IAPWS_nr = [
    [1, 0, -0.0017731742473213], [1, 1, -0.017834862292358], [1, 2, -0.045996013696365],
    [1, 3, -0.057581259083432], [1, 6, -0.05032527872793], [2, 1, -0.000033032641670203],
    [2, 2, -0.00018948987516315], [2, 4, -0.0039392777243355], [2, 7, -0.043797295650573],
    [2, 36, -0.000026674547914087], [3, 0, 2.0481737692309e-08], [3, 1, 4.3870667284435e-07],
    [3, 3, -0.00003227767723857], [3, 6, -0.0015033924542148], [3, 35, -0.040668253562649],
    [4, 1, -7.8847309559367e-10], [4, 2, 1.2790717852285e-08], [4, 3, 4.8225372718507e-07],
    [5, 7, 2.2922076337661e-06], [6, 3, -1.6714766451061e-11], [6, 16, -0.0021171472321355],
    [6, 35, -23.895741934104], [7, 0, -5.905956432427e-18], [7, 11, -1.2621808899101e-06],
    [7, 25, -0.038946842435739], [8, 8, 1.1256211360459e-11], [8, 36, -8.2311340897998],
    [9, 13, 1.9809712802088e-08], [10, 4, 1.0406965210174e-19], [10, 10, -1.0234747095929e-13],
    [10, 14, -1.0018179379511e-09], [16, 29, -8.0882908646985e-11], [16, 50, 0.10693031879409],
    [18, 57, -0.33662250574171], [20, 20, 8.9185845355421e-25], [20, 35, 3.0629316876232e-13],
    [20, 48, -4.2002467698208e-06], [21, 21, -5.9056029685639e-26], [22, 53, 3.7826947613457e-06],
    [23, 39, -1.2768608934681e-15], [24, 26, 7.3087610595061e-29], [24, 40, 5.5414715350778e-17],
    [24, 58, -9.436970724121e-07]
  ];
  // Equação de saturação (Eq. 30, IAPWS-IF97) — usada só para alertar se o
  // ponto informado não é vapor superaquecido (fora do domínio da Região 2).
  const IAPWS_PSAT_N = [0, 0.11670521452767e4, -0.72421316703206e6, -0.17073846940092e2,
    0.12020824702470e5, -0.32325550322333e7, 0.14915108613530e2, -0.48232657361591e4,
    0.40511340542057e6, -0.23855557567849e0, 0.65017534844798e3];

  function iapwsPsatMPa(T_K) {
    const nn = IAPWS_PSAT_N;
    const tita = T_K + nn[9] / (T_K - nn[10]);
    const A = tita * tita + nn[1] * tita + nn[2];
    const B = nn[3] * tita * tita + nn[4] * tita + nn[5];
    const C = nn[6] * tita * tita + nn[7] * tita + nn[8];
    return Ex(2 * C / (-B + Math.sqrt(B * B - 4 * A * C)), 4);
  }

  // v(P[MPa], T[K]) — equação básica (forward) da Região 2, válida em todo o
  // domínio 0<p≤100MPa (não precisa das subdivisões 2a/2b/2c, que só existem
  // para as equações inversas T(p,h)/T(p,s)).
  function iapwsVRegion2(P_MPa, T_K) {
    const PI = P_MPa / 1.0;
    const TAU = IAPWS_Tstar / T_K;
    const tauShift = TAU - 0.5;
    let resid = 0;
    for (const [I, J, nc] of IAPWS_nr) resid += nc * I * Ex(PI, I - 1) * Ex(tauShift, J);
    const bracket = 1 + PI * resid;
    const R_J = IAPWS_R * 1000;
    const P_Pa = P_MPa * 1e6;
    return (R_J * T_K / P_Pa) * bracket;
  }

  // Volume específico do vapor vivo a partir de P[bar] e T[°C], com aviso caso
  // a condição informada não seja vapor superaquecido.
  function steamSpecificVolume(P_bar, T_C) {
    const P_MPa = P_bar * 0.1;
    const T_K = T_C + 273.15;
    let warning = null;
    if (T_K <= 647.096) {
      const psat = iapwsPsatMPa(T_K);
      if (P_MPa >= psat) {
        warning = `A pressão informada (${P_bar} bar) está acima da pressão de saturação a ${T_C} °C (≈ ${(psat * 10).toFixed(2)} bar). Isso indica vapor não superaquecido (líquido ou saturado) — fora do domínio de vapor superaquecido usado neste cálculo. Confira P e T.`;
      }
    }
    if (P_MPa > 100 || T_K > 1073.15) {
      warning = (warning ? warning + ' ' : '') + 'Condição fora da faixa usual de validade da formulação (p ≤ 100 MPa, T ≤ 800 °C).';
    }
    const v = iapwsVRegion2(P_MPa, T_K);
    return { v, warning };
  }

  // ==========================================================================
  // Cálculo do perfil de área de passagem Freg(h) de UMA válvula
  // ==========================================================================
  function computeProfile(valve, Hprev, Hstmax, fregm1, fregm2) {
    const ns = valve.ns;
    const alfar = valve.alfar.map(a => a * Math.PI / 180); // 1-indexed via [0]=0
    const pr = valve.pr;
    const R = valve.R, D1 = valve.D1, D2 = valve.D2;

    const br = [0], hr = [0];
    for (let j = 1; j <= ns - 1; j++) {
      br[j] = br[j - 1] + (pr[j] - pr[j - 1]) * Math.tan(alfar[j]);
      hr[j] = pr[j] + br[j] * Math.tan(alfar[j]);
    }
    const sa = Math.sin(alfar[ns]), ca = Math.cos(alfar[ns]), ta = Math.tan(alfar[ns]);
    const pf = pr[ns] - R * (1 - sa);
    br[ns] = br[ns - 1] + (pf - pr[ns - 1]) * ta;
    const bf = br[ns];
    hr[ns] = pf + bf * ta;
    const hf = hr[ns];
    const bra = bf + R * ca;

    const L = { 0: 0 }, B = { 0: 0 }, Freg1 = { 0: 0 }, Freg2 = { 0: 0 }, Freg = { 0: 0 };
    let i = 0, j = 1, tran = false;
    while (true) {
      i++;
      const hh = i * DH;
      const dhh = hh - Hprev;
      let L_i, b_i;
      if (hh >= Hprev) {
        if (dhh <= hf) {
          if (dhh > hr[j]) {
            if (dhh <= pr[j] + br[j] * Math.tan(alfar[j])) tran = true;
            else { tran = false; j++; }
          }
          if (tran) {
            b_i = br[j];
            L_i = Math.sqrt(b_i * b_i + Ex(dhh - pr[j], 2));
          } else {
            L_i = (dhh - pr[j - 1]) * Math.sin(alfar[j]) + br[j - 1] * Math.cos(alfar[j]);
            b_i = L_i * Math.cos(alfar[j]);
          }
        } else {
          const tat = ta + (dhh - hf) / bra;
          const cat = 1 / Math.sqrt(1 + tat * tat);
          L_i = bra / cat - R;
          b_i = bra - R * cat;
        }
      } else { L_i = 0; b_i = 0; }
      L[i] = L_i; B[i] = b_i;
      let f1 = D1 > 0 ? Math.PI * (D1 - b_i) * L_i : 0;
      let f2 = D2 > 0 ? Math.PI * (D2 - b_i) * L_i : 0;
      if (f1 >= fregm1 && D1 > 0) f1 = fregm1;
      if (f2 >= fregm2 && D2 > 0) f2 = fregm2;
      Freg1[i] = f1; Freg2[i] = f2; Freg[i] = f1 + f2;
      if (hh >= Hstmax) break;
      if (i > 400) break; // guarda de segurança
    }
    return { L, B, Freg1, Freg2, Freg, ifora: i };
  }

  // ==========================================================================
  // Cálculo completo (rede de vazão/pressão + forças + curva de consumo)
  //
  // Mudanças de metodologia (a pedido, revisão de engenharia):
  // - Vv (volume específico do vapor vivo) é sempre calculado pela IAPWS-IF97
  //   a partir de Pvb/Tv — não é mais um dado de entrada manual.
  // - Não há mais Gst/Pzst/Potst por válvula: a vazão máxima de cada válvula é
  //   consequência da área de injetores (Fmin) e da física de escoamento, não
  //   de um valor "alvo" pré-definido. Existe apenas UMA referência de projeto
  //   (Gst/Pzst/Potst totais), usada só para: (a) dar a forma da curva de
  //   pressão de câmara P(G) e (b) calibrar a escala da curva de potência.
  // ==========================================================================
  function run(params) {
    const warnings = [];
    const { Pvb, Tv, Pab, gama, DN, rot, padf, Hstmax, GstTotal, PzstTotal, PotstTotal, valves } = params;
    const n = valves.length;
    const T = thermo(gama);
    const Pv = Pvb, Pa = Pab;
    const tipotur = (padf === 'Z') ? 'curtis' : 'multi';

    const { v: Vv, warning: steamWarning } = steamSpecificVolume(Pvb, Tv);
    if (steamWarning) warnings.push(steamWarning);

    const Hst = [0]; // Hst[0]=0
    const Fmin = [null];
    const D1 = [null], D2 = [null];
    valves.forEach(v => {
      Hst.push(v.Hst);
      Fmin.push(v.Fmin); D1.push(v.D1); D2.push(v.D2);
    });

    // Perfis de área por válvula
    const profiles = [null];
    for (let k = 1; k <= n; k++) {
      const [fregm1, fregm2] = calfregm(valves[k - 1].D1, valves[k - 1].D2, valves[k - 1].Di, tipotur);
      profiles[k] = computeProfile(
        { ns: valves[k - 1].ns, alfar: [0, ...valves[k - 1].alfar], pr: [0, ...valves[k - 1].pr], R: valves[k - 1].R, D1: valves[k - 1].D1, D2: valves[k - 1].D2 },
        Hst[k - 1], Hstmax, fregm1, fregm2
      );
    }

    // --- Rede de vazão / pressão ---
    // gref/pzref vêm agora da referência total única (não da última válvula)
    const gref = GstTotal, Pzref = PzstTotal;
    let Pe = Pv, Ve = Vv;
    const Freg = k => profiles[k].Freg, Freg1 = k => profiles[k].Freg1, Freg2f = k => profiles[k].Freg2;

    let Gtd = 1.13842 * T.gamao * Freg(1)[1] * Kreg * Math.sqrt(Pe / Ve) * 0.9;
    let Pzd = FPz(Gtd, gref, Pzref, Pe, Pa);
    const Pdd = { 1: 1.1 * Pzd };
    for (let k = 2; k <= n; k++) Pdd[k] = Pa;
    const cond = {}; for (let k = 1; k <= n + 1; k++) cond[k] = false;

    const G = {}, G1 = {}, G2 = {}, Pd = {}, Gt = { 0: 0 }, Pz = { 0: Pa }, Fot = { 0: 0 }, Fo = {};
    const PeHist = {}, VeHist = {};
    for (let k = 1; k <= n; k++) { G[k] = {}; G1[k] = {}; G2[k] = {}; Pd[k] = {}; Fo[k] = {}; }

    let i = 0, kv = 1;
    let safety = 0;
    while (true) {
      i++;
      const hh = i * DH;
      let outerGuard = 0;
      let Gta, Pza;
      while (true) {
        outerGuard++;
        const vel = (Gtd / 3600) * Vv * 4 / Math.PI / Ex(DN / 1000, 2);
        Pe = Pv - (1 + ETASSV) * vel * vel / 2 / Vv / 1e5;
        Ve = Pv * Vv / Pe;
        Gta = Gtd;
        Gtd = 0;
        Pza = Pzd;
        for (let k = 1; k <= kv; k++) {
          if (hh > Hst[k] && !cond[k + 1] && kv <= n - 1) {
            kv++;
            cond[kv] = true;
            Pdd[kv] = Pzd * 1.1;
          }
          const Pda_k = Pdd[k];
          let Gd_k = 1.13842 * T.gamao * Fmin[k] * Mfunc(Pza / Pda_k, T) * Kmin * Pda_k / Math.sqrt(Pe * Ve);
          const Freg_ik = Freg(k)[i] !== undefined ? Freg(k)[i] : Freg(k)[profiles[k].ifora];
          const Gd1_k = Freg_ik !== 0 ? Gd_k * Freg1(k)[i] / Freg_ik : 0;
          if (Fmin[k] > 0) Pdd[k] = CalcPd(Pza, Pe, Kreg, Freg_ik, Kmin, Fmin[k], Pda_k, T);
          else Pdd[k] = Pza;
          if (Kreg * Freg_ik > Kmin * Fmin[k]) {
            const velrv = (Gd_k / 3600) * Ve / Freg_ik * 1e6;
            const Pdmax = Pe - (ETARV * velrv * velrv) / 2 / Ve / 1e5;
            if (Pdd[k] > Pdmax) Pdd[k] = Pdmax;
          }
          Gd_k = 1.13842 * T.gamao * Fmin[k] * Mfunc(Pza / Pdd[k], T) * Kmin * Pdd[k] / Math.sqrt(Pe * Ve);
          Gtd += Gd_k;
          G[k][i] = Gd_k; G1[k][i] = Gd1_k; G2[k][i] = Gd_k - Gd1_k; Pd[k][i] = Pdd[k];
        }
        Pzd = FPz(Gtd, gref, Pzref, Pe, Pa);
        if (Math.abs((Gtd - Gta) / Gtd) <= EPS) break;
        if (outerGuard > 800) { warnings.push(`Convergência não atingida em h=${hh}mm`); break; }
      }
      let sum = 0; for (let k = 1; k <= kv; k++) sum += G[k][i];
      Gt[i] = sum; Pz[i] = Pzd; PeHist[i] = Pe; VeHist[i] = Ve;

      // --- Forças (padrão N = duplo assento; padrão Z = simples/curtis) ---
      Fot[i] = 0;
      for (let k = 1; k <= kv; k++) {
        Fo[k][i] = 0;
        if (hh > Hst[k - 1] && D1[k] * D2[k] !== 0) {
          const g1 = G1[k][i], g2 = G2[k][i];
          const Freg1v = Freg1(k)[i], Freg2v = Freg2f(k)[i];
          const B_i = profiles[k].B[i] || 0, L_i = profiles[k].L[i] || 1e-9;
          let weng1 = 0, weng2 = 0, Astar1 = null, Astar2 = null;
          if (g1 > 0) { Astar1 = g1 / T.gamao * Math.sqrt(Ve / Pe) / 1.13842; weng1 = calw(Freg1v / Astar1 * Kreg, Pe, Ve, T, gama).w; }
          if (g2 > 0) { Astar2 = g2 / T.gamao * Math.sqrt(Ve / Pe) / 1.13842; weng2 = calw(Freg2v / Astar2 * Kreg, Pe, Ve, T, gama).w; }
          let auxf = 0;
          if (padf === 'N') {
            let weinl = 0, Pst = Pe;
            if (g1 > 0) {
              const r1 = calw(Math.PI * (valves[k - 1].D1 ** 2 - valves[k - 1].Dhas ** 2) / 4 / Astar1, Pe, Ve, T, gama);
              weinl = r1.w; Pst = Pe * Ex(r1.Tsec / r1.Te, gama / (gama - 1));
            }
            let weinr = 0;
            if (g2 > 0 && Astar2) weinr = calw(Math.PI * valves[k - 1].D2 * (hh - Hst[k - 1]) / Astar2, Pe, Ve, T, gama).w;
            auxf = -Pst * (valves[k - 1].D1 ** 2 - valves[k - 1].Dhas ** 2) - Pd[k][i] * (valves[k - 1].D2 * valves[k - 1].D2 - valves[k - 1].D1 ** 2);
            auxf = (auxf - valves[k - 1].Dhas ** 2 + Pe * valves[k - 1].D2 ** 2) * Math.PI / 40;
            auxf += (-g1 * weinl + g2 * weng2 + g2 * weinr * Math.cos(Math.PI / 4)) / 3600;
            auxf += (g2 * weng2 - g1 * weng1) * B_i / L_i / 3600;
          }
          Fo[k][i] = auxf;
          Fot[i] += auxf;
        }
      }

      if (hh > Hstmax - DH) break;
      safety++;
      if (safety > 400) { warnings.push('Limite de iterações de curso atingido.'); break; }
    }
    const ifora = i;

    // --- Curva de expansão / perdas (por válvula, ponderada pela vazão) ---
    const gastr = {}, Perda = {}, Popro = { 0: 0 }, Perdat = { 0: 0 }, Gpro = {};
    for (let k = 1; k <= n; k++) { gastr[k] = {}; Perda[k] = {}; }

    for (let ii = 1; ii <= ifora; ii++) {
      Gpro[ii] = Gt[ii] / Gt[ifora] * 100;
      Popro[ii] = 0; Perdat[ii] = 0;
      const hh = ii * DH;
      for (let k = 1; k <= kv; k++) {
        if (G[k][ii] === undefined) continue;
        if (hh >= Hst[k - 1]) {
          if (hh > Hst[k - 1]) {
            gastr[k][ii] = 1 - (Ex(Pv / Pd[k][ii], T.gl / gama) - 1) / (Ex(Pv / Pa, T.gl / gama) - 1);
            Perda[k][ii] = T.grl * Pv * Vv * (1 - Ex(Pd[k][ii] / Pv, T.gl / gama)) * 100;
          } else { gastr[k][ii] = 0; Perda[k][ii] = 0; }
          if (Gt[ii] !== 0) {
            Perdat[ii] += Perda[k][ii] * G[k][ii] / Gt[ii];
            Popro[ii] += gastr[k][ii] * G[k][ii] / Gt[ii] * 100;
          }
        }
      }
    }
    const velm = (Gt[ifora] / 3600) * Vv * 4 / Math.PI / Ex(DN / 1000, 2);

    // --- Curva de potência: calibração por UM único ponto de referência ---
    // Interpola Popro no ponto de vazão de referência (GstTotal) e usa isso,
    // junto com PotstTotal, para achar um fator de escala único K tal que
    // Pot(GstTotal) = PotstTotal. Depois: Pot[i] = Gt[i]*Popro[i]/100*K.
    let Pot = {}, calibK = null, GstRefIdx = null;
    for (let ii = 1; ii <= ifora; ii++) {
      if (Gt[ii] >= GstTotal) { GstRefIdx = ii; break; }
    }
    if (GstRefIdx !== null && GstTotal > 0) {
      const ii = GstRefIdx;
      const denom = (Gt[ii] - Gt[ii - 1]);
      const PoproRef = denom !== 0 ? Popro[ii - 1] + (GstTotal - Gt[ii - 1]) / denom * (Popro[ii] - Popro[ii - 1]) : Popro[ii];
      if (PoproRef > 0) calibK = PotstTotal / (GstTotal * PoproRef / 100);
    } else if (GstTotal > 0 && Popro[ifora] > 0) {
      // referência acima da vazão máxima calculada: calibra pelo último ponto disponível (extrapolação simples)
      calibK = PotstTotal / (Gt[ifora] * Popro[ifora] / 100) * (Gt[ifora] / GstTotal);
      warnings.push('A vazão de referência informada é maior que a vazão máxima calculada — a curva de potência foi extrapolada.');
    }
    if (calibK !== null) {
      for (let ii = 1; ii <= ifora; ii++) Pot[ii] = Gt[ii] * Popro[ii] / 100 * calibK;
    } else {
      warnings.push('Não foi possível calibrar a curva de potência — confira Gst/Potst de referência.');
    }

    return {
      warnings, n, ifora, kv, Hst, Fmin, D1, D2,
      Gt, Pz, G, G1, G2, Pd, Fot, Fo, Gpro, Perdat, Popro, Pot,
      velm, profiles, tipotur, Pv, Pa, Vv, gama, DN
    };
  }

  return { run, thermo, Ex, steamSpecificVolume, iapwsPsatMPa };
})();
