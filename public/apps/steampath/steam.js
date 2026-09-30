// Núcleo termodinâmico IAPWS-IF97 (Regiões 1, 2 e 4), portado de VBA (X-Steam,
// Magnus Holmgren, domínio público, www.x-eng.com) para JavaScript puro.
// Cobre toda a faixa de uso de uma turbina a vapor industrial: líquido comprimido
// (Região 1), vapor superaquecido (Região 2) e saturação/vapor úmido (Região 4).
// Válido para 0 < p < 100 MPa e T até a linha de saturação + superaquecido até 800°C
// (Região 2) — não implementa Região 3 (supercrítica) nem Região 5 (T>800°C),
// desnecessárias para turbinas a vapor industriais.
const Steam = (function () {
  const R = 0.461526; // kJ/(kg.K)

  // ---------------- Região 1: líquido comprimido ----------------
  const I1 = [0,0,0,0,0,0,0,0,1,1,1,1,1,1,2,2,2,2,2,3,3,3,4,4,4,5,8,8,21,23,29,30,31,32];
  const J1 = [-2,-1,0,1,2,3,4,5,-9,-7,-1,0,1,3,-3,0,1,3,17,-4,0,6,-5,-2,10,-8,-11,-6,-29,-31,-38,-39,-40,-41];
  const n1 = [0.14632971213167,-0.84548187169114,-3.756360367204,3.3855169168385,-0.95791963387872,0.15772038513228,-0.016616417199501,8.1214629983568E-04,2.8319080123804E-04,-6.0706301565874E-04,-0.018990068218419,-0.032529748770505,-0.021841717175414,-5.283835796993E-05,-4.7184321073267E-04,-3.0001780793026E-04,4.7661393906987E-05,-4.4141845330846E-06,-7.2694996297594E-16,-3.1679644845054E-05,-2.8270797985312E-06,-8.5205128120103E-10,-2.2425281908E-06,-6.5171222895601E-07,-1.4341729937924E-13,-4.0516996860117E-07,-1.2734301741641E-09,-1.7424871230634E-10,-6.8762131295531E-19,1.4478307828521E-20,2.6335781662795E-23,-1.1947622640071E-23,1.8228094581404E-24,-9.3537087292458E-26];

  function v1_pT(p, T) {
    const ps = p / 16.53, tau = 1386 / T;
    let g_p = 0;
    for (let i = 0; i < 34; i++) g_p -= n1[i] * I1[i] * Math.pow(7.1 - ps, I1[i] - 1) * Math.pow(tau - 1.222, J1[i]);
    return R * T / p * ps * g_p / 1000;
  }
  function h1_pT(p, T) {
    const ps = p / 16.53, tau = 1386 / T;
    let g_t = 0;
    for (let i = 0; i < 34; i++) g_t += n1[i] * Math.pow(7.1 - ps, I1[i]) * J1[i] * Math.pow(tau - 1.222, J1[i] - 1);
    return R * T * tau * g_t;
  }
  function s1_pT(p, T) {
    const ps = p / 16.53, tau = 1386 / T;
    let g = 0, g_t = 0;
    for (let i = 0; i < 34; i++) {
      g_t += n1[i] * Math.pow(7.1 - ps, I1[i]) * J1[i] * Math.pow(tau - 1.222, J1[i] - 1);
      g += n1[i] * Math.pow(7.1 - ps, I1[i]) * Math.pow(tau - 1.222, J1[i]);
    }
    return R * tau * g_t - R * g;
  }

  // ---------------- Região 2: vapor superaquecido ----------------
  const J0 = [0,1,-5,-4,-3,-2,-1,2,3];
  const n0 = [-9.6927686500217,10.086655968018,-0.005608791128302,0.071452738081455,-0.40710498223928,1.4240819171444,-4.383951131945,-0.28408632460772,0.021268463753307];
  const Ir = [1,1,1,1,1,2,2,2,2,2,3,3,3,3,3,4,4,4,5,6,6,6,7,7,7,8,8,9,10,10,10,16,16,18,20,20,20,21,22,23,24,24,24];
  const Jr = [0,1,2,3,6,1,2,4,7,36,0,1,3,6,35,1,2,3,7,3,16,35,0,11,25,8,36,13,4,10,14,29,50,57,20,35,48,21,53,39,26,40,58];
  const nr = [-1.7731742473213E-03,-0.017834862292358,-0.045996013696365,-0.057581259083432,-0.05032527872793,-3.3032641670203E-05,-1.8948987516315E-04,-3.9392777243355E-03,-0.043797295650573,-2.6674547914087E-05,2.0481737692309E-08,4.3870667284435E-07,-3.227767723857E-05,-1.5033924542148E-03,-0.040668253562649,-7.8847309559367E-10,1.2790717852285E-08,4.8225372718507E-07,2.2922076337661E-06,-1.6714766451061E-11,-2.1171472321355E-03,-23.895741934104,-5.905956432427E-18,-1.2621808899101E-06,-0.038946842435739,1.1256211360459E-11,-8.2311340897998,1.9809712802088E-08,1.0406965210174E-19,-1.0234747095929E-13,-1.0018179379511E-09,-8.0882908646985E-11,0.10693031879409,-0.33662250574171,8.9185845355421E-25,3.0629316876232E-13,-4.2002467698208E-06,-5.9056029685639E-26,3.7826947613457E-06,-1.2768608934681E-15,7.3087610595061E-29,5.5414715350778E-17,-9.436970724121E-07];

  function v2_pT(p, T) {
    const tau = 540 / T;
    let gr_pi = 0;
    for (let i = 0; i < 43; i++) gr_pi += nr[i] * Ir[i] * Math.pow(p, Ir[i] - 1) * Math.pow(tau - 0.5, Jr[i]);
    return R * T / p * p * (1 / p + gr_pi) / 1000;
  }
  function h2_pT(p, T) {
    const tau = 540 / T;
    let g0_tau = 0, gr_tau = 0;
    for (let i = 0; i < 9; i++) g0_tau += n0[i] * J0[i] * Math.pow(tau, J0[i] - 1);
    for (let i = 0; i < 43; i++) gr_tau += nr[i] * Math.pow(p, Ir[i]) * Jr[i] * Math.pow(tau - 0.5, Jr[i] - 1);
    return R * T * tau * (g0_tau + gr_tau);
  }
  function s2_pT(p, T) {
    const tau = 540 / T;
    let g0 = Math.log(p), g0_tau = 0, gr = 0, gr_tau = 0;
    for (let i = 0; i < 9; i++) { g0 += n0[i] * Math.pow(tau, J0[i]); g0_tau += n0[i] * J0[i] * Math.pow(tau, J0[i] - 1); }
    for (let i = 0; i < 43; i++) { gr += nr[i] * Math.pow(p, Ir[i]) * Math.pow(tau - 0.5, Jr[i]); gr_tau += nr[i] * Math.pow(p, Ir[i]) * Jr[i] * Math.pow(tau - 0.5, Jr[i] - 1); }
    return R * (tau * (g0_tau + gr_tau) - (g0 + gr));
  }
  function w2_pT(p, T) {
    const tau = 540 / T;
    let g0_tt = 0, gr_pi = 0, gr_pipi = 0, gr_pitau = 0, gr_tt = 0;
    for (let i = 0; i < 9; i++) g0_tt += n0[i] * J0[i] * (J0[i] - 1) * Math.pow(tau, J0[i] - 2);
    for (let i = 0; i < 43; i++) {
      gr_pi += nr[i] * Ir[i] * Math.pow(p, Ir[i] - 1) * Math.pow(tau - 0.5, Jr[i]);
      gr_pipi += nr[i] * Ir[i] * (Ir[i] - 1) * Math.pow(p, Ir[i] - 2) * Math.pow(tau - 0.5, Jr[i]);
      gr_pitau += nr[i] * Ir[i] * Math.pow(p, Ir[i] - 1) * Jr[i] * Math.pow(tau - 0.5, Jr[i] - 1);
      gr_tt += nr[i] * Math.pow(p, Ir[i]) * Jr[i] * (Jr[i] - 1) * Math.pow(tau - 0.5, Jr[i] - 2);
    }
    return Math.sqrt(1000 * R * T * (1 + 2 * p * gr_pi + p * p * gr_pi * gr_pi) /
      ((1 - p * p * gr_pipi) + Math.pow(1 + p * gr_pi - tau * p * gr_pitau, 2) / (tau * tau * (g0_tt + gr_tt))));
  }

  // Backward T(p,h) e T(p,s) — Região 2, sub-regiões A/B/C (evita iteração)
  function T2_ph(p, h) {
    let sub;
    if (p < 4) sub = 1; else sub = (p < (905.84278514723 - 0.67955786399241*h + 1.2809002730136E-04*h*h)) ? 2 : 3;
    const hs = h / 2000;
    if (sub === 1) {
      const Ji=[0,1,2,3,7,20,0,1,2,3,7,9,11,18,44,0,2,7,36,38,40,42,44,24,44,12,32,44,32,36,42,34,44,28];
      const Ii=[0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,2,2,2,2,2,2,2,2,3,3,4,4,4,5,5,5,6,6,7];
      const ni=[1089.8952318288,849.51654495535,-107.81748091826,33.153654801263,-7.4232016790248,11.765048724356,1.844574935579,-4.1792700549624,6.2478196935812,-17.344563108114,-200.58176862096,271.96065473796,-455.11318285818,3091.9688604755,252266.40357872,-6.1707422868339E-03,-0.31078046629583,11.670873077107,128127984.04046,-985549096.23276,2822454697.3002,-3594897141.0703,1722734991.3197,-13551.334240775,12848734.66465,1.3865724283226,235988.32556514,-13105236.545054,7399.9835474766,-551966.9703006,3715408.5996233,19127.72923966,-415351.64835634,-62.459855192507];
      let T = 0; for (let i=0;i<34;i++) T += ni[i]*Math.pow(p,Ii[i])*Math.pow(hs-2.1,Ji[i]); return T;
    } else if (sub === 2) {
      const Ji=[0,1,2,12,18,24,28,40,0,2,6,12,18,24,28,40,2,8,18,40,1,2,12,24,2,12,18,24,28,40,18,24,40,28,2,28,1,40];
      const Ii=[0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,4,4,5,5,5,6,7,7,9,9];
      const ni=[1489.5041079516,743.07798314034,-97.708318797837,2.4742464705674,-0.63281320016026,1.1385952129658,-0.47811863648625,8.5208123431544E-03,0.93747147377932,3.3593118604916,3.3809355601454,0.16844539671904,0.73875745236695,-0.47128737436186,0.15020273139707,-0.002176411421975,-0.021810755324761,-0.10829784403677,-0.046333324635812,7.1280351959551E-05,1.1032831789999E-04,1.8955248387902E-04,3.0891541160537E-03,1.3555504554949E-03,2.8640237477456E-07,-1.0779857357512E-05,-7.6462712454814E-05,1.4052392818316E-05,-3.1083814331434E-05,-1.0302738212103E-06,2.821728163504E-07,1.2704902271945E-06,7.3803353468292E-08,-1.1030139238909E-08,-8.1456365207833E-14,-2.5180545682962E-11,-1.7565233969407E-18,8.6934156344163E-15];
      let T = 0; for (let i=0;i<38;i++) T += ni[i]*Math.pow(p-2,Ii[i])*Math.pow(hs-2.6,Ji[i]); return T;
    } else {
      const Ji=[0,4,0,2,0,2,0,1,0,2,0,1,4,8,4,0,1,4,10,12,16,20,22];
      const Ii=[-7,-7,-6,-6,-5,-5,-2,-2,-1,-1,0,0,1,1,2,6,6,6,6,6,6,6,6];
      const ni=[-3236839855524.2,7326335090218.1,358250899454.47,-583401318515.9,-10783068217.47,20825544563.171,610747.83564516,859777.2253558,-25745.72360417,31081.088422714,1208.2315865936,482.19755109255,3.7966001272486,-10.842984880077,-0.04536417267666,1.4559115658698E-13,1.126159740723E-12,-1.7804982240686E-11,1.2324579690832E-07,-1.1606921130984E-06,2.7846367088554E-05,-5.9270038474176E-04,1.2918582991878E-03];
      let T = 0; for (let i=0;i<23;i++) T += ni[i]*Math.pow(p+25,Ii[i])*Math.pow(hs-1.8,Ji[i]); return T;
    }
  }
  function T2_ps(p, s) {
    let sub;
    if (p < 4) sub = 1; else sub = (s < 5.85) ? 3 : 2;
    if (sub === 1) {
      const Ii=[-1.5,-1.5,-1.5,-1.5,-1.5,-1.5,-1.25,-1.25,-1.25,-1,-1,-1,-1,-1,-1,-0.75,-0.75,-0.5,-0.5,-0.5,-0.5,-0.25,-0.25,-0.25,-0.25,0.25,0.25,0.25,0.25,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.75,0.75,0.75,0.75,1,1,1.25,1.25,1.5,1.5];
      const Ji=[-24,-23,-19,-13,-11,-10,-19,-15,-6,-26,-21,-17,-16,-9,-8,-15,-14,-26,-13,-9,-7,-27,-25,-11,-6,1,4,8,11,0,1,5,6,10,14,16,0,4,9,17,7,18,3,15,5,18];
      const ni=[-392359.83861984,515265.7382727,40482.443161048,-321.93790923902,96.961424218694,-22.867846371773,-449429.14124357,-5011.8336020166,0.35684463560015,44235.33584819,-13673.388811708,421632.60207864,22516.925837475,474.42144865646,-149.31130797647,-197811.26320452,-23554.39947076,-19070.616302076,55375.669883164,3829.3691437363,-603.91860580567,1936.3102620331,4266.064369861,-5978.0638872718,-704.01463926862,338.36784107553,20.862786635187,0.033834172656196,-4.3124428414893E-05,166.53791356412,-139.86292055898,-0.78849547999872,0.072132411753872,-5.9754839398283E-03,-1.2141358953904E-05,2.3227096733871E-07,-10.538463566194,2.0718925496502,-0.072193155260427,2.074988708112E-07,-0.018340657911379,2.9036272348696E-07,0.21037527893619,2.5681239729999E-04,-0.012799002933781,-8.2198102652018E-06];
      const sigma = s/2; let teta = 0;
      for (let i=0;i<46;i++) teta += ni[i]*Math.pow(p,Ii[i])*Math.pow(sigma-2,Ji[i]);
      return teta;
    } else if (sub === 2) {
      const Ii=[-6,-6,-5,-5,-4,-4,-4,-3,-3,-3,-3,-2,-2,-2,-2,-1,-1,-1,-1,-1,0,0,0,0,0,0,0,1,1,1,1,1,1,2,2,2,3,3,3,4,4,5,5,5];
      const Ji=[0,11,0,11,0,1,11,0,1,11,12,0,1,6,10,0,1,5,8,9,0,1,2,4,5,6,9,0,1,2,3,7,8,0,1,5,0,1,3,0,1,0,1,2];
      const ni=[316876.65083497,20.864175881858,-398593.99803599,-21.816058518877,223697.85194242,-2784.1703445817,9.920743607148,-75197.512299157,2970.8605951158,-3.4406878548526,0.38815564249115,17511.29508575,-1423.7112854449,1.0943803364167,0.89971619308495,-3375.9740098958,471.62885818355,-1.9188241993679,0.41078580492196,-0.33465378172097,1387.0034777505,-406.63326195838,41.72734715961,2.1932549434532,-1.0320050009077,0.35882943516703,5.2511453726066E-03,12.838916450705,-2.8642437219381,0.56912683664855,-0.099962954584931,-3.2632037778459E-03,2.3320922576723E-04,-0.1533480985745,0.029072288239902,3.7534702741167E-04,1.7296691702411E-03,-3.8556050844504E-04,-3.5017712292608E-05,-1.4566393631492E-05,5.6420857267269E-06,4.1286150074605E-08,-2.0684671118824E-08,1.6409393674725E-09];
      const sigma = s/0.7853; let teta = 0;
      for (let i=0;i<44;i++) teta += ni[i]*Math.pow(p,Ii[i])*Math.pow(10-sigma,Ji[i]);
      return teta;
    } else {
      const Ii=[-2,-2,-1,0,0,0,0,1,1,1,1,2,2,2,3,3,3,4,4,4,5,5,5,6,6,7,7,7,7,7];
      const Ji=[0,1,0,0,1,2,3,0,1,3,4,0,1,2,0,1,5,0,1,4,0,1,2,0,1,0,1,3,4,5];
      const ni=[909.68501005365,2404.566708842,-591.6232638713,541.45404128074,-270.98308411192,979.76525097926,-469.66772959435,14.399274604723,-19.104204230429,5.3299167111971,-21.252975375934,-0.3114733441376,0.60334840894623,-0.042764839702509,5.8185597255259E-03,-0.014597008284753,5.6631175631027E-03,-7.6155864584577E-05,2.2440342919332E-04,-1.2561095013413E-05,6.3323132660934E-07,-2.0541989675375E-06,3.6405370390082E-08,-2.9759897789215E-09,1.0136618529763E-08,5.9925719692351E-12,-2.0677870105164E-11,-2.0874278181886E-11,1.0162166825089E-10,-1.6429828281347E-10];
      const sigma = s/2.9251; let teta = 0;
      for (let i=0;i<30;i++) teta += ni[i]*Math.pow(p,Ii[i])*Math.pow(2-sigma,Ji[i]);
      return teta;
    }
  }

  // ---------------- Região 4: saturação ----------------
  function p4_T(T) {
    const teta = T - 0.23855557567849 / (T - 650.17534844798);
    const a = teta*teta + 1167.0521452767*teta - 724213.16703206;
    const b = -17.073846940092*teta*teta + 12020.82470247*teta - 3232555.0322333;
    const c = 14.91510861353*teta*teta - 4823.2657361591*teta + 405113.40542057;
    return Math.pow(2*c / (-b + Math.sqrt(b*b - 4*a*c)), 4);
  }
  function T4_p(p) {
    const beta = Math.pow(p, 0.25);
    const e = beta*beta - 17.073846940092*beta + 14.91510861353;
    const f = 1167.0521452767*beta*beta + 12020.82470247*beta - 4823.2657361591;
    const g = -724213.16703206*beta*beta - 3232555.0322333*beta + 405113.40542057;
    const d = 2*g / (-f - Math.sqrt(f*f - 4*e*g));
    return (650.17534844798 + d - Math.sqrt(Math.pow(650.17534844798+d,2) - 4*(-0.23855557567849 + 650.17534844798*d))) / 2;
  }

  // ---------------- Viscosidade dinâmica (IAPWS 1985, revisão 2003) ----------------
  // Usada pelo número de Reynolds do escoamento entre disco e diafragma
  // (empuxo axial). Depende só de densidade e temperatura — reaproveita v e T
  // que os estados já calculados (stateFromPT/PH/PS) trazem, em vez de
  // reimplementar a seleção de região da VBA original.
  function viscosityFromRhoT(rho_kgm3, T_K) {
    const h0 = [0.5132047, 0.3205656, 0, 0, -0.7782567, 0.1885447];
    const h1 = [0.2151778, 0.7317883, 1.241044, 1.476783, 0, 0];
    const h2 = [-0.2818107, -1.070786, -1.263184, 0, 0, 0];
    const h3 = [0.1778064, 0.460504, 0.2340379, -0.4924179, 0, 0];
    const h4 = [-0.0417661, 0, 0, 0.1600435, 0, 0];
    const h5 = [0, -0.01578386, 0, 0, 0, 0];
    const h6 = [0, 0, 0, -0.003629481, 0, 0];
    const rhos = rho_kgm3 / 317.763, Ts = T_K / 647.226;
    const my0 = Math.sqrt(Ts) / (1 + 0.978197 / Ts + 0.579829 / (Ts * Ts) - 0.202354 / (Ts * Ts * Ts));
    let sum = 0;
    for (let i = 0; i < 6; i++) {
      const a = Math.pow(1 / Ts - 1, i), b = Math.pow(rhos - 1, 1), c = Math.pow(rhos - 1, 2), d = Math.pow(rhos - 1, 3), e = Math.pow(rhos - 1, 4), f = Math.pow(rhos - 1, 5), g = Math.pow(rhos - 1, 6);
      sum += h0[i] * a + h1[i] * a * b + h2[i] * a * c + h3[i] * a * d + h4[i] * a * e + h5[i] * a * f + h6[i] * a * g;
    }
    const my1 = Math.exp(rhos * sum);
    return my0 * my1 * 0.000055071; // Pa·s
  }
  // Viscosidade a partir de um estado já calculado (usa v e T do próprio estado).
  function viscosityOfState(state) { return viscosityFromRhoT(1 / state.v, toK(state.T)); }

  // ---------------- API de alto nível: p em bar, T em °C, h em kJ/kg, s em kJ/kgK ----------------
  // Internamente IF97 usa p em MPa e T em K.
  function toMPa(bar) { return bar / 10; }
  function toK(degC) { return degC + 273.15; }
  function toC(K) { return K - 273.15; }

  // Propriedades de saturação (líquido/vapor) a uma dada pressão (bar)
  function satAt(p_bar) {
    const pMPa = toMPa(p_bar);
    const TsatK = T4_p(pMPa);
    const hL = h1_pT(pMPa, TsatK), sL = s1_pT(pMPa, TsatK), vL = v1_pT(pMPa, TsatK);
    const hV = h2_pT(pMPa, TsatK), sV = s2_pT(pMPa, TsatK), vV = v2_pT(pMPa, TsatK);
    return { Tsat: toC(TsatK), hL, sL, vL, hV, sV, vV };
  }

  // Estado completo a partir de (p [bar], T [°C]) — assume vapor superaquecido (Região 2)
  // ou líquido comprimido (Região 1) conforme T vs Tsat(p).
  function stateFromPT(p_bar, T_degC) {
    const pMPa = toMPa(p_bar), TK = toK(T_degC);
    const sat = satAt(p_bar);
    if (T_degC >= sat.Tsat - 1e-6) {
      const h = h2_pT(pMPa, TK), s = s2_pT(pMPa, TK), v = v2_pT(pMPa, TK);
      let w = null; try { w = w2_pT(pMPa, TK); } catch (e) {}
      return { p: p_bar, T: T_degC, h, s, v, x: 1, w, region: 2, warning: null };
    }
    const h = h1_pT(pMPa, TK), s = s1_pT(pMPa, TK), v = v1_pT(pMPa, TK);
    return { p: p_bar, T: T_degC, h, s, v, x: 0, w: null, region: 1, warning: 'Líquido comprimido (T < Tsat) — fora da faixa normal de um estágio de turbina a vapor.' };
  }

  // Estado a partir de (p [bar], s [kJ/kgK]) — usado para achar o ponto isentrópico
  // (expansão ideal) numa dada pressão a jusante. Detecta automaticamente
  // superaquecido (Região 2) vs. vapor úmido (Região 4).
  function stateFromPS(p_bar, s) {
    const pMPa = toMPa(p_bar);
    const sat = satAt(p_bar);
    if (s >= sat.sV) {
      const TK = T2_ps(pMPa, s);
      const h = h2_pT(pMPa, TK);
      let w = null; try { w = w2_pT(pMPa, TK); } catch (e) {}
      return { p: p_bar, T: toC(TK), h, s, v: v2_pT(pMPa, TK), x: 1, w, region: 2 };
    }
    if (s <= sat.sL) {
      // líquido sub-resfriado: fora do envelope normal de operação, devolve saturado
      return { p: p_bar, T: sat.Tsat, h: sat.hL, s, v: sat.vL, x: 0, w: null, region: 1, warning: 'Ponto abaixo da linha de líquido saturado.' };
    }
    const x = (s - sat.sL) / (sat.sV - sat.sL);
    const h = sat.hL + x * (sat.hV - sat.hL);
    const v = sat.vL + x * (sat.vV - sat.vL);
    return { p: p_bar, T: sat.Tsat, h, s, v, x, w: null, region: 4 };
  }

  // Estado a partir de (p [bar], h [kJ/kg]) — usado para o ponto real após perdas.
  function stateFromPH(p_bar, h) {
    const pMPa = toMPa(p_bar);
    const sat = satAt(p_bar);
    if (h >= sat.hV) {
      const TK = T2_ph(pMPa, h);
      const s = s2_pT(pMPa, TK);
      let w = null; try { w = w2_pT(pMPa, TK); } catch (e) {}
      return { p: p_bar, T: toC(TK), h, s, v: v2_pT(pMPa, TK), x: 1, w, region: 2 };
    }
    if (h <= sat.hL) {
      return { p: p_bar, T: sat.Tsat, h, s: sat.sL, v: sat.vL, x: 0, w: null, region: 1, warning: 'Ponto abaixo da linha de líquido saturado.' };
    }
    const x = (h - sat.hL) / (sat.hV - sat.hL);
    const s = sat.sL + x * (sat.sV - sat.sL);
    const v = sat.vL + x * (sat.vV - sat.vL);
    return { p: p_bar, T: sat.Tsat, h, s, v, x, w: null, region: 4 };
  }

  return { satAt, stateFromPT, stateFromPS, stateFromPH, toMPa, toK, toC, viscosityFromRhoT, viscosityOfState, _internal: { h1_pT, s1_pT, v1_pT, h2_pT, s2_pT, v2_pT, w2_pT, p4_T, T4_p } };
})();

if (typeof module !== 'undefined') module.exports = Steam;
else (typeof window !== 'undefined' ? window : globalThis).Steam = Steam;
