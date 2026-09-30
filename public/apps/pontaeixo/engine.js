// ============================================================================
// MOTOR — dimensionamento de ponta de eixo por fadiga (Shigley, cap. 6 e 7).
// Só matemática/física. Nunca toca document, fetch ou localStorage (ver
// ARCHITECTURE.md, seção "Separação engine.js / ui.js").
//
// Fontes (conferidas contra a literatura antes de codificar):
// - Fatores de Marin (ka, kb, kc, kd, ke) e Se' — Shigley, cap. 6, Eq. 6-8,
//   6-18, 6-19, 6-20; Tabela 6-2 (ka) e Tabela 6-4/6-5 (ke).
// - Sensibilidade ao entalhe (Neuber) — Shigley Eq. 6-33/6-34/6-35a/6-35b.
// - Kt/Kts de 1ª iteração para detalhes de eixo — Shigley Tabela 7-1.
// - Critérios de fadiga (DE-Goodman, DE-Gerber, DE-ASME-Elíptico,
//   DE-Soderberg) e verificação de escoamento — Shigley cap. 6-7 e cap. 7.
// ============================================================================
(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Conversões e utilidades
  // ---------------------------------------------------------------------
  const MPA_PER_KPSI = 6.894757;
  const MM_PER_IN = 25.4;

  function torqueFromPower(P_kW, n_rpm) {
    // T[N.m] = 60000*P[kW] / (2*pi*n[rpm])  — forma exata de T = 9550*P/n
    const P = parseFloat(P_kW), n = parseFloat(n_rpm);
    if (!P || !n) return 0;
    return (60000 * P) / (2 * Math.PI * n);
  }

  // ---------------------------------------------------------------------
  // Fatores de Marin — Se = ka*kb*kc*kd*ke*kf*Se'
  // ---------------------------------------------------------------------
  const KA_TABLE = {
    // finish: [a, b]  (Sut em MPa) — Shigley Tabela 6-2
    ground: [1.58, -0.085],
    machined: [4.51, -0.265],
    hot_rolled: [57.7, -0.718],
    forged: [272, -0.995]
  };

  function ka(Sut_MPa, finish) {
    const row = KA_TABLE[finish] || KA_TABLE.machined;
    const val = row[0] * Math.pow(Sut_MPa, row[1]);
    return Math.min(Math.max(val, 0), 1); // ka nunca é > 1 fisicamente
  }

  // kb — Eq. 6-20 (flexão/torção rotativa); kb=1 fora da faixa validada ou p/ carga axial
  function kb(d_mm) {
    if (d_mm < 2.79) return 1.0;
    if (d_mm <= 51) return 1.24 * Math.pow(d_mm, -0.107);
    if (d_mm <= 254) return 1.51 * Math.pow(d_mm, -0.157);
    return 1.51 * Math.pow(254, -0.157); // fora da faixa tabelada — usa o limite superior
  }

  // kc — para a abordagem combinada por energia de distorção (DE) usada em
  // eixos (cap. 7), o fator 3 já embutido na tensão de von Mises equivalente
  // faz a conversão flexão<->torção, então kc = 1 (não se aplica 0,59 de
  // novo, ou a redução seria contada em dobro). Ver Shigley, cap. 7.
  const KC_COMBINED = 1.0;

  const RELIABILITY_TABLE = {
    50: 1.000, 90: 0.897, 95: 0.868, 99: 0.814,
    99.9: 0.753, 99.99: 0.702, 99.999: 0.659, 99.9999: 0.620
  };
  function ke(reliabilityPct) {
    if (RELIABILITY_TABLE.hasOwnProperty(reliabilityPct)) return RELIABILITY_TABLE[reliabilityPct];
    return RELIABILITY_TABLE[99];
  }

  function seLinha(Sut_MPa) {
    // Se' = 0.5 Sut para Sut <= 1400 MPa; senão 700 MPa (Eq. 6-8)
    return Sut_MPa <= 1400 ? 0.5 * Sut_MPa : 700;
  }

  function enduranceLimit(params) {
    const { Sut, finish, d_mm, reliabilityPct, kd, kfMisc } = params;
    const a = ka(Sut, finish);
    const b = kb(d_mm);
    const c = KC_COMBINED;
    const d = (kd === '' || kd === null || kd === undefined || isNaN(kd)) ? 1 : parseFloat(kd);
    const e = ke(reliabilityPct);
    const f = (kfMisc === '' || kfMisc === null || kfMisc === undefined || isNaN(kfMisc)) ? 1 : parseFloat(kfMisc);
    const sePrime = seLinha(Sut);
    const Se = a * b * c * d * e * f * sePrime;
    return { ka: a, kb: b, kc: c, kd: d, ke: e, kfMisc: f, sePrime, Se };
  }

  // ---------------------------------------------------------------------
  // Sensibilidade ao entalhe — equação de Neuber (Shigley Eq. 6-33/6-35)
  // Válida para aço; Sut em kpsi, raio em polegadas nas equações originais.
  // ---------------------------------------------------------------------
  function neuberSqrtA_in(Sut_kpsi, isShear) {
    const S = Sut_kpsi;
    if (!isShear) {
      return 0.246 - 3.08e-3 * S + 1.51e-5 * S * S - 2.67e-8 * S * S * S;
    }
    return 0.190 - 2.51e-3 * S + 1.35e-5 * S * S - 2.67e-8 * S * S * S;
  }

  function notchSensitivity(Sut_MPa, r_mm, isShear) {
    if (!r_mm || r_mm <= 0) return 1.0; // sem raio informado -> conservador (q=1, Kf=Kt)
    const Sut_kpsi = Sut_MPa / MPA_PER_KPSI;
    const r_in = r_mm / MM_PER_IN;
    const sqrtA = neuberSqrtA_in(Sut_kpsi, isShear);
    if (sqrtA <= 0) return 1.0; // fora da faixa do ajuste -> lado seguro
    const q = 1 / (1 + sqrtA / Math.sqrt(r_in));
    return Math.min(Math.max(q, 0), 1);
  }

  function kf_from(Kt, q) { return 1 + q * (Kt - 1); }

  // ---------------------------------------------------------------------
  // Estimativas de 1ª iteração — Shigley Tabela 7-1. r/d assumido é o valor
  // típico usado nos exemplos-padrão do próprio Shigley para permitir
  // estimar um raio antes de conhecer o diâmetro (refinar depois com a
  // carta de Peterson real, Fig. A-15-8/9, quando o raio de projeto for
  // definido).
  // ---------------------------------------------------------------------
  const TABLE_7_1 = {
    sharp_fillet: {
      label: 'Filete de ombro — raio vivo',
      Kt: 2.7, Kts: 2.2, rOverD: 0.02,
      note: 'Shigley, Tabela 7-1 (confirmado).'
    },
    rounded_fillet: {
      label: 'Filete de ombro — bem arredondado',
      Kt: 1.7, Kts: 1.5, rOverD: 0.10,
      note: 'Valor usual da Tabela 7-1 — confira com a Fig. A-15-8/9 para o raio real.'
    },
    keyseat_profile: {
      label: 'Rasgo de chaveta — perfil (fresa de topo), com chaveta montada',
      Kt: 2.14, Kts: 3.0, rOverD: 0.02,
      note: 'Shigley, Tabela 7-1 / Peterson (confirmado).'
    },
    keyseat_sled: {
      label: 'Rasgo de chaveta — tipo trenó (sled-runner)',
      Kt: 1.7, Kts: 1.6, rOverD: 0.02,
      note: 'Valor usual da Tabela 7-1 — sempre menor que o perfil por ter saída suave.'
    },
    retaining_ring: {
      label: 'Rasgo de anel de retenção (circlip)',
      Kt: 5.0, Kts: 3.0, rOverD: 0.01,
      note: 'Shigley: "tipicamente em torno de 5 (flexão/axial) e 3 (torção)" — raio de fundo do rasgo é sempre pequeno; confirme com Tabela A-15-16/17.'
    }
  };

  // ---------------------------------------------------------------------
  // Tensão de von Mises alternada/média para eixo (flexão + torção)
  // Ma, Ta, Mm, Tm em N.m; d em mm -> tensão em MPa
  // ---------------------------------------------------------------------
  function vonMisesStress(Kf, M_Nm, Kfs, T_Nm, d_mm) {
    const M_Nmm = M_Nm * 1000;
    const T_Nmm = T_Nm * 1000;
    const term1 = (32 * Kf * M_Nmm) / (Math.PI * Math.pow(d_mm, 3));
    const term2 = (16 * Kfs * T_Nmm) / (Math.PI * Math.pow(d_mm, 3));
    return Math.sqrt(term1 * term1 + 3 * term2 * term2);
  }

  // ---------------------------------------------------------------------
  // Fator de segurança à fadiga por critério, dado (sigmaA, sigmaM)
  // ---------------------------------------------------------------------
  function safetyFactor(criterion, sigmaA, sigmaM, Se, Sut, Sy) {
    if (sigmaA <= 0) return Infinity;
    switch (criterion) {
      case 'goodman':
        if (sigmaM <= 0) return Se / sigmaA;
        return 1 / (sigmaA / Se + sigmaM / Sut);
      case 'soderberg':
        if (sigmaM <= 0) return Se / sigmaA;
        return 1 / (sigmaA / Se + sigmaM / Sy);
      case 'asme_elliptic':
        return 1 / Math.sqrt(Math.pow(sigmaA / Se, 2) + Math.pow(sigmaM / Sy, 2));
      case 'gerber': {
        if (sigmaM <= 1e-9) return Se / sigmaA;
        const A = Math.pow(sigmaM / Sut, 2);
        const B = sigmaA / Se;
        return (-B + Math.sqrt(B * B + 4 * A)) / (2 * A);
      }
      default:
        return Se / sigmaA;
    }
  }

  // ---------------------------------------------------------------------
  // Resolve o diâmetro (bissecção) para o qual o fator de segurança do
  // critério escolhido é exatamente o alvo, com Kf/Kfs/Se FIXOS (n(d) é
  // monótono crescente em d, então a bissecção é segura).
  // ---------------------------------------------------------------------
  function solveDiameterForN(nTarget, criterion, Ma, Ta, Mm, Tm, Kf, Kfs, Se, Sut, Sy) {
    function nAt(d) {
      const sigA = vonMisesStress(Kf, Ma, Kfs, Ta, d);
      const sigM = vonMisesStress(Kf, Mm, Kfs, Tm, d);
      return safetyFactor(criterion, sigA, sigM, Se, Sut, Sy);
    }
    let lo = 0.5, hi = 2000;
    // garante que a raiz está no intervalo
    for (let i = 0; i < 60 && nAt(hi) < nTarget; i++) hi *= 1.5;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (nAt(mid) < nTarget) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // ---------------------------------------------------------------------
  // Dimensionamento completo — itera d <-> (kb, r=rOverD*d, q, qs, Kf, Kfs, Se)
  // até convergir, do jeito que o próprio Shigley resolve à mão nos
  // exemplos do cap. 7 (chuta kb, acha d, refina kb e q, repete).
  // ---------------------------------------------------------------------
  function designShaftEnd(input) {
    const {
      Ma, Ta, Mm, Tm,          // N.m
      Sut, Sy,                  // MPa
      finish, reliabilityPct, kd, kfMisc,
      scMode, scPreset, KtManual, KtsManual, rManual,
      criterion, nTarget
    } = input;

    let Kt, Kts, rOverD, rFixed;
    if (scMode === 'manual') {
      Kt = parseFloat(KtManual) || 1;
      Kts = parseFloat(KtsManual) || 1;
      rFixed = parseFloat(rManual) || 0; // mm, absoluto
      rOverD = null;
    } else {
      const preset = TABLE_7_1[scPreset] || TABLE_7_1.keyseat_profile;
      Kt = preset.Kt; Kts = preset.Kts; rOverD = preset.rOverD; rFixed = null;
    }

    let d = 40; // semente inicial (mm) — refinada pela iteração, não é dado de projeto
    let q = 1, qs = 1, Kf = Kt, Kfs = Kts, se = null;
    let iterations = 0;
    const maxIter = 25;
    for (; iterations < maxIter; iterations++) {
      const r = rFixed !== null ? rFixed : rOverD * d;
      q = notchSensitivity(Sut, r, false);
      qs = notchSensitivity(Sut, r, true);
      Kf = kf_from(Kt, q);
      Kfs = kf_from(Kts, qs);
      se = enduranceLimit({ Sut, finish, d_mm: d, reliabilityPct, kd, kfMisc });
      const dNew = solveDiameterForN(nTarget, criterion, Ma, Ta, Mm, Tm, Kf, Kfs, se.Se, Sut, Sy);
      const delta = Math.abs(dNew - d);
      d = dNew;
      if (delta < 0.01) { iterations++; break; }
    }

    const sigmaA = vonMisesStress(Kf, Ma, Kfs, Ta, d);
    const sigmaM = vonMisesStress(Kf, Mm, Kfs, Tm, d);
    const nAchieved = safetyFactor(criterion, sigmaA, sigmaM, se.Se, Sut, Sy);

    // Verificação estática (escoamento) — estimativa conservadora somando
    // sigma'_a + sigma'_m (Shigley: "alternate simple check"), comparada a Sy.
    const sigmaMax = sigmaA + sigmaM;
    const nYield = Sy / sigmaMax;

    return {
      d, iterations, converged: iterations < maxIter,
      Kt, Kts, q, qs, Kf, Kfs,
      se, sigmaA, sigmaM, nAchieved,
      sigmaMax, nYield,
      rUsed: rFixed !== null ? rFixed : rOverD * d
    };
  }

  // Compara os quatro critérios de fadiga lado a lado, com o MESMO Kf/Kfs/Se
  // (tomados do critério selecionado, já convergido) — só troca a fórmula.
  function compareCriteria(input, convergedResult) {
    const criteria = ['goodman', 'gerber', 'asme_elliptic', 'soderberg'];
    const labels = { goodman: 'Goodman', gerber: 'Gerber', asme_elliptic: 'ASME-Elíptico', soderberg: 'Soderberg' };
    return criteria.map(function (crit) {
      const d = solveDiameterForN(
        input.nTarget, crit, input.Ma, input.Ta, input.Mm, input.Tm,
        convergedResult.Kf, convergedResult.Kfs, convergedResult.se.Se, input.Sut, input.Sy
      );
      return { criterion: crit, label: labels[crit], d: d };
    });
  }

  // ---------------------------------------------------------------------
  // Verificação simplificada (legado) — torção estática pura, mesma
  // fórmula usada na planilha original (365,026 = constante já ajustada
  // para P em kW, n em rpm, sigma em MPa, d em mm; ver conferência anterior).
  // ---------------------------------------------------------------------
  function legacyStaticDiameter(FS, P_kW, n_rpm, sigmaAdm_MPa) {
    const P = parseFloat(P_kW), n = parseFloat(n_rpm), sig = parseFloat(sigmaAdm_MPa), fs = parseFloat(FS);
    if (!P || !n || !sig || !fs) return null;
    return 365.026 * Math.cbrt((fs * P) / (sig * n));
  }

  window.Engine = {
    torqueFromPower,
    ka, kb, ke, seLinha, enduranceLimit, KC_COMBINED,
    notchSensitivity, kf_from,
    TABLE_7_1,
    vonMisesStress, safetyFactor, solveDiameterForN,
    designShaftEnd, compareCriteria,
    legacyStaticDiameter
  };
})();
