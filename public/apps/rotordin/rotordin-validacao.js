/*
 * Validação do motor do ROTORDIN.  Uso:  node tests/rotordin-validacao.js
 *
 * rotordin-referencia-python.json foi gerado pela implementação Python original
 * (rotordyn v0.2), que por sua vez foi validada contra solução analítica e contra
 * o ROSS (Petrobras) com diferença relativa ~1e-13.
 */
const E = require('../public/apps/rotordin/engine.js');
const REF = require('./rotordin-referencia-python.json');
let fails = 0, passes = 0;
function check(name, cond, info) {
  if (cond) { passes++; console.log('  ok   ' + name + (info ? '  (' + info + ')' : '')); }
  else { fails++; console.log('  FALHOU ' + name + (info ? '  (' + info + ')' : '')); }
}
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-30);
const maxRel = (A, B) => A.reduce((m, a, i) => Math.max(m, rel(a, B[i])), 0);
const RPM = E.RPM;

console.log('1) Eixo biapoiado vs solução exata da viga de Timoshenko');
{
  // EI·k⁴ − [ρA + ρI·k²·(1 + E/(κG))]·ω² + (ρ²I/(κG))·ω⁴ = 0 ,  k = nπ/L
  const ne = 40, L = 1.5, D = 0.05, Ee = 211e9, nu = 0.3, rho = 7810, Gs = Ee / (2 * (1 + nu)), kap = 6 * (1 + nu) / (7 + 6 * nu);
  const A = Math.PI * D * D / 4, I = Math.PI * D ** 4 / 64;
  const p = { shaft: Array.from({ length: ne }, () => ({ L: 1000 * L / ne, od: 1000 * D, id: 0, od_mass: null, id_mass: null, material: 'Aço' })),
              disks: [], bearings: [1, ne + 1].map((n) => Object.assign(E.blankRow('bearings'), { node: n, kxx: 1e15, kyy: 1e15, cxx: 0, cyy: 0 })) };
  const m = E.modal(E.buildModel(p, {}), 0, 6);
  const an = [1, 2, 3].map((n) => {
    const k = n * Math.PI / L, a = rho * rho * I / (kap * Gs), b = -(rho * A + rho * I * k * k * (1 + Ee / (kap * Gs))), c = Ee * I * k ** 4;
    return Math.sqrt((-b - Math.sqrt(b * b - 4 * a * c)) / (2 * a));
  });
  const num = [m.wd[0], m.wd[2], m.wd[4]];
  check('3 primeiras frequências', maxRel(num, an) < 1e-4, 'erro máx ' + (100 * maxRel(num, an)).toFixed(4) + ' %');
}

function compareCase(tag, tables) {
  const R = REF[tag], p = R.project;
  const model = E.buildModel(p, tables);
  const loads = E.staticLoads(p);
  check(tag + ': cargas estáticas', maxRel(loads, [R.loads['0'], R.loads['1']]) < 1e-9, 'erro ' + maxRel(loads, [R.loads['0'], R.loads['1']]).toExponential(1));
  for (const rpm of [0, 5000, 11000]) {
    const ref = R['modal_' + rpm], m = E.modal(model, rpm * RPM, 10);
    const eW = maxRel(m.wd, ref.wd), eL = maxRel(m.logdec, ref.logdec);
    const wh = rpm === 0 ? true : m.whirl.every((w, i) => w === ref.whirl[i]);
    check(`${tag}: modal ${rpm} rpm — frequências, log dec${rpm ? ', precessão' : ''}`, eW < 1e-6 && eL < 1e-4 && wh,
          `ωd ${eW.toExponential(1)}, δ ${eL.toExponential(1)}`);
  }
  const ubs = [{ node: 6, U: 159.6e-6, phaseDeg: 0 }, { node: 10, U: 112.5e-6, phaseDeg: 180 }];
  const maj = [], ph = [];
  R.unb.rpm.forEach((r) => { const q = E.unbalanceAt(model, r * RPM, ubs); maj.push(2 * E.majorAxis(q.X[3], q.Y[3])); ph.push(Math.atan2(q.X[13].im, q.X[13].re) * 180 / Math.PI); });
  const eA = maxRel(maj, R.unb.maj3), eP = Math.max(...ph.map((v, i) => Math.abs(((v - R.unb.ph13[i] + 540) % 360) - 180)));
  check(tag + ': desbalanceamento (amplitude, fase)', eA < 1e-6 && eP < 1e-4, `amp ${eA.toExponential(1)}, fase ${eP.toExponential(1)}°`);
  const speeds = Array.from({ length: 31 }, (_, i) => i * 500 * RPM);
  const crit = E.criticalSpeeds({ speeds, pts: speeds.map((s) => E.modal(model, s, 8)) });
  const ok = crit.length === R.crit.length && crit.every((c, i) => rel(c.speed / RPM, R.crit[i][0]) < 1e-6);
  check(tag + ': velocidades críticas', ok, crit.map((c) => (c.speed / RPM).toFixed(1)).join(', ') + ' rpm');
  const Qs = [0, 5e6, 1e7, 1.5e7, 2e7, 2.5e7, 3e7], st = Qs.map((Q) => E.stabilityPoint(model, 11000 * RPM, 8, Q).firstForward);
  check(tag + ': mapa de estabilidade', maxRel(st, R.stab) < 1e-4, 'erro ' + maxRel(st, R.stab).toExponential(1));
  return model;
}

console.log('2) Rotor exemplo com mancais constantes vs Python');
compareCase('constante', {});

console.log('3) Tabelas de Sommerfeld vs Python');
const tables = {};
for (const [kind, pre] of [['Cilíndrico 360°', 0], ['Elíptico', 0.5], ['3 lobos', 0.5], ['Tilting pad LOP', 0.3]]) {
  const t0 = Date.now(), t = E.fluid.buildTable(E.fluid.makeGeometry(kind, 0.5, pre, 5, 60, 0.5)), ref = REF.tables[kind];
  const same = t.eps.length === ref.eps.length;
  let eS = 0, eK = 0, eC = 0;
  if (same) {
    eS = maxRel(t.S, ref.S);
    t.K.forEach((K, i) => { const s = Math.abs(ref.K[i][0][0]) + Math.abs(ref.K[i][1][1]); [0, 1].forEach((a) => [0, 1].forEach((b) => { eK = Math.max(eK, Math.abs(K[a][b] - ref.K[i][a][b]) / s); })); });
    t.C.forEach((C, i) => { const s = Math.abs(ref.C[i][0][0]) + Math.abs(ref.C[i][1][1]); [0, 1].forEach((a) => [0, 1].forEach((b) => { eC = Math.max(eC, Math.abs(C[a][b] - ref.C[i][a][b]) / s); })); });
  }
  check(`${kind}: ${t.eps.length} pontos, S/K/C`, same && eS < 1e-6 && eK < 1e-5 && eC < 1e-5,
        `S ${eS.toExponential(1)}, K ${eK.toExponential(1)}, C ${eC.toExponential(1)}, ${Date.now() - t0} ms`);
}

console.log('4) Rotor exemplo com tilting pad LBP vs Python');
{
  const p = REF.tiltingpad.project;
  E.requiredGeometries(p).forEach((g) => { tables[g.key] = E.fluid.buildTable(g); });
  const model = compareCase('tiltingpad', tables);
  const b = model.bearings[0], rb = REF.tiltingpad.brg0;
  check('coeficientes do mancal LA vs rotação', maxRel(Array.from(b.kxx), rb.kxx) < 1e-5 && maxRel(Array.from(b.cyy), rb.cyy) < 1e-5,
        'kxx ' + maxRel(Array.from(b.kxx), rb.kxx).toExponential(1));
}

console.log('5) Mancal 360° L/D = 1 vs Raimondi & Boyd (filme iniciando na espessura máxima)');
{
  const rb = { 0.2: [0.631, 74.02], 0.4: [0.264, 63.10], 0.6: [0.121, 50.58], 0.8: [0.0446, 36.24] };
  const F = (e, a) => new E.fluid.ReynoldsPad(E.fluid.makePad((a + Math.PI) * 180 / Math.PI, 360, 0.5, 0), 1.0, false, 144, 16).solve(e * Math.cos(a), e * Math.sin(a)).F;
  for (const e of Object.keys(rb).map(Number)) {
    let lo = -Math.PI / 2 - 0.1, hi = 0.2;
    for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (F(e, lo)[0] * F(e, mid)[0] <= 0) hi = mid; else lo = mid; }
    const a = (lo + hi) / 2, S = 1 / (3 * Math.PI * F(e, a)[1]), phi = Math.atan2(Math.cos(a), -Math.sin(a)) * 180 / Math.PI;
    check(`ε = ${e}`, rel(S, rb[e][0]) < 0.015 && Math.abs(phi - rb[e][1]) < 0.7, `S ${S.toFixed(4)} (RB ${rb[e][0]}), φ ${phi.toFixed(2)}° (RB ${rb[e][1]}°)`);
  }
}

console.log('6) Coeficientes vs teoria do mancal curto (L/D = 0,1, Gümbel)');
{
  const m = new E.fluid.FluidModel(E.fluid.makeGeometry('Cilíndrico 360°', 0.1), { nTheta: 180, nz: 10, cavitation: 'gumbel' });
  for (const e of [0.3, 0.6]) {
    const eq = m.equilibrium(e), kc = m.coefficients(eq.X, eq.Y, eq.D, eq.W);
    const h0 = 1 / (Math.PI ** 2 * (1 - e * e) + 16 * e * e) ** 1.5, s = Math.sqrt(1 - e * e), P = Math.PI;
    const axx = h0 * 4 * (P * P * (2 - e * e) + 16 * e * e), ayy = h0 * 4 * (P * P * (1 + 2 * e * e) + 32 * e * e * (1 + e * e) / (1 - e * e));
    const ayx = -h0 * P * (P * P * (1 - e * e) * (1 + 2 * e * e) + 32 * e * e * (1 + e * e)) / (e * s);
    const bxx = h0 * 2 * P * s * (P * P * (1 + 2 * e * e) - 16 * e * e) / e, byy = h0 * 2 * P * (P * P * (1 - e * e) ** 2 + 48 * e * e) / (e * s);
    const errs = [rel(kc.K[0][0], axx), rel(kc.K[1][1], ayy), rel(kc.K[1][0], ayx), rel(kc.C[0][0], bxx), rel(kc.C[1][1], byy)];
    check(`ε = ${e}`, Math.max(...errs) < 0.04, 'maior desvio ' + (100 * Math.max(...errs)).toFixed(1) + ' %');
  }
}

console.log('7) Viscosidade do óleo vs Python');
for (const g of Object.keys(REF.oil)) check(g + ' a 55 °C', rel(E.fluid.oilViscosity(g, 55), REF.oil[g]) < 1e-12);

console.log('8) Pipeline completo (Job) no exemplo com tilting pad');
{
  const t0 = Date.now(), r = E.run(REF.tiltingpad.project, { tables });
  check('relatório gerado', typeof r.report === 'string' && r.report.includes('ESTABILIDADE'), (Date.now() - t0) + ' ms');
  check('críticas do Campbell (Job) = Python', r.campbell.crit.length >= 1 && Math.abs(r.campbell.crit[0].rpm - REF.tiltingpad.crit[0][0]) < 60,
        r.campbell.crit.map((c) => c.rpm.toFixed(0)).join(', ') + ' rpm (malha de 60 pontos)');
}

console.log(`\n${passes} verificações ok, ${fails} falha(s)`);
process.exit(fails ? 1 : 0);
