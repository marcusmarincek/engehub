/*
 * ROTORDIN — motor de cálculo rotordinâmico (sem DOM, sem fetch).
 *
 * Porte para JavaScript do núcleo Python "rotordyn" (v0.2), que foi validado
 * contra solução analítica e contra o ROSS (Petrobras) com diferença relativa
 * ~1e-13. Este motor é conferido contra a versão Python por
 * tests/rotordin-validacao.js (ver ARCHITECTURE.md, seção "App ROTORDIN").
 *
 * Conteúdo:
 *   - Eixo em vigas de Timoshenko (4 GDL/nó: ux, uy, sx, sy), massas concentradas
 *     (m, Ip, Id) e mancais lineares com 8 coeficientes dependentes da rotação.
 *   - Modal amortecido (autovalores complexos), Campbell, críticas, resposta ao
 *     desbalanceamento, cargas estáticas, mapa de estabilidade.
 *   - Normas: ISO 21940-11 (grau G, 1 ou 2 planos) e API 617 (Ua, AF, SM, log dec).
 *   - Mancais hidrodinâmicos: equação de Reynolds por diferenças finitas com
 *     cavitação (condição de Reynolds por complementaridade linear), tabelas
 *     adimensionais por número de Sommerfeld e interpolação em log S.
 *
 * Unidades de entrada (params, iguais ao formulário): mm, µm (folga), kg, kg·m²,
 * N/m, N·s/m, rpm, °C. Nós numerados a partir de 1. Internamente tudo em SI.
 * Convenção: rotação em +z (de x para y); força do mancal F = −K·q − C·q̇.
 */
(function (root, factory) {
  var E = factory();
  if (typeof module === 'object' && module.exports) module.exports = E;
  else root.Engine = E;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TWO_PI = 2 * Math.PI;
  var RPM = TWO_PI / 60;          // rpm -> rad/s
  var G_ACCEL = 9.80665;
  var DEG = Math.PI / 180;

  // ======================================================================= //
  // Esquema de dados (colunas das tabelas, valores padrão, listas)
  // ======================================================================= //
  // alpha: coeficiente de dilatação térmica linear [µm/(m·K)]
  var MATERIALS = {
    'Aço':      { E: 211e9, rho: 7810, nu: 0.30, alpha: 11.5 },
    'Aço inox': { E: 193e9, rho: 8000, nu: 0.29, alpha: 16.0 },
    'Titânio':  { E: 114e9, rho: 4430, nu: 0.34, alpha: 8.6 },
    'Alumínio': { E: 69e9,  rho: 2700, nu: 0.33, alpha: 23.0 }
  };
  var BEARING_TYPES = ['Constante', 'Cilíndrico 360°', 'Cilíndrico 2 ranhuras', 'Elíptico',
                       '3 lobos', 'Tilting pad LOP', 'Tilting pad LBP'];
  var OILS = ['ISO VG 22', 'ISO VG 32', 'ISO VG 46', 'ISO VG 68', 'ISO VG 100', 'ISO VG 150'];
  var ISO_G_GRADES = [0.4, 1, 2.5, 6.3, 16, 40, 100, 250, 630, 1600, 4000];

  function isConst(r) { return (r.type || 'Constante') === 'Constante'; }
  function isFluid(r) { return !isConst(r); }
  function hasPreload(r) { return ['Elíptico', '3 lobos', 'Tilting pad LOP', 'Tilting pad LBP'].indexOf(r.type) >= 0; }
  function isTP(r) { return String(r.type || '').indexOf('Tilting') === 0; }
  // projetos antigos (sem a coluna) continuam com temperatura informada
  function isCalcT(r) { return isFluid(r) && r.thermal === 'Calculada'; }
  function isInfT(r) { return isFluid(r) && r.thermal !== 'Calculada'; }
  function noBore(r) { return hasPreload(r) && (r.e_bore === null || r.e_bore === undefined || r.e_bore === ''); }

  // kind: num (obrigatório) | opt (pode ficar vazio) | int | str | choice
  var SCHEMA = {
    shaft: [
      { key: 'L', label: 'L [mm]', kind: 'num', def: 50 },
      { key: 'od', label: 'OD [mm]', kind: 'num', def: 50 },
      { key: 'id', label: 'ID [mm]', kind: 'num', def: 0 },
      { key: 'od_mass', label: 'OD massa [mm]', kind: 'opt', def: null, tip: 'Vazio = igual ao OD. Use para luvas e pacotes que somam massa sem somar rigidez.' },
      { key: 'id_mass', label: 'ID massa [mm]', kind: 'opt', def: null },
      { key: 'material', label: 'Material', kind: 'choice', def: 'Aço', choices: Object.keys(MATERIALS) }
    ],
    disks: [
      { key: 'name', label: 'Nome', kind: 'str', def: 'Massa' },
      { key: 'node', label: 'Nó', kind: 'int', def: 1 },
      { key: 'm', label: 'Massa [kg]', kind: 'num', def: 10 },
      { key: 'Ip', label: 'Ip [kg·m²]', kind: 'num', def: 0.05 },
      { key: 'Id', label: 'Id [kg·m²]', kind: 'num', def: 0.025 }
    ],
    bearings: [
      { key: 'name', label: 'Nome', kind: 'str', def: 'Mancal' },
      { key: 'node', label: 'Nó', kind: 'int', def: 1 },
      { key: 'type', label: 'Tipo', kind: 'choice', def: 'Constante', choices: BEARING_TYPES },
      { key: 'kxx', label: 'kxx [N/m]', kind: 'num', def: 1e8, enabled: isConst },
      { key: 'kyy', label: 'kyy [N/m]', kind: 'num', def: 1e8, enabled: isConst },
      { key: 'kxy', label: 'kxy [N/m]', kind: 'num', def: 0, enabled: isConst },
      { key: 'kyx', label: 'kyx [N/m]', kind: 'num', def: 0, enabled: isConst },
      { key: 'cxx', label: 'cxx [N·s/m]', kind: 'num', def: 1e4, enabled: isConst },
      { key: 'cyy', label: 'cyy [N·s/m]', kind: 'num', def: 1e4, enabled: isConst },
      { key: 'cxy', label: 'cxy [N·s/m]', kind: 'num', def: 0, enabled: isConst },
      { key: 'cyx', label: 'cyx [N·s/m]', kind: 'num', def: 0, enabled: isConst },
      { key: 'D', label: 'D [mm]', kind: 'num', def: 100, enabled: isFluid },
      { key: 'Lb', label: 'L mancal [mm]', kind: 'num', def: 50, enabled: isFluid },
      { key: 'Cr', label: 'Folga radial a frio [µm]', kind: 'num', def: 100, enabled: isFluid, tip: 'Folga radial de montagem (no pivô, para tilting pad), na temperatura de montagem (barra lateral).' },
      { key: 'Cr_hot', label: 'Folga a quente [µm]', kind: 'opt', def: null, enabled: isFluid, tip: 'Vazio = calculada pela dilatação térmica: C_quente = C_frio + R·α_mancal·(T_mancal − T_mont) − R·α_eixo·(T_munhão − T_mont).' },
      { key: 'e_bore', label: 'Excentricidade do furo [µm]', kind: 'opt', def: null, enabled: hasPreload, tip: 'Deslocamento do centro do furo da sapata/lobo em relação ao centro do mancal (e = C_p − C_b). Define a pré-carga de operação m = e/(C_quente + e) e prevalece sobre "Pré-carga m".' },
      { key: 'preload', label: 'Pré-carga m', kind: 'num', def: 0, enabled: noBore, tip: 'Usada só quando a excentricidade do furo não é informada (m fixo).' },
      { key: 'n_pads', label: 'Nº sapatas', kind: 'int', def: 5, enabled: isTP },
      { key: 'arc', label: 'Arco sapata [°]', kind: 'num', def: 60, enabled: isTP },
      { key: 'offset', label: 'Offset pivô', kind: 'num', def: 0.5, enabled: isTP },
      { key: 'oil', label: 'Óleo', kind: 'choice', def: 'ISO VG 46', choices: OILS, enabled: isFluid },
      { key: 'thermal', label: 'Térmica', kind: 'choice', def: 'Calculada', choices: ['Calculada', 'Informada'], enabled: isFluid, tip: 'Calculada: temperaturas pelo balanço térmico (atrito = calor levado pelo óleo). Informada: T efetiva do filme digitada.' },
      { key: 'T_in', label: 'T entrada óleo [°C]', kind: 'num', def: 45, enabled: isCalcT, tip: 'Temperatura de alimentação do óleo (térmica calculada).' },
      { key: 'T', label: 'T efetiva filme [°C]', kind: 'num', def: 50, enabled: isInfT, tip: 'Temperatura efetiva do filme (térmica informada).' },
      { key: 'T_j', label: 'T munhão [°C]', kind: 'opt', def: null, enabled: isFluid, tip: 'Vazio: calculada = T saída do óleo; informada = T efetiva.' },
      { key: 'T_h', label: 'T mancal [°C]', kind: 'opt', def: null, enabled: isFluid, tip: 'Vazio: calculada = média entre entrada e saída do óleo; informada = T efetiva.' },
      { key: 'alpha_b', label: 'α mancal [µm/m·K]', kind: 'num', def: 11.5, enabled: isFluid, tip: 'Dilatação do corpo do mancal: aço ≈ 11,5; bronze ≈ 18; ferro fundido ≈ 10,5. O α do munhão vem do material do eixo.' },
      { key: 'W', label: 'Carga [N]', kind: 'opt', def: null, enabled: isFluid, tip: 'Vazio = calculada pelo peso próprio (reações estáticas).' }
    ]
  };

  var DEFAULT_ANALYSIS = {
    speed_max: 15000, n_speeds: 60, n_modes: 8,
    op_min: 8000, op_max: 11000, mode_speed: 11000,
    G: 1.0, planes: 2, plane_A: 1, plane_B: 2,
    probes: '', stab_node: 1, stab_Qmax: 3.0e7,
    T_mount: 20, sens_dT: 20, sens_dC: 20, k_mix: 0.75
  };

  function blankRow(table) {
    var r = {};
    SCHEMA[table].forEach(function (c) { r[c.key] = c.def; });
    return r;
  }

  // ======================================================================= //
  // Álgebra linear (matrizes densas como arrays de Float64Array)
  // ======================================================================= //
  function mat(n, m) {
    var A = new Array(n);
    for (var i = 0; i < n; i++) A[i] = new Float64Array(m === undefined ? n : m);
    return A;
  }
  function copyMat(A) { return A.map(function (r) { return Float64Array.from(r); }); }

  // LU real com pivotamento parcial
  function luFactor(A0) {
    var n = A0.length, A = copyMat(A0), piv = new Int32Array(n);
    for (var i = 0; i < n; i++) piv[i] = i;
    for (var k = 0; k < n; k++) {
      var p = k, max = Math.abs(A[k][k]);
      for (var i2 = k + 1; i2 < n; i2++) { var v = Math.abs(A[i2][k]); if (v > max) { max = v; p = i2; } }
      if (max === 0) throw new Error('matriz singular');
      if (p !== k) { var t = A[p]; A[p] = A[k]; A[k] = t; var tp = piv[p]; piv[p] = piv[k]; piv[k] = tp; }
      var rk = A[k], d = rk[k];
      for (var i3 = k + 1; i3 < n; i3++) {
        var ri = A[i3], f = ri[k] / d;
        if (f === 0) continue;
        ri[k] = f;
        for (var j = k + 1; j < n; j++) ri[j] -= f * rk[j];
      }
    }
    return { LU: A, piv: piv, n: n };
  }
  function luSolve(F, b) {
    var n = F.n, LU = F.LU, x = new Float64Array(n);
    for (var i = 0; i < n; i++) x[i] = b[F.piv[i]];
    for (var i2 = 0; i2 < n; i2++) { var r = LU[i2], s = x[i2]; for (var j = 0; j < i2; j++) s -= r[j] * x[j]; x[i2] = s; }
    for (var i3 = n - 1; i3 >= 0; i3--) { var r3 = LU[i3], s3 = x[i3]; for (var j3 = i3 + 1; j3 < n; j3++) s3 -= r3[j3] * x[j3]; x[i3] = s3 / r3[i3]; }
    return x;
  }

  // LU complexo com pivotamento parcial (partes real/imag separadas)
  function cluFactor(Ar0, Ai0) {
    var n = Ar0.length, Ar = copyMat(Ar0), Ai = copyMat(Ai0), piv = new Int32Array(n);
    for (var i = 0; i < n; i++) piv[i] = i;
    for (var k = 0; k < n; k++) {
      var p = k, max = Ar[k][k] * Ar[k][k] + Ai[k][k] * Ai[k][k];
      for (var i2 = k + 1; i2 < n; i2++) {
        var v = Ar[i2][k] * Ar[i2][k] + Ai[i2][k] * Ai[i2][k];
        if (v > max) { max = v; p = i2; }
      }
      if (max === 0) { Ar[k][k] = 1e-300; max = 1e-600; }
      if (p !== k) {
        var t = Ar[p]; Ar[p] = Ar[k]; Ar[k] = t; t = Ai[p]; Ai[p] = Ai[k]; Ai[k] = t;
        var tp = piv[p]; piv[p] = piv[k]; piv[k] = tp;
      }
      var dr = Ar[k][k], di = Ai[k][k], den = dr * dr + di * di;
      var ir = dr / den, ii = -di / den;                 // 1/d
      var rkr = Ar[k], rki = Ai[k];
      for (var i3 = k + 1; i3 < n; i3++) {
        var rr = Ar[i3], ri = Ai[i3];
        var ar = rr[k], ai = ri[k];
        if (ar === 0 && ai === 0) continue;
        var fr = ar * ir - ai * ii, fi = ar * ii + ai * ir;
        rr[k] = fr; ri[k] = fi;
        for (var j = k + 1; j < n; j++) {
          var br = rkr[j], bi = rki[j];
          rr[j] -= fr * br - fi * bi;
          ri[j] -= fr * bi + fi * br;
        }
      }
    }
    return { Ar: Ar, Ai: Ai, piv: piv, n: n };
  }
  function cluSolve(F, br, bi) {
    var n = F.n, Ar = F.Ar, Ai = F.Ai, xr = new Float64Array(n), xi = new Float64Array(n);
    for (var i = 0; i < n; i++) { xr[i] = br[F.piv[i]]; xi[i] = bi ? bi[F.piv[i]] : 0; }
    for (var i2 = 0; i2 < n; i2++) {
      var sr = xr[i2], si = xi[i2], lr = Ar[i2], li = Ai[i2];
      for (var j = 0; j < i2; j++) { sr -= lr[j] * xr[j] - li[j] * xi[j]; si -= lr[j] * xi[j] + li[j] * xr[j]; }
      xr[i2] = sr; xi[i2] = si;
    }
    for (var i3 = n - 1; i3 >= 0; i3--) {
      var ur = Ar[i3], ui = Ai[i3], s3r = xr[i3], s3i = xi[i3];
      for (var j3 = i3 + 1; j3 < n; j3++) { s3r -= ur[j3] * xr[j3] - ui[j3] * xi[j3]; s3i -= ur[j3] * xi[j3] + ui[j3] * xr[j3]; }
      var dr = ur[i3], di = ui[i3], den = dr * dr + di * di;
      xr[i3] = (s3r * dr + s3i * di) / den; xi[i3] = (s3i * dr - s3r * di) / den;
    }
    return { re: xr, im: xi };
  }

  // Balanceamento (escalas em potências de 2) — melhora a precisão dos autovalores
  function balance(A) {
    var n = A.length, RADIX = 2, sqrdx = 4, done = false;
    while (!done) {
      done = true;
      for (var i = 0; i < n; i++) {
        var r = 0, c = 0;
        for (var j = 0; j < n; j++) if (j !== i) { c += Math.abs(A[j][i]); r += Math.abs(A[i][j]); }
        if (c !== 0 && r !== 0) {
          var g = r / RADIX, f = 1, s = c + r;
          while (c < g) { f *= RADIX; c *= sqrdx; }
          g = r * RADIX;
          while (c > g) { f /= RADIX; c /= sqrdx; }
          if ((c + r) / f < 0.95 * s) {
            done = false;
            g = 1 / f;
            for (var j2 = 0; j2 < n; j2++) A[i][j2] *= g;
            for (var j3 = 0; j3 < n; j3++) A[j3][i] *= f;
          }
        }
      }
    }
    return A;
  }

  // Redução a Hessenberg (Householder) — JAMA/EISPACK "orthes"
  function hessenberg(H) {
    var n = H.length, low = 0, high = n - 1, ort = new Float64Array(n);
    for (var m = low + 1; m <= high - 1; m++) {
      var scale = 0;
      for (var i = m; i <= high; i++) scale += Math.abs(H[i][m - 1]);
      if (scale === 0) continue;
      var h = 0;
      for (var i2 = high; i2 >= m; i2--) { ort[i2] = H[i2][m - 1] / scale; h += ort[i2] * ort[i2]; }
      var g = Math.sqrt(h);
      if (ort[m] > 0) g = -g;
      h -= ort[m] * g;
      ort[m] -= g;
      for (var j = m; j < n; j++) {
        var f = 0;
        for (var i3 = high; i3 >= m; i3--) f += ort[i3] * H[i3][j];
        f /= h;
        for (var i4 = m; i4 <= high; i4++) H[i4][j] -= f * ort[i4];
      }
      for (var i5 = 0; i5 <= high; i5++) {
        var f2 = 0;
        for (var j2 = high; j2 >= m; j2--) f2 += ort[j2] * H[i5][j2];
        f2 /= h;
        for (var j3 = m; j3 <= high; j3++) H[i5][j3] -= f2 * ort[j3];
      }
      ort[m] *= scale;
      H[m][m - 1] = scale * g;
    }
    return H;
  }

  // QR de Francis com duplo deslocamento — só autovalores (JAMA "hqr2" sem vetores)
  function hqr(H) {
    var nn = H.length, n = nn - 1, low = 0;
    var d = new Float64Array(nn), e = new Float64Array(nn);
    var eps = Math.pow(2, -52), exshift = 0, p = 0, q = 0, r = 0, s = 0, z = 0, t, w, x, y;
    var norm = 0;
    for (var i = 0; i < nn; i++) for (var j = Math.max(i - 1, 0); j < nn; j++) norm += Math.abs(H[i][j]);
    var iter = 0;
    while (n >= low) {
      var l = n;
      while (l > low) {
        s = Math.abs(H[l - 1][l - 1]) + Math.abs(H[l][l]);
        if (s === 0) s = norm;
        if (Math.abs(H[l][l - 1]) < eps * s) break;
        l--;
      }
      if (l === n) {
        d[n] = H[n][n] + exshift; e[n] = 0; n--; iter = 0;
      } else if (l === n - 1) {
        w = H[n][n - 1] * H[n - 1][n];
        p = (H[n - 1][n - 1] - H[n][n]) / 2;
        q = p * p + w;
        z = Math.sqrt(Math.abs(q));
        H[n][n] += exshift;
        H[n - 1][n - 1] += exshift;
        x = H[n][n];
        if (q >= 0) {
          z = p >= 0 ? p + z : p - z;
          d[n - 1] = x + z;
          d[n] = z !== 0 ? x - w / z : d[n - 1];
          e[n - 1] = 0; e[n] = 0;
          x = H[n][n - 1];
          s = Math.abs(x) + Math.abs(z);
          p = x / s; q = z / s;
          r = Math.sqrt(p * p + q * q);
          p /= r; q /= r;
          for (var j2 = n - 1; j2 < nn; j2++) { z = H[n - 1][j2]; H[n - 1][j2] = q * z + p * H[n][j2]; H[n][j2] = q * H[n][j2] - p * z; }
          for (var i2 = 0; i2 <= n; i2++) { z = H[i2][n - 1]; H[i2][n - 1] = q * z + p * H[i2][n]; H[i2][n] = q * H[i2][n] - p * z; }
        } else {
          d[n - 1] = x + p; d[n] = x + p; e[n - 1] = z; e[n] = -z;
        }
        n -= 2; iter = 0;
      } else {
        x = H[n][n]; y = 0; w = 0;
        if (l < n) { y = H[n - 1][n - 1]; w = H[n][n - 1] * H[n - 1][n]; }
        if (iter === 10) {
          exshift += x;
          for (var i3 = low; i3 <= n; i3++) H[i3][i3] -= x;
          s = Math.abs(H[n][n - 1]) + Math.abs(H[n - 1][n - 2]);
          x = y = 0.75 * s;
          w = -0.4375 * s * s;
        }
        if (iter === 30) {
          s = (y - x) / 2;
          s = s * s + w;
          if (s > 0) {
            s = Math.sqrt(s);
            if (y < x) s = -s;
            s = x - w / ((y - x) / 2 + s);
            for (var i4 = low; i4 <= n; i4++) H[i4][i4] -= s;
            exshift += s;
            x = y = w = 0.964;
          }
        }
        iter++;
        if (iter > 400) throw new Error('QR não convergiu');
        var m = n - 2;
        while (m >= l) {
          z = H[m][m];
          r = x - z; s = y - z;
          p = (r * s - w) / H[m + 1][m] + H[m][m + 1];
          q = H[m + 1][m + 1] - z - r - s;
          r = H[m + 2][m + 1];
          s = Math.abs(p) + Math.abs(q) + Math.abs(r);
          p /= s; q /= s; r /= s;
          if (m === l) break;
          if (Math.abs(H[m][m - 1]) * (Math.abs(q) + Math.abs(r)) <
              eps * (Math.abs(p) * (Math.abs(H[m - 1][m - 1]) + Math.abs(z) + Math.abs(H[m + 1][m + 1])))) break;
          m--;
        }
        for (var i5 = m + 2; i5 <= n; i5++) { H[i5][i5 - 2] = 0; if (i5 > m + 2) H[i5][i5 - 3] = 0; }
        for (var k = m; k <= n - 1; k++) {
          var notlast = (k !== n - 1);
          if (k !== m) {
            p = H[k][k - 1]; q = H[k + 1][k - 1]; r = notlast ? H[k + 2][k - 1] : 0;
            x = Math.abs(p) + Math.abs(q) + Math.abs(r);
            if (x === 0) continue;
            p /= x; q /= x; r /= x;
          }
          s = Math.sqrt(p * p + q * q + r * r);
          if (p < 0) s = -s;
          if (s !== 0) {
            if (k !== m) H[k][k - 1] = -s * x;
            else if (l !== m) H[k][k - 1] = -H[k][k - 1];
            p += s; x = p / s; y = q / s; z = r / s; q /= p; r /= p;
            for (var j3 = k; j3 < nn; j3++) {
              p = H[k][j3] + q * H[k + 1][j3];
              if (notlast) { p += r * H[k + 2][j3]; H[k + 2][j3] -= p * z; }
              H[k][j3] -= p * x;
              H[k + 1][j3] -= p * y;
            }
            var imax = Math.min(n, k + 3);
            for (var i6 = 0; i6 <= imax; i6++) {
              p = x * H[i6][k] + y * H[i6][k + 1];
              if (notlast) { p += z * H[i6][k + 2]; H[i6][k + 2] -= p * r; }
              H[i6][k] -= p;
              H[i6][k + 1] -= p * q;
            }
          }
        }
      }
    }
    return { re: d, im: e };
  }

  function eigvals(A) { return hqr(hessenberg(balance(copyMat(A)))); }

  // ======================================================================= //
  // Elementos
  // ======================================================================= //
  function shearCoefficient(od, id, nu) {
    var r = id / od, a = Math.pow(1 + r * r, 2);
    return 6 * (1 + nu) * a / ((7 + 6 * nu) * a + (20 + 12 * nu) * r * r);
  }

  // Viga de Timoshenko (Nelson 1980 / Friswell et al. 2010); SI; dofs por plano [u1,s1,u2,s2]
  function shaftElementMatrices(el) {
    var mat = el.mat, E = mat.E, G = E / (2 * (1 + mat.nu)), rho = mat.rho, L = el.L;
    var A = Math.PI / 4 * (el.od * el.od - el.id * el.id);
    var I = Math.PI / 64 * (Math.pow(el.od, 4) - Math.pow(el.id, 4));
    var Am = Math.PI / 4 * (el.odm * el.odm - el.idm * el.idm);
    var Im = Math.PI / 64 * (Math.pow(el.odm, 4) - Math.pow(el.idm, 4));
    var phi = 12 * E * I / (shearCoefficient(el.od, el.id, mat.nu) * G * A * L * L);
    var k = E * I / (L * L * L * (1 + phi)), L2 = L * L;
    var K = [[12 * k, 6 * L * k, -12 * k, 6 * L * k],
             [6 * L * k, (4 + phi) * L2 * k, -6 * L * k, (2 - phi) * L2 * k],
             [-12 * k, -6 * L * k, 12 * k, -6 * L * k],
             [6 * L * k, (2 - phi) * L2 * k, -6 * L * k, (4 + phi) * L2 * k]];
    var p2 = phi * phi;
    var m1 = 312 + 588 * phi + 280 * p2, m2 = (44 + 77 * phi + 35 * p2) * L, m3 = 108 + 252 * phi + 140 * p2;
    var m4 = -(26 + 63 * phi + 35 * p2) * L, m5 = (8 + 14 * phi + 7 * p2) * L2, m6 = -(6 + 14 * phi + 7 * p2) * L2;
    var ct = rho * Am * L / (840 * Math.pow(1 + phi, 2));
    var MT = [[m1, m2, m3, m4], [m2, m5, -m4, m6], [m3, -m4, m1, -m2], [m4, m6, -m2, m5]];
    var r1 = 36, r2 = (3 - 15 * phi) * L, r3 = (4 + 5 * phi + 10 * p2) * L2, r4 = (-1 - 5 * phi + 5 * p2) * L2;
    var base = [[r1, r2, -r1, r2], [r2, r3, -r2, r4], [-r1, -r2, r1, -r2], [r2, r4, -r2, r3]];
    var cr = rho * Im / (30 * L * Math.pow(1 + phi, 2));
    var M = mat4(), Gs = mat4();
    for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) {
      M[i][j] = ct * MT[i][j] + cr * base[i][j];
      Gs[i][j] = 2 * cr * base[i][j];
    }
    return { K: K, M: M, G: Gs, mass: rho * Am * L };
    function mat4() { return [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]; }
  }

  function diskFromGeometry(width, od, id, material) {
    var m0 = MATERIALS[material || 'Aço'], R = od / 2, r = id / 2;
    var m = m0.rho * Math.PI * (R * R - r * r) * width;
    return { m: m, Ip: 0.5 * m * (R * R + r * r), Id: m * (3 * (R * R + r * r) + width * width) / 12 };
  }
  function bladeRow(nBlades, bladeMass, rRoot, rTip, hub) {
    var m = nBlades * bladeMass;
    var r2 = (Math.pow(rTip, 3) - Math.pow(rRoot, 3)) / (3 * (rTip - rRoot));
    var Ip = m * r2, Id = Ip / 2;
    if (hub) { m += hub.m; Ip += hub.Ip; Id += hub.Id; }
    return { m: m, Ip: Ip, Id: Id };
  }

  // ======================================================================= //
  // Modelo (montagem)
  // ======================================================================= //
  function num(v, d) { var x = (v === null || v === undefined || v === '') ? NaN : Number(v); return isFinite(x) ? x : d; }

  function nodePositionsMm(p) {
    var z = [0];
    (p.shaft || []).forEach(function (r) { z.push(z[z.length - 1] + num(r.L, 0)); });
    return z;
  }

  function validate(p) {
    var err = [], nn = (p.shaft || []).length + 1;
    if (!p.shaft || !p.shaft.length) err.push('Tabela do eixo vazia.');
    (p.shaft || []).forEach(function (r, i) {
      if (!(num(r.L, 0) > 0) || !(num(r.od, 0) > 0)) err.push('Elemento ' + (i + 1) + ': L e OD devem ser positivos.');
      if (num(r.id, 0) >= num(r.od, 0)) err.push('Elemento ' + (i + 1) + ': ID deve ser menor que OD.');
      if (!MATERIALS[r.material]) err.push('Elemento ' + (i + 1) + ': material desconhecido.');
    });
    [['Massa', p.disks || []], ['Mancal', p.bearings || []]].forEach(function (t) {
      t[1].forEach(function (r) {
        var n = num(r.node, 0);
        if (!(n >= 1 && n <= nn && Math.round(n) === n)) err.push(t[0] + " '" + r.name + "': nó " + r.node + ' não existe (1–' + nn + ').');
      });
    });
    (p.disks || []).forEach(function (r) { if (!(num(r.m, -1) >= 0)) err.push("Massa '" + r.name + "': massa inválida."); });
    (p.bearings || []).forEach(function (r) {
      if (isFluid(r)) {
        if (!(num(r.D, 0) > 0 && num(r.Lb, 0) > 0 && num(r.Cr, 0) > 0)) err.push("Mancal '" + r.name + "': D, L e folga devem ser positivos.");
        if (hasPreload(r) && !(num(r.preload, 0) >= 0 && num(r.preload, 0) < 0.9)) err.push("Mancal '" + r.name + "': pré-carga fora de 0–0,9.");
        var eb = num(r.e_bore, NaN);
        if (hasPreload(r) && isFinite(eb) && !(eb >= 0)) err.push("Mancal '" + r.name + "': excentricidade do furo negativa.");
        if (hasPreload(r) && isFinite(eb) && !(eb / (num(r.Cr, 1) + eb) < 0.9)) err.push("Mancal '" + r.name + "': excentricidade do furo leva a pré-carga ≥ 0,9.");
        if (r.thermal === 'Calculada') {
          if (!(num(r.T_in, NaN) > -20 && num(r.T_in, NaN) < 120)) err.push("Mancal '" + r.name + "': T de entrada do óleo fora de −20…120 °C.");
        } else {
          var th = bearingThermal(p, r);
          if (num(r.D, 0) > 0 && !(th.hot > 0)) err.push("Mancal '" + r.name + "': folga a quente ≤ 0 (" + th.hot.toFixed(1) + ' µm) — confira temperaturas e α.');
          if (!(th.Tef > -20 && th.Tef < 160)) err.push("Mancal '" + r.name + "': temperatura efetiva fora de −20…160 °C.");
        }
      }
    });
    if (!p.bearings || !p.bearings.length) err.push('Nenhum mancal definido.');
    return err;
  }

  function elementsSI(p) {
    return p.shaft.map(function (r) {
      var mm = 1e-3, od = num(r.od, 0) * mm, id = num(r.id, 0) * mm;
      return {
        L: num(r.L, 0) * mm, od: od, id: id, mat: MATERIALS[r.material] || MATERIALS['Aço'],
        odm: (r.od_mass === null || r.od_mass === '' || r.od_mass === undefined) ? od : num(r.od_mass, 0) * mm,
        idm: (r.id_mass === null || r.id_mass === '' || r.id_mass === undefined) ? id : num(r.id_mass, 0) * mm
      };
    });
  }

  // Monta M, K do eixo e G. bearings: lista já convertida (ver makeBearing)
  function assemble(els, disks, bearings, name) {
    var nn = els.length + 1, n = 4 * nn;
    var M = mat(n), K = mat(n), G = mat(n), pos = [0], mass = 0, mz = 0;
    els.forEach(function (e, i) {
      var r = shaftElementMatrices(e), d0 = 4 * i;
      var px = [d0, d0 + 2, d0 + 4, d0 + 6], py = [d0 + 1, d0 + 3, d0 + 5, d0 + 7];
      for (var a = 0; a < 4; a++) for (var b = 0; b < 4; b++) {
        K[px[a]][px[b]] += r.K[a][b]; K[py[a]][py[b]] += r.K[a][b];
        M[px[a]][px[b]] += r.M[a][b]; M[py[a]][py[b]] += r.M[a][b];
        G[px[a]][py[b]] += r.G[a][b]; G[py[a]][px[b]] -= r.G[a][b];
      }
      pos.push(pos[i] + e.L);
      mass += r.mass; mz += r.mass * (pos[i] + e.L / 2);
    });
    disks.forEach(function (d) {
      var b = 4 * d.node;
      M[b][b] += d.m; M[b + 1][b + 1] += d.m; M[b + 2][b + 2] += d.Id; M[b + 3][b + 3] += d.Id;
      G[b + 2][b + 3] += d.Ip; G[b + 3][b + 2] -= d.Ip;
      mass += d.m; mz += d.m * pos[d.node];
    });
    return { name: name || 'Rotor', nNodes: nn, ndof: n, M: M, Kshaft: K, G: G, nodesPos: pos,
             elements: els, disks: disks, bearings: bearings, mass: mass, cg: mz / mass,
             Mlu: luFactor(M) };
  }

  // Mancal linear. Coeficientes: número ou vetor (com speeds [rad/s], interpolação linear, extremos mantidos)
  function makeBearing(node, c, speeds, name, isSupport) {
    var b = { node: node, name: name || '', speeds: speeds ? Float64Array.from(speeds) : null,
              isSupport: isSupport !== false };
    ['kxx', 'kxy', 'kyx', 'kyy', 'cxx', 'cxy', 'cyx', 'cyy'].forEach(function (k) {
      var v = c[k];
      if (v === undefined || v === null) v = (k === 'kyy') ? c.kxx : (k === 'cyy') ? (c.cxx || 0) : 0;
      b[k] = (typeof v === 'number') ? v : Float64Array.from(v);
    });
    return b;
  }
  function interp1(x, xs, ys) {
    var n = xs.length;
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    var lo = 0, hi = n - 1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid; }
    var t = (x - xs[lo]) / (xs[hi] - xs[lo]);
    return ys[lo] + t * (ys[hi] - ys[lo]);
  }
  function bearingValue(b, key, speed) {
    var v = b[key];
    return (typeof v === 'number') ? v : interp1(speed, b.speeds, v);
  }
  function bearingKC(b, speed) {
    var g = function (k) { return bearingValue(b, k, speed); };
    return { K: [[g('kxx'), g('kxy')], [g('kyx'), g('kyy')]], C: [[g('cxx'), g('cxy')], [g('cyx'), g('cyy')]] };
  }
  function crossCoupling(node, Q) {
    return makeBearing(node, { kxx: 0, kyy: 0, kxy: Q, kyx: -Q, cxx: 0, cyy: 0 }, null, 'Q', false);
  }
  function withExtra(model, extra) {
    var m = Object.assign({}, model);
    m.bearings = model.bearings.concat(extra);
    return m;
  }

  function matricesAt(model, speed) {
    var n = model.ndof, K = copyMat(model.Kshaft), C = mat(n);
    model.bearings.forEach(function (b) {
      var kc = bearingKC(b, speed), i0 = 4 * b.node;
      for (var a = 0; a < 2; a++) for (var c = 0; c < 2; c++) {
        K[i0 + a][i0 + c] += kc.K[a][c];
        C[i0 + a][i0 + c] += kc.C[a][c];
      }
    });
    return { K: K, C: C };
  }

  // Reações estáticas ao peso próprio (apoios rígidos) — N, na ordem de `nodes`
  function staticReactions(els, disks, nodes) {
    var model = assemble(els, disks, [], '');
    var n = model.ndof, K = copyMat(model.Kshaft), big = 0;
    for (var i = 0; i < n; i++) big = Math.max(big, Math.abs(K[i][i]));
    big *= 1e6;
    nodes.forEach(function (nd) { K[4 * nd][4 * nd] += big; K[4 * nd + 1][4 * nd + 1] += big; });
    var e = new Float64Array(n), F = new Float64Array(n);
    for (var j = 1; j < n; j += 4) e[j] = 1;
    for (var r = 0; r < n; r++) { var s = 0, Mr = model.M[r]; for (var c = 0; c < n; c++) s += Mr[c] * e[c]; F[r] = -G_ACCEL * s; }
    var q = luSolve(luFactor(K), F);
    // mancais no mesmo nó dividem a reação igualmente
    var count = {};
    nodes.forEach(function (nd) { count[nd] = (count[nd] || 0) + 1; });
    return nodes.map(function (nd) { return -big * q[4 * nd + 1] / count[nd]; });
  }

  // ======================================================================= //
  // Análise modal amortecida
  // ======================================================================= //
  function modal(model, speed, nModes, minFreq) {
    nModes = nModes || 8; minFreq = minFreq || 1e-2;
    var n = model.ndof, mc = matricesAt(model, speed), K = mc.K, D = mc.C;
    for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) D[i][j] += speed * model.G[i][j];
    // A = [[0, I], [-M⁻¹K, -M⁻¹D]]
    var A = mat(2 * n), colK = new Float64Array(n), colD = new Float64Array(n);
    for (var c = 0; c < n; c++) {
      for (var r = 0; r < n; r++) { colK[r] = K[r][c]; colD[r] = D[r][c]; }
      var xk = luSolve(model.Mlu, colK), xd = luSolve(model.Mlu, colD);
      for (var r2 = 0; r2 < n; r2++) { A[n + r2][c] = -xk[r2]; A[n + r2][n + c] = -xd[r2]; }
      A[c][n + c] = 1;
    }
    var ev = eigvals(A), idx = [];
    for (var k = 0; k < ev.re.length; k++) if (ev.im[k] > minFreq) idx.push(k);
    idx.sort(function (a, b) { return ev.im[a] - ev.im[b]; });
    idx = idx.slice(0, nModes);
    var out = { speed: speed, wd: [], wn: [], sigma: [], logdec: [], zeta: [], whirl: [], shapes: [] };
    idx.forEach(function (k) {
      var sr = ev.re[k], wi = ev.im[k];
      var v = eigenvector(model.M, D, K, sr, wi);
      out.wd.push(wi); out.sigma.push(sr); out.wn.push(Math.hypot(sr, wi));
      out.logdec.push(-TWO_PI * sr / wi); out.zeta.push(-sr / Math.hypot(sr, wi));
      out.whirl.push(v.whirl); out.shapes.push(v);
    });
    return out;
  }

  // Autovetor de (λ²M + λD + K)x = 0 por iteração inversa; normalizado e com precessão
  function eigenvector(M, D, K, sr, wi) {
    var n = M.length, l2r = sr * sr - wi * wi, l2i = 2 * sr * wi;
    var Qr = mat(n), Qi = mat(n);
    for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) {
      Qr[i][j] = l2r * M[i][j] + sr * D[i][j] + K[i][j];
      Qi[i][j] = l2i * M[i][j] + wi * D[i][j];
    }
    var F = cluFactor(Qr, Qi), br = new Float64Array(n), bi = new Float64Array(n);
    for (var i2 = 0; i2 < n; i2++) { br[i2] = 1 + 0.01 * Math.sin(i2 + 1); bi[i2] = 0; }
    var x;
    for (var it = 0; it < 2; it++) {
      x = cluSolve(F, br, bi);
      var nrm = 0;
      for (var i3 = 0; i3 < n; i3++) nrm = Math.max(nrm, Math.hypot(x.re[i3], x.im[i3]));
      for (var i4 = 0; i4 < n; i4++) { br[i4] = x.re[i4] / nrm; bi[i4] = x.im[i4] / nrm; }
    }
    // normaliza pela componente de translação dominante
    var nn = n / 4, best = 0, bestAmp = -1;
    for (var q = 0; q < nn; q++) {
      var a = Math.hypot(br[4 * q], bi[4 * q]) + Math.hypot(br[4 * q + 1], bi[4 * q + 1]);
      if (a > bestAmp) { bestAmp = a; best = q; }
    }
    var ix = Math.hypot(br[4 * best], bi[4 * best]) >= Math.hypot(br[4 * best + 1], bi[4 * best + 1]) ? 4 * best : 4 * best + 1;
    var rr = br[ix], ri = bi[ix], den = rr * rr + ri * ri;
    var Xr = [], Xi = [], Yr = [], Yi = [], hs = 0, tot = 0;
    for (var q2 = 0; q2 < nn; q2++) {
      var ax = br[4 * q2], bx = bi[4 * q2], ay = br[4 * q2 + 1], by = bi[4 * q2 + 1];
      var xr = (ax * rr + bx * ri) / den, xi = (bx * rr - ax * ri) / den;
      var yr = (ay * rr + by * ri) / den, yi = (by * rr - ay * ri) / den;
      Xr.push(xr); Xi.push(xi); Yr.push(yr); Yi.push(yi);
      hs += xr * yi - xi * yr;                     // Im(conj(X)·Y)
      tot += xr * xr + xi * xi + yr * yr + yi * yi;
    }
    var H = hs / tot;
    return { Xr: Xr, Xi: Xi, Yr: Yr, Yi: Yi, whirl: H < -1e-3 ? 'F' : (H > 1e-3 ? 'B' : 'M') };
  }

  function filterModes(m, maxZeta) {
    var keep = [];
    m.zeta.forEach(function (z, i) { if (z <= maxZeta) keep.push(i); });
    var o = { speed: m.speed };
    ['wd', 'wn', 'sigma', 'logdec', 'zeta', 'whirl', 'shapes'].forEach(function (k) { o[k] = keep.map(function (i) { return m[k][i]; }); });
    return o;
  }

  function campbellPoint(model, speed, nModes) { return modal(model, speed, nModes); }

  // Interseções ωd(Ω) = h·Ω nos ramos forward (ζ ≤ maxZeta). camp = {speeds, pts:[modal]}
  function criticalSpeeds(camp, harmonic, maxZeta) {
    harmonic = harmonic || 1; maxZeta = maxZeta === undefined ? 0.5 : maxZeta;
    var out = [], S = camp.speeds, P = camp.pts, nm = 0;
    P.forEach(function (p) { nm = Math.max(nm, p.wd.length); });
    for (var j = 0; j < nm; j++) {
      for (var i = 0; i < S.length - 1; i++) {
        var a = P[i], b = P[i + 1];
        if (j >= a.wd.length || j >= b.wd.length) continue;
        var f0 = a.wd[j] - harmonic * S[i], f1 = b.wd[j] - harmonic * S[i + 1];
        if (!(f0 === 0 || f0 * f1 < 0)) continue;
        if (a.whirl[j] !== 'F' || b.whirl[j] !== 'F') continue;
        if (Math.max(a.zeta[j], b.zeta[j]) > maxZeta) continue;
        var t = f0 / (f0 - f1);
        out.push({ mode: j + 1, speed: S[i] + t * (S[i + 1] - S[i]),
                   logdec: a.logdec[j] + t * (b.logdec[j] - a.logdec[j]), whirl: 'F' });
      }
    }
    return out.sort(function (x, y) { return x.speed - y.speed; });
  }

  // ======================================================================= //
  // Resposta ao desbalanceamento
  // ======================================================================= //
  // unbalances: [{node (0-based), U (kg·m), phaseDeg}]; retorna X, Y [velocidade][nó] = {re, im} (m)
  function unbalanceAt(model, w, unbalances) {
    var n = model.ndof, mc = matricesAt(model, w), K = mc.K, C = mc.C;
    var Zr = mat(n), Zi = mat(n);
    for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) {
      Zr[i][j] = K[i][j] - w * w * model.M[i][j];
      Zi[i][j] = w * (C[i][j] + w * model.G[i][j]);
    }
    var Fr = new Float64Array(n), Fi = new Float64Array(n);
    unbalances.forEach(function (u) {
      var f = u.U * w * w, ph = u.phaseDeg * DEG, cr = f * Math.cos(ph), ci = f * Math.sin(ph);
      Fr[4 * u.node] += cr; Fi[4 * u.node] += ci;          // Fx = U Ω² e^{jφ}
      Fr[4 * u.node + 1] += ci; Fi[4 * u.node + 1] -= cr;  // Fy = −j U Ω² e^{jφ}
    });
    var q = cluSolve(cluFactor(Zr, Zi), Fr, Fi), nn = model.nNodes;
    var X = [], Y = [];
    for (var k = 0; k < nn; k++) {
      X.push({ re: q.re[4 * k], im: q.im[4 * k] });
      Y.push({ re: q.re[4 * k + 1], im: q.im[4 * k + 1] });
    }
    return { X: X, Y: Y };
  }
  function majorAxis(X, Y) {       // semi-eixo maior da órbita
    var ax2 = X.re * X.re + X.im * X.im, ay2 = Y.re * Y.re + Y.im * Y.im;
    var s = (ax2 + ay2) / 2, rxy = X.re * Y.re + X.im * Y.im;
    return Math.sqrt(s + Math.sqrt(Math.pow((ax2 - ay2) / 2, 2) + rxy * rxy));
  }
  function phaseDeg(z) { return Math.atan2(z.im, z.re) / DEG; }

  // ======================================================================= //
  // Estabilidade (rigidez cruzada aplicada)
  // ======================================================================= //
  function stabilityPoint(model, speed, node, Q, nModes) {
    var m = filterModes(modal(withExtra(model, [crossCoupling(node, Q)]), speed, nModes || 12), 0.5);
    var fwd = null, min = Infinity;
    m.logdec.forEach(function (d, i) { if (fwd === null && m.whirl[i] === 'F') fwd = d; min = Math.min(min, d); });
    return { Q: Q, firstForward: fwd === null ? NaN : fwd, minimum: min };
  }

  // ======================================================================= //
  // Normas
  // ======================================================================= //
  var standards = {
    ISO_G_GRADES: ISO_G_GRADES,
    // U_per [g·mm] = 1000·G·m/Ω ; e_per [µm] = 1000·G/Ω
    isoPermissible: function (G, mass, rpm) {
      var w = rpm * RPM;
      return { G: G, U_per_gmm: 1000 * G * mass / w, e_per_um: 1000 * G / w, omega: w };
    },
    // Regra proporcional com CG entre os planos; cada plano limitado a [0,3; 0,7]·U_per
    isoTwoPlane: function (U, zA, zB, zcg, clamp) {
      if (!(Math.min(zA, zB) < zcg && zcg < Math.max(zA, zB))) throw new Error('CG fora dos planos de correção: use as regras específicas da ISO 21940-11');
      var L = Math.abs(zB - zA), LA = Math.abs(zcg - zA), LB = Math.abs(zB - zcg);
      var UA = U * LB / L, UB = U * LA / L;
      if (clamp !== false) { UA = Math.min(Math.max(UA, 0.3 * U), 0.7 * U); UB = Math.min(Math.max(UB, 0.3 * U), 0.7 * U); }
      return { A: UA, B: UB };
    },
    // API 617: Ur = 6350·W/N [g·mm] (N < 25 000 rpm); Ua = 2·Ur
    api617Residual: function (Wkg, N) { return 6350 * Wkg / N; },
    api617Analysis: function (Wkg, N) { return 2 * 6350 * Wkg / N; },
    // Fator de amplificação por meia potência
    amplificationFactor: function (speeds, amp, window) {
      var idx = [];
      for (var i = 0; i < speeds.length; i++) if (!window || (speeds[i] >= window[0] && speeds[i] <= window[1])) idx.push(i);
      var ip = idx[0];
      idx.forEach(function (i2) { if (amp[i2] > amp[ip]) ip = i2; });
      var peak = amp[ip], hp = peak / Math.SQRT2, j = ip, k = ip, N1 = NaN, N2 = NaN;
      while (j > 0 && amp[j] >= hp) j--;
      if (amp[j] < hp) N1 = speeds[j] + (hp - amp[j]) * (speeds[j + 1] - speeds[j]) / (amp[j + 1] - amp[j]);
      while (k < amp.length - 1 && amp[k] >= hp) k++;
      if (amp[k] < hp) N2 = speeds[k] + (hp - amp[k]) * (speeds[k - 1] - speeds[k]) / (amp[k - 1] - amp[k]);
      var AF = (isFinite(N1) && isFinite(N2)) ? speeds[ip] / (N2 - N1) : NaN;
      return { Nc: speeds[ip], peak: peak, N1: N1, N2: N2, AF: AF };
    },
    // SM requerida [%]: abaixo min(16, 17(1−1/(AF−1,5))), acima min(26, 10+17(1−1/(AF−1,5)))
    api617RequiredMargin: function (AF) {
      if (!isFinite(AF) || AF < 2.5) return { below: 0, above: 0, required: false };
      var b = 17 * (1 - 1 / (AF - 1.5));
      return { below: Math.min(16, b), above: Math.min(26, 10 + b), required: true };
    },
    separationMarginCheck: function (Nc, AF, Nmin, Nmc) {
      if (!isFinite(AF)) return { ok: null, actual: null, required: null, note: 'AF indeterminado (pico não cruza 0,707 nos dois lados)' };
      var req = standards.api617RequiredMargin(AF);
      if (!req.required) return { ok: true, actual: null, required: 0, note: 'AF < 2,5: resposta criticamente amortecida' };
      if (Nc < Nmin) { var a = 100 * (Nmin - Nc) / Nmin; return { ok: a >= req.below, actual: a, required: req.below, note: '' }; }
      if (Nc > Nmc) { var a2 = 100 * (Nc - Nmc) / Nmc; return { ok: a2 >= req.above, actual: a2, required: req.above, note: '' }; }
      return { ok: false, actual: 0, required: null, note: 'crítica dentro da faixa de operação' };
    },
    logdecOk: function (d, lim) { return d >= (lim === undefined ? 0.1 : lim); }
  };

  // ======================================================================= //
  // Mancais hidrodinâmicos — equação de Reynolds
  //   ∂/∂θ(H³∂P/∂θ) + ∂/∂ẑ(H³∂P/∂ẑ) = ∂H/∂θ + 2∂H/∂τ ,  h = C·H, p = 6μω(R/C)²P, ẑ = z/R
  // Diferenças finitas, meia largura (simetria), cavitação por complementaridade
  // linear (P ≥ 0, λ = A·P − b ≥ 0, P·λ = 0) resolvida pelo método primal-dual de
  // conjunto ativo. Matriz em banda (M-matriz, sem pivotamento); no mancal 360°
  // periódico os nós em θ são "dobrados" (0, n−1, 1, n−2, …) para manter a banda.
  // ======================================================================= //
  function bandSolve(Ab, b, N, bw) {
    var W = 2 * bw + 1, x = new Float64Array(N);
    for (var k = 0; k < N; k++) {
      var kb = k * W, piv = Ab[kb + bw], iend = Math.min(N - 1, k + bw), jend = Math.min(N - 1, k + bw);
      for (var i = k + 1; i <= iend; i++) {
        var ib = i * W, l = Ab[ib + k - i + bw];
        if (l === 0) continue;
        l /= piv;
        for (var j = k; j <= jend; j++) Ab[ib + j - i + bw] -= l * Ab[kb + j - k + bw];
        b[i] -= l * b[k];
      }
    }
    for (var k2 = N - 1; k2 >= 0; k2--) {
      var kb2 = k2 * W, s = b[k2], je = Math.min(N - 1, k2 + bw);
      for (var j2 = k2 + 1; j2 <= je; j2++) s -= Ab[kb2 + j2 - k2 + bw] * x[j2];
      x[k2] = s / Ab[kb2 + bw];
    }
    return x;
  }

  function ReynoldsPad(pad, LD, periodic, nt, nz) {
    this.pad = pad; this.periodic = periodic; this.nt = nt; this.nz = nz;
    if (periodic) { this.dth = TWO_PI / nt; }
    else { this.dth = pad.arc / (nt + 1); }
    this.th = new Float64Array(nt);
    for (var i = 0; i < nt; i++) this.th[i] = pad.start + this.dth * (periodic ? i : i + 1);
    this.dz = LD / nz;
    this.wz = new Float64Array(nz); for (var j = 0; j < nz; j++) this.wz[j] = this.dz; this.wz[0] = this.dz / 2;
    this.cos = this.th.map(Math.cos); this.sin = this.th.map(Math.sin);
    var piv = pad.start + pad.offset * pad.arc; this.piv = piv;
    this.sp = this.th.map(function (t) { return Math.sin(t - piv); });
    this.a = 1 / (1 - pad.preload); this.b = this.a - 1;
    this.pos = new Int32Array(nt);
    var half = Math.ceil(nt / 2);
    for (var i2 = 0; i2 < nt; i2++) this.pos[i2] = periodic ? (i2 < half ? 2 * i2 : 2 * (nt - 1 - i2) + 1) : i2;
    this.bw = periodic ? 2 * nz : nz;
    this.N = nt * nz;
    this.lastCav = null;
  }
  ReynoldsPad.prototype.film = function (t, X, Y, D) {
    return this.a - this.b * Math.cos(t - this.piv) - X * Math.cos(t) - Y * Math.sin(t) - D * Math.sin(t - this.piv);
  };
  ReynoldsPad.prototype.solve = function (X, Y, D, VX, VY, VD, cavitation) {
    D = D || 0; VX = VX || 0; VY = VY || 0; VD = VD || 0;
    var nt = this.nt, nz = this.nz, dth = this.dth, dz = this.dz, N = this.N, bw = this.bw, W = 2 * bw + 1;
    var aE = new Float64Array(nt), aW = new Float64Array(nt), aZ = new Float64Array(nt), rhs = new Float64Array(nt);
    var Hmin = Infinity;
    for (var i = 0; i < nt; i++) {
      var t = this.th[i], H = this.film(t, X, Y, D), He = this.film(t + dth / 2, X, Y, D), Hw = this.film(t - dth / 2, X, Y, D);
      Hmin = Math.min(Hmin, H, He, Hw);
      aE[i] = He * He * He / (dth * dth); aW[i] = Hw * Hw * Hw / (dth * dth); aZ[i] = H * H * H / (dz * dz);
      var dH = this.b * Math.sin(t - this.piv) + X * this.sin[i] - Y * this.cos[i] - D * Math.cos(t - this.piv);
      rhs[i] = dH + 2 * (VX * (-this.cos[i]) + VY * (-this.sin[i]) + VD * (-this.sp[i]));
    }
    if (!(Hmin > 1e-4)) throw new Error('filme de óleo fechado (H ≤ 0)');
    var A = new Float64Array(N * W), b = new Float64Array(N), pos = this.pos;
    for (var i2 = 0; i2 < nt; i2++) {
      var pe = i2 + 1, pw = i2 - 1;
      if (this.periodic) { pe = pe % nt; pw = (pw + nt) % nt; }
      for (var j = 0; j < nz; j++) {
        var k = pos[i2] * nz + j, kb = k * W + bw;
        A[kb] += aE[i2] + aW[i2] + 2 * aZ[i2];
        if (pe < nt) A[kb + (pos[pe] * nz + j) - k] -= aE[i2];
        if (pw >= 0) A[kb + (pos[pw] * nz + j) - k] -= aW[i2];
        if (j + 1 < nz) A[kb + 1] -= aZ[i2] * (j === 0 ? 2 : 1);
        if (j > 0) A[kb - 1] -= aZ[i2];
        b[k] = -rhs[i2];
      }
    }
    var P;
    if (cavitation === 'gumbel') {
      P = bandSolve(Float64Array.from(A), Float64Array.from(b), N, bw);
      for (var q = 0; q < N; q++) if (P[q] < 0) P[q] = 0;
    } else {
      P = this._lcp(A, b);
    }
    var F0 = 0, F1 = 0, F2 = 0;
    for (var i3 = 0; i3 < nt; i3++) {
      var w = 0, base = pos[i3] * nz;
      for (var j3 = 0; j3 < nz; j3++) w += P[base + j3] * this.wz[j3];
      w *= dth * 2;
      F0 -= w * this.cos[i3]; F1 -= w * this.sin[i3]; F2 -= w * this.sp[i3];
    }
    var out = { F: [F0, F1, F2], Hmin: Hmin };
    if (this.wantExtras) out.ex = this.extras(P, X, Y, D);
    return out;
  };
  // Potência de atrito e vazões adimensionais do pad (largura total):
  //   potência  = μ·ω²·R⁴/C · pw ,  pw = ∫∫ (1/H + 3·H·∂P/∂θ) dθ dẑ   (atrito também na região cavitada: conservador)
  //   vazão     = ω·R²·C · q ,      q_in = ∫ (H − H³·∂P/∂θ)/2 dẑ na borda de ataque; q_s = 2 × ½∫ H³·(−∂P/∂ẑ) dθ (duas bordas laterais)
  ReynoldsPad.prototype.extras = function (P, X, Y, D) {
    var nt = this.nt, nz = this.nz, dth = this.dth, dz = this.dz, per = this.periodic, pos = this.pos, self = this;
    var Pv = function (i, j) {
      if (j >= nz) return 0;
      if (per) i = ((i % nt) + nt) % nt; else if (i < 0 || i >= nt) return 0;
      return P[pos[i] * nz + j];
    };
    var dPdth = function (i, j) {
      if (!per && i === -1) return (4 * Pv(0, j) - Pv(1, j)) / (2 * dth);
      if (!per && i === nt) return (-4 * Pv(nt - 1, j) + Pv(nt - 2, j)) / (2 * dth);
      return (Pv(i + 1, j) - Pv(i - 1, j)) / (2 * dth);
    };
    var th = function (i) { return per ? self.pad.start + dth * i : self.pad.start + dth * (i + 1); };
    var i0 = per ? 0 : -1, i1 = per ? nt - 1 : nt, pw = 0, qs = 0, qin = 0;
    for (var i = i0; i <= i1; i++) {
      var wt = (!per && (i === i0 || i === i1)) ? dth / 2 : dth, H = this.film(th(i), X, Y, D), H3 = H * H * H;
      for (var j = 0; j <= nz; j++) {
        var wz = (j === 0 || j === nz) ? dz / 2 : dz;
        pw += wt * wz * (1 / H + 3 * H * dPdth(i, j));
      }
      qs += wt * H3 * (4 * Pv(i, nz - 1) - Pv(i, nz - 2)) / (2 * dz);
    }
    if (!per) {
      var Hl = this.film(th(-1), X, Y, D);
      for (var j2 = 0; j2 <= nz; j2++) {
        var wz2 = (j2 === 0 || j2 === nz) ? dz / 2 : dz;
        qin += wz2 * (Hl - Hl * Hl * Hl * dPdth(-1, j2)) / 2;
      }
    }
    // pw e qin: ×2 pela meia largura resolvida; qs: (1/2)·∫H³(−∂P/∂ẑ)dθ por borda × 2 bordas
    return { pw: 2 * pw, qs: qs, qin: 2 * qin };
  };
  ReynoldsPad.prototype._lcp = function (A, b) {
    var N = this.N, bw = this.bw, W = 2 * bw + 1;
    var cav = (this.lastCav && this.lastCav.length === N) ? Uint8Array.from(this.lastCav) : new Uint8Array(N);
    var P, lam = new Float64Array(N);
    for (var it = 0; it < 60; it++) {
      var Aw = Float64Array.from(A), bb = Float64Array.from(b);
      for (var k = 0; k < N; k++) if (cav[k]) {
        var kb = k * W;
        for (var c = 0; c < W; c++) Aw[kb + c] = 0;
        Aw[kb + bw] = 1; bb[k] = 0;
      }
      P = bandSolve(Aw, bb, N, bw);
      var changed = false;
      for (var r = 0; r < N; r++) {
        var s = -b[r], rb = r * W, c0 = Math.max(0, r - bw), c1 = Math.min(N - 1, r + bw);
        for (var cc = c0; cc <= c1; cc++) s += A[rb + cc - r + bw] * P[cc];
        lam[r] = s;
        var nc = (s - P[r]) > 1e-12 ? 1 : 0;
        if (nc !== cav[r]) { changed = true; cav[r] = nc; }
      }
      if (!changed) break;
    }
    this.lastCav = cav;
    for (var q = 0; q < N; q++) if (P[q] < 0) P[q] = 0;
    return P;
  };

  // ---- geometria --------------------------------------------------------- //
  function makePad(startDeg, arcDeg, offset, preload, tilting) {
    return { start: startDeg * DEG, arc: arcDeg * DEG, offset: offset, preload: preload, tilting: !!tilting };
  }
  function makeGeometry(kind, LD, preload, nPads, arcDeg, offset) {
    preload = preload || 0; nPads = nPads || 5; arcDeg = arcDeg || 60; offset = (offset === undefined || offset === null) ? 0.5 : offset;
    var pads, periodic = false;
    if (kind === 'Cilíndrico 360°') { pads = [makePad(0, 360, 0.5, 0)]; periodic = true; preload = 0; }
    else if (kind === 'Cilíndrico 2 ranhuras' || kind === 'Elíptico') {
      var m = kind === 'Elíptico' ? preload : 0;
      pads = [makePad(10, 160, 0.5, m), makePad(190, 160, 0.5, m)];
    } else if (kind === '3 lobos') {
      pads = [0, 1, 2].map(function (k) { return makePad(220 + 120 * k, 100, 0.5, preload); });
    } else if (kind === 'Tilting pad LOP' || kind === 'Tilting pad LBP') {
      var pitch = 360 / nPads, first = kind === 'Tilting pad LOP' ? 270 : 270 + pitch / 2, arc = Math.min(arcDeg, 0.95 * pitch);
      pads = [];
      for (var k = 0; k < nPads; k++) pads.push(makePad(first + k * pitch - offset * arc, arc, offset, preload, true));
    } else throw new Error('tipo de mancal desconhecido: ' + kind);
    var tp = kind.indexOf('Tilting') === 0;
    return { name: kind, pads: pads, LD: LD, periodic: periodic, tilting: tp,
             key: JSON.stringify([kind, LD, (kind === 'Cilíndrico 360°' || kind === 'Cilíndrico 2 ranhuras') ? 0 : preload,
                                  tp ? nPads : 0, tp ? arcDeg : 0, tp ? offset : 0]) };
  }

  // ---- raízes ------------------------------------------------------------ //
  function brent(f, a, b, xtol) {
    var fa = f(a), fb = f(b), c = a, fc = fa, d = b - a, e = d;
    if (fa * fb > 0) throw new Error('sem troca de sinal');
    for (var it = 0; it < 200; it++) {
      if (fb * fc > 0) { c = a; fc = fa; d = b - a; e = d; }
      if (Math.abs(fc) < Math.abs(fb)) { a = b; b = c; c = a; fa = fb; fb = fc; fc = fa; }
      var tol = 2 * 2.2e-16 * Math.abs(b) + 0.5 * (xtol || 1e-12), m = 0.5 * (c - b);
      if (Math.abs(m) <= tol || fb === 0) return b;
      if (Math.abs(e) >= tol && Math.abs(fa) > Math.abs(fb)) {
        var s = fb / fa, p, q, r;
        if (a === c) { p = 2 * m * s; q = 1 - s; }
        else { q = fa / fc; r = fb / fc; p = s * (2 * m * q * (q - r) - (b - a) * (r - 1)); q = (q - 1) * (r - 1) * (s - 1); }
        if (p > 0) q = -q; else p = -p;
        if (2 * p < Math.min(3 * m * q - Math.abs(tol * q), Math.abs(e * q))) { e = d; d = p / q; }
        else { d = m; e = m; }
      } else { d = m; e = m; }
      a = b; fa = fb;
      b += Math.abs(d) > tol ? d : (m > 0 ? tol : -tol);
      fb = f(b);
    }
    return b;
  }
  function secant(f, x0, x1, tol, maxiter) {
    var q0 = f(x0), q1 = f(x1);
    for (var i = 0; i < maxiter; i++) {
      if (q1 === q0) return (x0 + x1) / 2;
      var p = x1 - q1 * (x1 - x0) / (q1 - q0);
      if (Math.abs(p - x1) < tol) return p;
      x0 = x1; q0 = q1; x1 = p; q1 = f(x1);
    }
    throw new Error('secante não convergiu');
  }
  function linspace(a, b, n) { var o = []; for (var i = 0; i < n; i++) o.push(n === 1 ? a : a + (b - a) * i / (n - 1)); return o; }

  // ---- mancal completo --------------------------------------------------- //
  function FluidModel(geo, opts) {
    opts = opts || {};
    this.geo = geo; this.cav = opts.cavitation || 'reynolds';
    var nz = opts.nz || 10, self = this;
    this.pads = geo.pads.map(function (p) {
      var nt = opts.nTheta || (geo.periodic ? 72 : Math.max(14, Math.round(p.arc / DEG / 4)));
      return new ReynoldsPad(p, geo.LD, geo.periodic, nt, nz);
    });
    this.tiltIdx = [];
    geo.pads.forEach(function (p, i) { if (p.tilting) self.tiltIdx.push(i); });
    this.Dprev = {}; this.aprev = null;
  }
  FluidModel.prototype.padForce = function (i, X, Y, D, VX, VY, VD) {
    return this.pads[i].solve(X, Y, D, VX, VY, VD, this.cav).F;
  };
  FluidModel.prototype.tiltEq = function (i, X, Y) {
    var pad = this.pads[i], self = this, lo = -5, hi = 5, hasP = false, hasN = false;
    var tlo = Infinity, thi = -Infinity;
    for (var k = 0; k < pad.nt; k++) for (var sgn = -1; sgn <= 1; sgn += 2) {
      var t = pad.th[k] + sgn * pad.dth;
      var g = pad.a - pad.b * Math.cos(t - pad.piv) - X * Math.cos(t) - Y * Math.sin(t), s = Math.sin(t - pad.piv);
      if (s > 0) { hasP = true; tlo = Math.min(tlo, g / s); }
      if (s < 0) { hasN = true; thi = Math.max(thi, g / s); }
    }
    hi = hasP ? tlo : 5; lo = hasN ? thi : -5;
    var span = hi - lo; lo += 0.02 * span; hi -= 0.02 * span;
    var f = function (D) { return self.padForce(i, X, Y, D)[2]; };
    var D0 = this.Dprev[i];
    if (D0 !== undefined && lo < D0 && D0 < hi) {
      try {
        var Dn = secant(f, D0, D0 + 1e-3 * span, 1e-12, 25), h = 1e-4 * span;
        if (lo < Dn && Dn < hi && Math.abs(f(Dn)) < 1e-9 && f(Dn + h) < f(Dn - h)) { this.Dprev[i] = Dn; return Dn; }
      } catch (e) { /* cai na busca em grade */ }
    }
    var grid = linspace(lo, hi, 17), vals = grid.map(f), mx = 0;
    vals.forEach(function (v) { mx = Math.max(mx, Math.abs(v)); });
    var tol = 1e-10 * Math.max(1, mx);
    for (var q = 0; q < grid.length - 1; q++) if (vals[q] > tol && vals[q + 1] < -tol) {
      this.Dprev[i] = brent(f, grid[q], grid[q + 1], 1e-12); return this.Dprev[i];
    }
    for (var q2 = 0; q2 < grid.length - 1; q2++)
      if (vals[q2] * vals[q2 + 1] < 0 && Math.abs(vals[q2]) > tol && Math.abs(vals[q2 + 1]) > tol) return brent(f, grid[q2], grid[q2 + 1], 1e-12);
    if (mx <= tol) return 0;
    var best = null, bv = Infinity;
    vals.forEach(function (v, qq) { if (Math.abs(v) > tol && Math.abs(v) < bv) { bv = Math.abs(v); best = grid[qq]; } });
    return best;
  };
  FluidModel.prototype.state = function (X, Y) {
    var D = new Float64Array(this.pads.length), F = [0, 0];
    for (var i = 0; i < this.pads.length; i++) {
      if (this.tiltIdx.indexOf(i) >= 0) D[i] = this.tiltEq(i, X, Y);
      var f = this.padForce(i, X, Y, D[i]);
      F[0] += f[0]; F[1] += f[1];
    }
    return { F: F, D: D };
  };
  FluidModel.prototype.equilibrium = function (eps) {
    var self = this;
    var fx = function (a) { return self.state(eps * Math.cos(a), eps * Math.sin(a)).F; };
    var fin = function (a) { var X = eps * Math.cos(a), Y = eps * Math.sin(a), st = self.state(X, Y); return { X: X, Y: Y, D: st.D, W: st.F[1] }; };
    if (this.aprev !== null) {
      try {
        var lo = this.aprev - 0.35, hi = this.aprev + 0.35, flo = fx(lo), fhi = fx(hi);
        if (flo[0] * fhi[0] < 0 && flo[1] > 0 && fhi[1] > 0) {
          var a0 = brent(function (t) { return fx(t)[0]; }, lo, hi, 1e-10);
          this.aprev = a0; return fin(a0);
        }
      } catch (e) { /* busca em grade */ }
    }
    var grid = this.geo.tilting ? linspace(-Math.PI / 2 - 70 * DEG, -Math.PI / 2 + 70 * DEG, 15) : linspace(-Math.PI, Math.PI, 37);
    var vals = grid.map(function (a) { try { return fx(a); } catch (e) { return [NaN, NaN]; } });
    var best = null;
    for (var k = 0; k < grid.length - 1; k++) {
      var f0 = vals[k], f1 = vals[k + 1];
      if (isNaN(f0[0]) || isNaN(f1[0])) continue;
      if (f0[0] * f1[0] <= 0 && f0[1] > 0 && f1[1] > 0) {
        var a = (f0[0] === 0) ? grid[k] : (f1[0] === 0 ? grid[k + 1] : brent(function (t) { return fx(t)[0]; }, grid[k], grid[k + 1], 1e-10));
        if (best === null || Math.abs(a + Math.PI / 2) < Math.abs(best + Math.PI / 2)) best = a;
      }
    }
    if (best === null) throw new Error('equilíbrio não encontrado para ε = ' + eps);
    this.aprev = best;
    return fin(best);
  };
  FluidModel.prototype.flowPower = function (X, Y, D) {
    var o = { pw: 0, qin: 0, qs: 0 };
    for (var i = 0; i < this.pads.length; i++) {
      var pd = this.pads[i]; pd.wantExtras = true;
      var ex = pd.solve(X, Y, D[i], 0, 0, 0, this.cav).ex; pd.wantExtras = false;
      o.pw += ex.pw; o.qin += ex.qin; o.qs += ex.qs;
    }
    return o;
  };
  FluidModel.prototype.coefficients = function (X, Y, D, W, h) {
    h = h || 1e-5;
    var n = this.pads.length, tilt = this.tiltIdx, nq = 2 + tilt.length, self = this;
    var K = mat(nq), C = mat(nq), colOf = {};
    tilt.forEach(function (i, j) { colOf[i] = 2 + j; });
    for (var i = 0; i < n; i++) {
      var isT = colOf[i] !== undefined, rows = isT ? [0, 1, colOf[i]] : [0, 1];
      var coords = [['X', 0], ['Y', 1]]; if (isT) coords.push(['D', colOf[i]]);
      coords.forEach(function (cd) {
        [['', K], ['V', C]].forEach(function (kd) {
          var key = kd[0] + cd[0], args = function (sg) {
            var v = { X: X, Y: Y, D: D[i], VX: 0, VY: 0, VD: 0 }; v[key] += sg * h;
            return self.padForce(i, v.X, v.Y, v.D, v.VX, v.VY, v.VD);
          };
          var fp = args(1), fm = args(-1);
          var vec = [(fp[0] - fm[0]) / (2 * h), (fp[1] - fm[1]) / (2 * h)];
          if (isT) vec.push((fp[2] - fm[2]) / (2 * h));
          rows.forEach(function (r, q) { kd[1][r][cd[1]] += -vec[q] / W; });
        });
      });
    }
    if (nq === 2) return { K: [[K[0][0], K[0][1]], [K[1][0], K[1][1]]], C: [[C[0][0], C[0][1]], [C[1][0], C[1][1]]] };
    var keep = [0, 1];
    for (var c = 2; c < nq; c++) if (Math.abs(K[c][c]) + Math.abs(C[c][c]) > 1e-9) keep.push(c);
    if (keep.length === 2) return { K: [[K[0][0], K[0][1]], [K[1][0], K[1][1]]], C: [[C[0][0], C[0][1]], [C[1][0], C[1][1]]] };
    // Z = K + iC ; Zr = Zjj − Zjp·Zpp⁻¹·Zpj  (redução síncrona)
    var p = keep.slice(2), np_ = p.length, Zr = mat(np_), Zi = mat(np_);
    p.forEach(function (a, r) { p.forEach(function (b2, cc) { Zr[r][cc] = K[a][b2]; Zi[r][cc] = C[a][b2]; }); });
    var Fz = cluFactor(Zr, Zi), outK = [[0, 0], [0, 0]], outC = [[0, 0], [0, 0]], cols = [];
    for (var j = 0; j < 2; j++) cols.push(cluSolve(Fz, Float64Array.from(p.map(function (a) { return K[a][j]; })),
                                                     Float64Array.from(p.map(function (a) { return C[a][j]; }))));
    for (var r2 = 0; r2 < 2; r2++) for (var j2 = 0; j2 < 2; j2++) {
      var sr = 0, si = 0;
      p.forEach(function (a, q) {
        var zr = K[r2][a], zi = C[r2][a], xr = cols[j2].re[q], xi = cols[j2].im[q];
        sr += zr * xr - zi * xi; si += zr * xi + zi * xr;
      });
      outK[r2][j2] = K[r2][j2] - sr; outC[r2][j2] = C[r2][j2] - si;
    }
    return { K: outK, C: outC };
  };

  // ---- tabela de Sommerfeld --------------------------------------------- //
  function defaultEps() { return [0.03, 0.06].concat(linspace(0.1, 0.85, 16)); }

  // Construtor incremental (uma excentricidade por passo) — para não travar a página
  function tableBuilder(geo, epsValues, opts) {
    var model = new FluidModel(geo, opts), list = epsValues || defaultEps(), i = 0, rows = [];
    return {
      total: list.length,
      get index() { return i; },
      get done() { return i >= list.length; },
      step: function () {
        var e = list[i++];
        try {
          var eq = model.equilibrium(e);
          if (!(eq.W > 0)) return;
          var kc = model.coefficients(eq.X, eq.Y, eq.D, eq.W), Hm = Infinity;
          for (var p = 0; p < model.pads.length; p++) Hm = Math.min(Hm, model.pads[p].solve(eq.X, eq.Y, eq.D[p]).Hmin);
          var fp = model.flowPower(eq.X, eq.Y, eq.D);
          rows.push({ eps: e, S: geo.LD / (3 * Math.PI * eq.W), att: Math.atan2(eq.X, -eq.Y) / DEG, K: kc.K, C: kc.C, Hmin: Hm,
                      pw: fp.pw, qin: fp.qin, qs: fp.qs, W: eq.W });
        } catch (err) { /* ponto sem solução: ignorado */ }
      },
      result: function () {
        if (rows.length < 2) throw new Error("não foi possível gerar a tabela de '" + geo.name + "'");
        return { key: geo.key, name: geo.name, LD: geo.LD,
                 eps: rows.map(function (r) { return r.eps; }), S: rows.map(function (r) { return r.S; }),
                 att: rows.map(function (r) { return r.att; }), K: rows.map(function (r) { return r.K; }),
                 C: rows.map(function (r) { return r.C; }), Hmin: rows.map(function (r) { return r.Hmin; }),
                 pw: rows.map(function (r) { return r.pw; }), qin: rows.map(function (r) { return r.qin; }),
                 qs: rows.map(function (r) { return r.qs; }), periodic: geo.periodic };
      }
    };
  }
  function buildTable(geo, epsValues, opts) {
    var b = tableBuilder(geo, epsValues, opts);
    while (!b.done) b.step();
    return b.result();
  }
  function interpTable(t, S) {
    var order = t.S.map(function (_, i) { return i; }).sort(function (a, b) { return t.S[a] - t.S[b]; });
    var xs = order.map(function (i) { return Math.log(t.S[i]); }), s = Math.log(S);
    var f = function (arr) { return interp1(s, xs, order.map(function (i) { return arr[i]; })); };
    var g = function (M) {
      return [[f(M.map(function (m) { return m[0][0]; })), f(M.map(function (m) { return m[0][1]; }))],
              [f(M.map(function (m) { return m[1][0]; })), f(M.map(function (m) { return m[1][1]; }))]];
    };
    return { eps: f(t.eps), att: f(t.att), Hmin: f(t.Hmin), K: g(t.K), C: g(t.C),
             pw: t.pw ? f(t.pw) : NaN, qin: t.qin ? f(t.qin) : NaN, qs: t.qs ? f(t.qs) : NaN,
             below: s < xs[0], above: s > xs[xs.length - 1] };
  }

  // ---- óleo: Walther (ASTM D341) com ν100 típico (IV ≈ 95–100) ------------ //
  var NU100 = { 22: 4.3, 32: 5.4, 46: 6.8, 68: 8.7, 100: 11.3, 150: 14.7 };
  function oilViscosity(grade, Tc, rho15) {
    rho15 = rho15 || 870;
    var vg = typeof grade === 'number' ? grade : parseInt(String(grade).split(' ').pop(), 10);
    var nu40 = vg, nu100 = NU100[vg], T1 = 313.15, T2 = 373.15, T = Tc + 273.15;
    var y1 = Math.log10(Math.log10(nu40 + 0.7)), y2 = Math.log10(Math.log10(nu100 + 0.7));
    var B = (y1 - y2) / (Math.log10(T2) - Math.log10(T1)), A = y1 + B * Math.log10(T1);
    var nu = Math.pow(10, Math.pow(10, A - B * Math.log10(T))) - 0.7;
    return nu * 1e-6 * rho15 * (1 - 0.00065 * (Tc - 15));
  }

  // ---- mancal dimensional ----------------------------------------------- //
  function round4(x) { return Math.round(x * 1e4) / 1e4; }
  function geometryForRow(r, m) {
    var pre = hasPreload(r) ? (m === undefined ? num(r.preload, 0) : m) : 0;
    return makeGeometry(r.type, round4(num(r.Lb, 0) / num(r.D, 1)), pre, num(r.n_pads, 5), num(r.arc, 60), num(r.offset, 0.5));
  }

  // ---- grade de pré-carga ------------------------------------------------ //
  // A pré-carga real depende da folga de operação (m = e/(C + e) quando a
  // excentricidade do furo é informada), então as tabelas são geradas numa grade
  // de m (passo 0,05) e os coeficientes interpolados linearmente em m.
  var PRELOAD_STEP = 0.05;
  function geoGrid(r, m) {
    if (!hasPreload(r) || !(m > 0)) return [{ geo: geometryForRow(r, 0), w: 1 }];
    var k = m / PRELOAD_STEP, kr = Math.round(k);
    if (Math.abs(k - kr) < 1e-6) return [{ geo: geometryForRow(r, round4(kr * PRELOAD_STEP)), w: 1 }];
    var k0 = Math.floor(k), m0 = round4(k0 * PRELOAD_STEP), t = (m - m0) / PRELOAD_STEP;
    return [{ geo: geometryForRow(r, m0), w: 1 - t }, { geo: geometryForRow(r, round4((k0 + 1) * PRELOAD_STEP)), w: t }];
  }
  // Tabela da geometria: no Job (strict) pede a geração incremental lançando needGeo;
  // fora dele (Node, testes) gera na hora e guarda no mapa `tables`.
  function tableFor(tables, geo, strict) {
    var t = tables && tables[geo.key];
    if (t) return t;
    if (strict) { var e = new Error('tabela de Sommerfeld pendente: ' + geo.name); e.needGeo = geo; throw e; }
    t = buildTable(geo);
    if (tables) tables[geo.key] = t;
    return t;
  }
  function interpGrid(r, m, S, tables, strict) {
    var g = geoGrid(r, m), parts = g.map(function (x) { return { w: x.w, q: interpTable(tableFor(tables, x.geo, strict), S), geo: x.geo }; });
    if (parts.length === 1) { parts[0].q.periodic = parts[0].geo.periodic; return parts[0].q; }
    var o = { periodic: parts[0].geo.periodic, below: parts[0].q.below || parts[1].q.below, above: parts[0].q.above || parts[1].q.above };
    ['eps', 'att', 'Hmin', 'pw', 'qin', 'qs'].forEach(function (k) { o[k] = parts[0].w * parts[0].q[k] + parts[1].w * parts[1].q[k]; });
    ['K', 'C'].forEach(function (k) {
      o[k] = [0, 1].map(function (i) { return [0, 1].map(function (j) { return parts[0].w * parts[0].q[k][i][j] + parts[1].w * parts[1].q[k][i][j]; }); });
    });
    return o;
  }

  // ---- óleo: massa específica e calor específico (mineral típico) ------------ //
  function oilDensity(Tc, rho15) { return (rho15 || 870) * (1 - 0.00065 * (Tc - 15)); }
  function oilCp(Tc) { return 1800 + 3.4 * Tc; }                       // J/(kg·K)

  // Folga a frio → a quente pela dilatação térmica do mancal e do munhão (raios em mm, α em µm/(m·K))
  //   C_quente = C_frio + R·α_mancal·(T_mancal − T_mont)·1e-3 − R·α_eixo·(T_munhão − T_mont)·1e-3   [µm]
  // "Folga a quente" informada prevalece. opt: { Tj, Th, crFactor, crMode: 'cold' }
  function bearingThermal(p, r, opt) {
    opt = opt || {};
    var a = Object.assign({}, DEFAULT_ANALYSIS, p.analysis || {}), sh = p.shaft || [];
    var Tef = num(r.T, 50), Tm = num(a.T_mount, 20);
    var Tj = opt.Tj !== undefined ? opt.Tj : num(r.T_j, Tef), Th = opt.Th !== undefined ? opt.Th : num(r.T_h, Tef);
    if (opt.crMode === 'cold') { Tj = Tm; Th = Tm; }
    var n = Math.round(num(r.node, 1)), ei = Math.max(0, Math.min(sh.length - 1, n <= sh.length ? n - 1 : n - 2));
    var aj = sh.length ? (MATERIALS[sh[ei].material] || MATERIALS['Aço']).alpha : 11.5, ab = num(r.alpha_b, 11.5);
    var f = opt.crFactor || 1, R = num(r.D, 0) / 2, dRb = R * ab * (Th - Tm) * 1e-3, dRj = R * aj * (Tj - Tm) * 1e-3;
    var cold = num(r.Cr, 0) * f, calc = cold + dRb - dRj, given = opt.crMode === 'cold' ? NaN : num(r.Cr_hot, NaN) * f;
    return { cold: cold, hot: isFinite(given) ? given : calc, calc: calc, given: isFinite(given),
             dRb: dRb, dRj: dRj, Tef: Tef, Tj: Tj, Th: Th, Tm: Tm, aj: aj, ab: ab };
  }

  // ======================================================================= //
  // Estado do mancal hidrodinâmico na rotação w (rad/s) com carga W (N)
  //   Térmica "Calculada": resolve ΔT = P/(ρ·c_p·Q_alim) (Brent em ΔT), com
  //     T_efetiva = T_entrada + k·ΔT, T_saída = T_entrada + ΔT,
  //     T_munhão = T_saída e T_mancal = (T_entrada + T_saída)/2 se não informadas.
  //   Térmica "Informada": T efetiva da tabela; ΔT e T_saída estimados só para informação.
  //   A cada iteração: temperaturas → folga a quente → pré-carga (se houver
  //   excentricidade do furo) → viscosidade → S → coeficientes, potência e vazão.
  //   Potência = μω²R⁴/C·p̄w ; vazões = ωR²C·q̄ ; alimentação = entradas das
  //   sapatas/lobos (360° sem ranhura: vazamento lateral).
  // mods: { dT (desloca T entrada ou T efetiva), crFactor (folga de fabricação), crMode: 'cold' }
  // ======================================================================= //
  function bearingState(p, r, W, w, tables, mods, strict) {
    mods = mods || {};
    var a = Object.assign({}, DEFAULT_ANALYSIS, p.analysis || {}), kmix = num(a.k_mix, 0.75);
    var calc = r.thermal === 'Calculada', Rm = num(r.D, 0) * 5e-4, Lm = num(r.Lb, 0) * 1e-3;
    var eb = num(r.e_bore, NaN), hasE = hasPreload(r) && isFinite(eb) && eb >= 0, fac = mods.crFactor || 1;
    var Tin = calc ? num(r.T_in, 45) + (mods.dT || 0) : NaN;
    function ev(dT) {
      var Tef, Tout, Tjd, Thd;
      if (calc) { Tef = Tin + kmix * dT; Tout = Tin + dT; Tjd = Tout; Thd = (Tin + Tout) / 2; }
      else { Tef = num(r.T, 50) + (mods.dT || 0); Tout = NaN; Tjd = Tef; Thd = Tef; }
      var th = bearingThermal(p, r, { Tj: num(r.T_j, Tjd), Th: num(r.T_h, Thd), crFactor: fac, crMode: mods.crMode });
      th.Tef = Tef;
      if (!(th.hot > 0)) throw new Error("Mancal '" + r.name + "': folga a quente ≤ 0 (" + th.hot.toFixed(1) + ' µm).');
      var C = th.hot * 1e-6, m = hasE ? eb / (th.hot + eb) : (hasPreload(r) ? num(r.preload, 0) : 0);
      if (!(m < 0.9)) throw new Error("Mancal '" + r.name + "': pré-carga resultante ≥ 0,9.");
      var mu = oilViscosity(r.oil, Tef), S = mu * (w / TWO_PI) * Lm * 2 * Rm / W * Math.pow(Rm / C, 2);
      var q = interpGrid(r, m, S, tables, strict), kf = W / C, cf = W / (C * w);
      var power = mu * w * w * Math.pow(Rm, 4) / C * q.pw, Qin = w * Rm * Rm * C * q.qin, Qs = w * Rm * Rm * C * q.qs;
      var Qsup = q.periodic ? Qs : Qin, rho = oilDensity(calc ? Tin : Tef), cp = oilCp(Tef);
      return { S: S, eps: q.eps, att: q.att, K: q.K, C: q.C, Hmin: q.Hmin, below: q.below, above: q.above,
               Kdim: q.K.map(function (row) { return row.map(function (v) { return v * kf; }); }),
               Cdim: q.C.map(function (row) { return row.map(function (v) { return v * cf; }); }),
               hmin_um: q.Hmin * th.hot, mu: mu, Tef: Tef, Tin: Tin, Tout: Tout, Tj: th.Tj, Th: th.Th,
               cr: th.hot, crCold: th.cold, m: m, mCold: hasE ? eb / (th.cold + eb) : m, eBore: hasE ? eb : null,
               power: power, Qsup: Qsup, Qin: Qin, Qs: Qs, rho: rho, cp: cp, dTcalc: power / (rho * cp * Qsup),
               thermal: th, calc: calc, W: W };
    }
    if (!calc) { var st = ev(0); st.dT = st.dTcalc; return st; }
    var g = function (d) { return ev(d).dTcalc - d; }, hi = 20, ghi = g(hi);
    while (ghi > 0 && hi < 320) { hi *= 2; ghi = g(hi); }
    var dT = ghi > 0 ? hi : brent(g, 0, hi, 1e-4), st2 = ev(dT);
    st2.dT = dT; st2.converged = ghi <= 0;
    return st2;
  }

  // ======================================================================= //
  // Projeto → modelo
  // ======================================================================= //
  // Geometrias das tabelas na condição informada (pré-carga da coluna ou do furo com a folga a frio)
  function requiredGeometries(p) {
    var seen = {}, out = [];
    (p.bearings || []).forEach(function (r) {
      if (!isFluid(r)) return;
      var eb = num(r.e_bore, NaN), m = hasPreload(r) ? (isFinite(eb) ? eb / (num(r.Cr, 1) + eb) : num(r.preload, 0)) : 0;
      geoGrid(r, m).forEach(function (x) { if (!seen[x.geo.key]) { seen[x.geo.key] = 1; out.push(x.geo); } });
    });
    return out;
  }

  function staticLoads(p) {
    return staticReactions(elementsSI(p), disksSI(p), (p.bearings || []).map(function (r) { return num(r.node, 1) - 1; }));
  }
  function disksSI(p) {
    return (p.disks || []).map(function (r) { return { node: num(r.node, 1) - 1, m: num(r.m, 0), Ip: num(r.Ip, 0), Id: num(r.Id, 0), name: r.name }; });
  }
  function bearingLoad(p, r, i, loads) { var W = num(r.W, NaN); return isFinite(W) ? W : loads[i]; }

  // tables: { key: tabela } — geradas sob demanda (ver tableFor)
  // mods (opcional, estudos de sensibilidade): { dT, crMode: 'cold', crFactor }
  function buildModel(p, tables, mods, strict) {
    var errs = validate(p);
    if (errs.length) throw new Error(errs.join('\n'));
    var a = Object.assign({}, DEFAULT_ANALYSIS, p.analysis || {});
    var loads = null, smax = a.speed_max * 1.3;
    var sp = linspace(Math.max(200, 0.02 * smax), smax, 25).map(function (x) { return x * RPM; });
    tables = tables || {};
    var bearings = p.bearings.map(function (r, i) {
      var node = num(r.node, 1) - 1;
      if (isConst(r)) {
        return makeBearing(node, { kxx: num(r.kxx, 0), kyy: num(r.kyy, 0), kxy: num(r.kxy, 0), kyx: num(r.kyx, 0),
                                   cxx: num(r.cxx, 0), cyy: num(r.cyy, 0), cxy: num(r.cxy, 0), cyx: num(r.cyx, 0) }, null, r.name);
      }
      loads = loads || staticLoads(p);
      var W = bearingLoad(p, r, i, loads), c = { kxx: [], kxy: [], kyx: [], kyy: [], cxx: [], cxy: [], cyx: [], cyy: [] };
      sp.forEach(function (w) {
        var q = bearingState(p, r, W, w, tables, mods, strict);
        c.kxx.push(q.Kdim[0][0]); c.kxy.push(q.Kdim[0][1]); c.kyx.push(q.Kdim[1][0]); c.kyy.push(q.Kdim[1][1]);
        c.cxx.push(q.Cdim[0][0]); c.cxy.push(q.Cdim[0][1]); c.cyx.push(q.Cdim[1][0]); c.cyy.push(q.Cdim[1][1]);
      });
      return makeBearing(node, c, sp, r.name);
    });
    return assemble(elementsSI(p), disksSI(p), bearings, p.name);
  }

  // ======================================================================= //
  // Flecha estática (peso próprio)
  //   rigid: eixo sobre apoios rígidos nos mancais → flecha do eixo
  //   total: linha de centro real, com o munhão na posição de equilíbrio de cada
  //          mancal na rotação w (hidrodinâmico: excentricidade ε·C na direção da
  //          atitude, da tabela de Sommerfeld; constante: W/kyy). Não se usa a
  //          rigidez linearizada do filme para isso: ela só vale para perturbações.
  // ======================================================================= //
  function deflection(p, model, w, tables, loads, strict) {
    var els = elementsSI(p), base = assemble(els, disksSI(p), [], ''), n = base.ndof, big = 0;
    for (var i = 0; i < n; i++) big = Math.max(big, Math.abs(base.Kshaft[i][i]));
    big *= 1e6;
    var F = new Float64Array(n);
    for (var r0 = 0; r0 < n; r0++) { var s0 = 0; for (var c0 = 1; c0 < n; c0 += 4) s0 += base.M[r0][c0]; F[r0] = -G_ACCEL * s0; }
    var brg = p.bearings.map(function (r, k) {
      var node = num(r.node, 1) - 1, W = bearingLoad(p, r, k, loads), o = { name: r.name, type: r.type, node: node + 1, z: base.nodesPos[node] * 1000 };
      o.load = W;
      if (isFluid(r)) {
        var q = bearingState(p, r, W, w, tables, null, strict), e = q.eps * q.cr * 1e-6, at = q.att * DEG;
        o.dy = -e * Math.cos(at); o.dx = e * Math.sin(at); o.eps = q.eps; o.att = q.att; o.cr = q.cr;
      } else {
        var kyy = bearingKC(model.bearings[k], w).K[1][1];
        o.dy = kyy > 0 ? -W / kyy : 0; o.dx = 0;
      }
      return o;
    });
    var nodes = {};
    brg.forEach(function (b) { var q = nodes[b.node - 1] || (nodes[b.node - 1] = { dy: 0, c: 0 }); q.dy += b.dy; q.c++; });
    function solve(withJournal) {
      var K = copyMat(base.Kshaft), f = Float64Array.from(F);
      Object.keys(nodes).forEach(function (k) {
        var d = 4 * Number(k);
        K[d][d] += big; K[d + 1][d + 1] += big;
        if (withJournal) f[d + 1] += big * nodes[k].dy / nodes[k].c;
      });
      return luSolve(luFactor(K), f);
    }
    var q1 = solve(false), q2 = solve(true), z = [], y1 = [], y2 = [], NS = 16;
    function herm(q, e, xi, L) {
      var w1 = q[4 * e + 1], s1 = q[4 * e + 3], w2 = q[4 * e + 5], s2 = q[4 * e + 7], x2 = xi * xi, x3 = x2 * xi;
      return (1 - 3 * x2 + 2 * x3) * w1 + L * (xi - 2 * x2 + x3) * s1 + (3 * x2 - 2 * x3) * w2 + L * (-x2 + x3) * s2;
    }
    els.forEach(function (el, e) {
      for (var k = (e === 0 ? 0 : 1); k <= NS; k++) {
        var xi = k / NS;
        z.push((base.nodesPos[e] + xi * el.L) * 1000);
        y1.push(herm(q1, e, xi, el.L) * 1e6); y2.push(herm(q2, e, xi, el.L) * 1e6);
      }
    });
    var zs = brg.map(function (b) { return b.z; }), zmin = Math.min.apply(null, zs), zmax = Math.max.apply(null, zs);
    function peak(y) {
      var im = 0; y.forEach(function (v, i) { if (v < y[im]) im = i; });
      var zz = z[im], nd = 0; base.nodesPos.forEach(function (pz, i) { if (Math.abs(pz * 1000 - zz) < Math.abs(base.nodesPos[nd] * 1000 - zz)) nd = i; });
      return { value: -y[im], z: zz, node: nd + 1, where: (zz >= zmin - 1e-9 && zz <= zmax + 1e-9) ? 'no vão entre mancais' : 'em balanço' };
    }
    brg.forEach(function (b) {
      var d = 4 * (b.node - 1);
      b.slopeRigid = q1[d + 3] * 1000; b.slopeTotal = q2[d + 3] * 1000;       // mrad
      b.dy *= 1e6; b.dx *= 1e6;                                                // µm
    });
    return { z: z, rigid: y1, total: y2, nodesZ: base.nodesPos.map(function (v) { return v * 1000; }),
             maxRigid: peak(y1), maxTotal: peak(y2), bearings: brg, rpm: w / RPM };
  }

  // ======================================================================= //
  // Pipeline de análise incremental (Job) — a interface chama step() em fatias
  // ======================================================================= //
  function fmt(x, d) { return (x === null || x === undefined || !isFinite(x)) ? '—' : Number(x).toFixed(d === undefined ? 2 : d); }
  function fexp(x, d) { return (x === null || x === undefined || !isFinite(x)) ? '—' : Number(x).toExponential(d === undefined ? 3 : d); }
  function toCpm(w) { return w / RPM; }

  function Job(params, opts) {
    opts = opts || {};
    this.p = params;
    this.a = Object.assign({}, DEFAULT_ANALYSIS, params.analysis || {});
    this.tables = Object.assign({}, opts.tables || {});
    this.only = opts.only || null;                 // lista de análises (padrão: todas)
    this.results = { warnings: [] };
    this.tasks = [];
    this.done = false; this.label = ''; this.progress = 0;
    var errs = validate(params);
    if (errs.length) { var e = new Error(errs.join('\n')); e.validation = errs; throw e; }
    this._plan();
  }
  Job.prototype._want = function (k) { return !this.only || this.only.indexOf(k) >= 0; };
  Job.prototype._plan = function () {
    var self = this, T = this.tasks;
    // As tabelas de Sommerfeld não são planejadas aqui: a pré-carga de operação só é
    // conhecida durante o cálculo (folga a quente + excentricidade do furo). Quem precisa
    // de uma tabela lança `needGeo`; step() a gera em fatias e repete a tarefa.
    T.push({ label: 'Montando o modelo (balanço térmico dos mancais)', weight: 6, run: function () {
      self.model = buildModel(self.p, self.tables, null, true);
      self.loads = staticLoads(self.p);
      self.results.summary = self._summary();
      return true;
    } });
    if (this._want('bearings')) T.push({ label: 'Coeficientes dos mancais', weight: 1, run: function () { self.results.bearings = self._bearings(); return true; } });
    if (this._want('deflection')) T.push({ label: 'Flecha estática', weight: 1, run: function () {
      self.results.deflection = deflection(self.p, self.model, self.a.op_max * RPM, self.tables, self.loads, true); return true; } });
    if (this._want('campbell')) {
      var speeds = linspace(0, this.a.speed_max, Math.max(2, Math.round(this.a.n_speeds))).map(function (x) { return x * RPM; });
      var pts = [];
      T.push({ label: 'Diagrama de Campbell', weight: 20, run: function () {
        pts.push(modal(self.model, speeds[pts.length], Math.round(self.a.n_modes)));
        this.frac = pts.length / speeds.length;
        if (pts.length < speeds.length) return false;
        self.results.campbell = self._campbell(speeds, pts); return true;
      } });
    }
    if (this._want('modes')) T.push({ label: 'Formas modais', weight: 1, run: function () { self.results.modes = self._modes(); return true; } });
    if (this._want('unbalance')) {
      var st = null;
      T.push({ label: 'Resposta ao desbalanceamento', weight: 12, run: function () {
        if (!st) st = self._unbalanceSetup();
        var c = st.cases[st.ci];
        for (var q = 0; q < 25 && st.si < st.speeds.length; q++, st.si++) c.resp.push(unbalanceAt(self.model, st.speeds[st.si], c.ubs));
        if (st.si >= st.speeds.length) { st.ci++; st.si = 0; }
        this.frac = st.ci / st.cases.length;
        if (st.ci < st.cases.length) return false;
        self.results.unbalance = self._unbalanceFinish(st); return true;
      } });
    }
    if (this._want('stability')) {
      var Qs = linspace(0, Number(this.a.stab_Qmax), 21), sres = [];
      T.push({ label: 'Estabilidade', weight: 10, run: function () {
        sres.push(stabilityPoint(self.model, self.a.op_max * RPM, Math.round(self.a.stab_node) - 1, Qs[sres.length]));
        this.frac = sres.length / Qs.length;
        if (sres.length < Qs.length) return false;
        self.results.stability = self._stability(sres); return true;
      } });
    }
    if (this._want('sensitivity') && this.p.bearings.some(isFluid)) {
      var sn = null;
      T.push({ label: 'Sensibilidade (óleo e folga)', weight: 12, run: function () {
        if (!sn) sn = self._sensSetup();
        sn.out.push(self._sensPoint(sn.cases[sn.out.length], sn));
        this.frac = sn.out.length / sn.cases.length;
        if (sn.out.length < sn.cases.length) return false;
        self.results.sensitivity = self._sensFinish(sn); return true;
      } });
    }
    T.push({ label: 'Relatório', weight: 1, run: function () { self.results.report = self._report(); return true; } });
    this.totalWeight = T.reduce(function (s, t) { return s + t.weight; }, 0);
    this.ti = 0;
  };
  // Executa trabalho por até budgetMs (Infinity = até o fim). Retorna {done, progress, label}
  Job.prototype.step = function (budgetMs) {
    var t0 = Date.now(), budget = budgetMs === undefined ? 40 : budgetMs;
    while (this.ti < this.tasks.length) {
      if (this.pending) {                                   // gerando uma tabela de Sommerfeld pedida
        var pb = this.pending;
        pb.b.step();
        this.label = 'Mancal ' + pb.geo.name + ' — tabela de Reynolds (m = ' + JSON.parse(pb.geo.key)[2] + ', ' + pb.b.index + '/' + pb.b.total + ')';
        if (pb.b.done) { this.tables[pb.geo.key] = pb.b.result(); this.pending = null; this.nTables = (this.nTables || 0) + 1; }
        if (Date.now() - t0 >= budget) break;
        continue;
      }
      var t = this.tasks[this.ti];
      this.label = t.label;
      try {
        if (t.run()) this.ti++;
      } catch (e) {
        if (!e.needGeo) throw e;
        this.pending = { geo: e.needGeo, b: tableBuilder(e.needGeo) };
      }
      if (Date.now() - t0 >= budget) break;
    }
    var w = 0;
    for (var i = 0; i < this.ti; i++) w += this.tasks[i].weight;
    if (this.ti < this.tasks.length) w += this.tasks[this.ti].weight * (this.tasks[this.ti].frac || 0);
    this.progress = w / this.totalWeight;
    this.done = this.ti >= this.tasks.length;
    if (this.done) { this.progress = 1; this.results.tables = this.tables; }
    return { done: this.done, progress: this.progress, label: this.label };
  };

  // ---- partes do resultado --------------------------------------------- //
  Job.prototype._summary = function () {
    var m = this.model, p = this.p, self = this;
    return {
      nNodes: m.nNodes, length: m.nodesPos[m.nNodes - 1], mass: m.mass, cg: m.cg, ndof: m.ndof,
      disks: m.disks.map(function (d) { return { name: d.name, node: d.node + 1, m: d.m, Ip: d.Ip, Id: d.Id }; }),
      bearings: p.bearings.map(function (r, i) {
        var b = m.bearings[i], kc = bearingKC(b, self.a.op_max * RPM);
        return { name: r.name, type: r.type, node: b.node + 1, z: m.nodesPos[b.node], load: self.loads[i], K: kc.K, C: kc.C, variable: !!b.speeds };
      })
    };
  };
  Job.prototype._bearings = function () {
    var self = this, a = this.a, out = [];
    var rpm = linspace(Math.max(200, 0.02 * a.speed_max), a.speed_max, 40);
    this.p.bearings.forEach(function (r, i) {
      if (!isFluid(r)) return;
      var W = bearingLoad(self.p, r, i, self.loads), st = function (n, mods) { return bearingState(self.p, r, W, n * RPM, self.tables, mods, true); };
      var pts = rpm.map(function (n) { return st(n); }), op = st(a.op_max), opCold = st(a.op_max, { crMode: 'cold' });
      var gs = geoGrid(r, op.m).map(function (x) { return self.tables[x.geo.key]; });
      var Smin = Infinity, Smax = 0, epsMax = 0;
      gs.forEach(function (t) { Smin = Math.min(Smin, Math.min.apply(null, t.S)); Smax = Math.max(Smax, Math.max.apply(null, t.S)); epsMax = Math.max(epsMax, Math.max.apply(null, t.eps)); });
      var below = rpm.filter(function (n, k) { return pts[k].below; }), above = rpm.filter(function (n, k) { return pts[k].above; });
      out.push({ name: r.name, type: r.type, D: r.D, Lb: r.Lb, Cr: r.Cr, oil: r.oil, T: op.Tef, W: W, mu: op.mu, thermal: op.thermal,
                 calc: op.calc, opCold: opCold, pspec: W / (num(r.Lb, 0) * num(r.D, 0) * 1e-6) / 1e6, rpm: rpm, pts: pts, op: op,
                 Srange: [Smin, Smax], epsMax: epsMax,
                 belowUpTo: below.length ? Math.max.apply(null, below) : null, aboveFrom: above.length ? Math.min.apply(null, above) : null });
    });
    return out;
  };
  Job.prototype._campbell = function (speeds, pts) {
    var a = this.a, crit = criticalSpeeds({ speeds: speeds, pts: pts }).filter(function (c) { return toCpm(c.speed) > 0.01 * a.speed_max; });
    return { rpm: speeds.map(toCpm), pts: pts.map(function (m) { return { wd: m.wd.map(toCpm), whirl: m.whirl, zeta: m.zeta, logdec: m.logdec }; }),
             crit: crit.map(function (c) { var r = toCpm(c.speed); return { mode: c.mode, rpm: r, logdec: c.logdec, inRange: r >= a.op_min && r <= a.op_max }; }) };
  };
  Job.prototype._modes = function () {
    var a = this.a, full = modal(this.model, a.mode_speed * RPM, Math.max(4, Math.round(a.n_modes)) + 6), m = filterModes(full, 0.5);
    return { rpm: a.mode_speed, omitted: full.wd.length - m.wd.length, z: this.model.nodesPos.slice(),
             list: m.wd.map(function (w, i) {
               var s = m.shapes[i], env = s.Xr.map(function (_, k) { return majorAxis({ re: s.Xr[k], im: s.Xi[k] }, { re: s.Yr[k], im: s.Yi[k] }); });
               var mx = Math.max.apply(null, env);
               return { hz: w / TWO_PI, cpm: toCpm(w), logdec: m.logdec[i], zeta: m.zeta[i], whirl: m.whirl[i],
                        X: s.Xr.map(function (v) { return v / mx; }), Y: s.Yr.map(function (v) { return v / mx; }), env: env.map(function (v) { return v / mx; }) };
             }) };
  };
  Job.prototype._probes = function () {
    var nn = this.model.nNodes;
    var nodes = String(this.a.probes || '').replace(/;/g, ',').split(',').map(function (t) { return parseInt(t, 10); })
      .filter(function (n) { return n >= 1 && n <= nn; });
    if (!nodes.length) nodes = this.model.bearings.filter(function (b) { return b.isSupport; }).map(function (b) { return b.node + 1; });
    return nodes.filter(function (n, i, arr) { return arr.indexOf(n) === i; });
  };
  Job.prototype._unbalanceSetup = function () {
    var a = this.a, m = this.model, lines = [], cases = [];
    var iso = standards.isoPermissible(Number(a.G), m.mass, a.op_max);
    lines.push('ISO 21940-11 G' + a.G + ': U_per = ' + fmt(iso.U_per_gmm, 1) + ' g·mm, e_per = ' + fmt(iso.e_per_um, 3) + ' µm');
    var nA = Math.round(a.plane_A), nB = Math.round(a.plane_B), planes = Math.round(a.planes), alloc = null;
    if (planes === 1) {
      cases.push({ name: 'ISO 1 plano', ubs: [{ node: nA - 1, U: iso.U_per_gmm * 1e-6, phaseDeg: 0 }] });
      lines.push('  1 plano (nó ' + nA + '): ' + fmt(iso.U_per_gmm, 1) + ' g·mm');
    } else {
      try { alloc = standards.isoTwoPlane(iso.U_per_gmm, m.nodesPos[nA - 1], m.nodesPos[nB - 1], m.cg); }
      catch (e) { alloc = { A: iso.U_per_gmm / 2, B: iso.U_per_gmm / 2 }; lines.push('  Aviso: ' + e.message + '. Usada divisão igual entre os planos.'); this.results.warnings.push(e.message); }
      lines.push('  2 planos: A (nó ' + nA + ') = ' + fmt(alloc.A, 1) + ' g·mm, B (nó ' + nB + ') = ' + fmt(alloc.B, 1) + ' g·mm');
      cases.push({ name: 'ISO estático (em fase)', ubs: [{ node: nA - 1, U: alloc.A * 1e-6, phaseDeg: 0 }, { node: nB - 1, U: alloc.B * 1e-6, phaseDeg: 0 }] });
      cases.push({ name: 'ISO conjugado (180°)', ubs: [{ node: nA - 1, U: alloc.A * 1e-6, phaseDeg: 0 }, { node: nB - 1, U: alloc.B * 1e-6, phaseDeg: 180 }] });
    }
    var W = this.loads.reduce(function (s, x) { return s + x; }, 0) / G_ACCEL, Ua = standards.api617Analysis(W, a.op_max);
    var sup = m.bearings.filter(function (b) { return b.isSupport; }).map(function (b) { return m.nodesPos[b.node]; });
    var zc = sup.length ? sup.reduce(function (s, x) { return s + x; }, 0) / sup.length : m.nodesPos[m.nNodes >> 1], mid = 0;
    m.nodesPos.forEach(function (z, i) { if (Math.abs(z - zc) < Math.abs(m.nodesPos[mid] - zc)) mid = i; });
    cases.push({ name: 'API 617 (Ua no meio do vão)', api: true, ubs: [{ node: mid, U: Ua * 1e-6, phaseDeg: 0 }] });
    lines.push('API 617: Ua = 2·6350·W/N = ' + fmt(Ua, 0) + ' g·mm no nó ' + (mid + 1) + ' (W = ' + fmt(W, 1) + ' kg)');
    cases.forEach(function (c) { c.resp = []; });
    var speeds = linspace(Math.max(100, 0.02 * a.speed_max), a.speed_max, 300).map(function (x) { return x * RPM; });
    return { iso: iso, alloc: alloc, Ua: Ua, W: W, mid: mid + 1, cases: cases, lines: lines, speeds: speeds, ci: 0, si: 0 };
  };
  Job.prototype._unbalanceFinish = function (st) {
    var a = this.a, probes = this._probes(), rpm = st.speeds.map(toCpm), lines = st.lines.slice(), curves = [], checks = [];
    var imc = 0; rpm.forEach(function (r, i) { if (Math.abs(r - a.op_max) < Math.abs(rpm[imc] - a.op_max)) imc = i; });
    st.cases.forEach(function (c) {
      probes.forEach(function (n) {
        var amp = c.resp.map(function (r) { return 1e6 * 2 * majorAxis(r.X[n - 1], r.Y[n - 1]); });
        var ph = c.resp.map(function (r) { return phaseDeg(r.X[n - 1]); });
        var ip = 0; amp.forEach(function (v, i) { if (v > amp[ip]) ip = i; });
        curves.push({ name: c.name, node: n, api: !!c.api, amp: amp, phase: ph, atMcs: amp[imc], max: amp[ip], rpmMax: rpm[ip] });
        lines.push('  ' + c.name + ', nó ' + n + ': ' + fmt(amp[imc], 2) + ' µm pk-pk em ' + fmt(a.op_max, 0) + ' rpm, máx ' + fmt(amp[ip], 2) + ' µm em ' + fmt(rpm[ip], 0) + ' rpm');
        if (c.api) apiChecks(rpm, amp, a).forEach(function (ck) { ck.node = n; checks.push(ck); lines.push('      ' + ck.text); });
      });
    });
    return { rpm: rpm, curves: curves, checks: checks, lines: lines, iso: st.iso, alloc: st.alloc, Ua: st.Ua, W: st.W, mid: st.mid, probes: probes };
  };
  function apiChecks(rpm, amp, a) {
    var out = [];
    for (var i = 1; i < amp.length - 1; i++) {
      if (!(amp[i] >= amp[i - 1] && amp[i] > amp[i + 1])) continue;
      var af = standards.amplificationFactor(rpm, amp, [rpm[Math.max(0, i - 60)], rpm[Math.min(rpm.length - 1, i + 60)]]);
      var ck = standards.separationMarginCheck(af.Nc, af.AF, a.op_min, a.op_max);
      var t = 'pico ' + fmt(af.Nc, 0) + ' rpm: AF = ' + fmt(af.AF, 2);
      t += ck.actual !== null ? ', SM = ' + fmt(ck.actual, 1) + ' % (req. ' + fmt(ck.required, 1) + ' %) → ' + (ck.ok ? 'ATENDE' : 'NÃO ATENDE') : ' – ' + ck.note;
      out.push({ Nc: af.Nc, AF: af.AF, N1: af.N1, N2: af.N2, SM: ck.actual, SMreq: ck.required, ok: ck.ok, note: ck.note, text: t });
    }
    return out;
  }
  Job.prototype._stability = function (sres) {
    var Q = sres.map(function (s) { return s.Q; }), f = sres.map(function (s) { return s.firstForward; }), mn = sres.map(function (s) { return s.minimum; });
    var cross = function (lim) {
      if (!(f[0] >= lim)) return null;
      for (var i = 1; i < f.length; i++) if (f[i] < lim) return Q[i - 1] + (lim - f[i - 1]) * (Q[i] - Q[i - 1]) / (f[i] - f[i - 1]);
      return null;
    };
    return { Q: Q, first: f, min: mn, node: Math.round(this.a.stab_node), rpm: this.a.op_max, ld0: f[0], ok: standards.logdecOk(f[0]),
             Q01: cross(0.1), Q0: cross(0) };
  };

  // ---- sensibilidade: temperatura do óleo e folga ------------------------ //
  // Cada ponto remonta o modelo com todos os mancais hidrodinâmicos alterados juntos e
  // recalcula: 1º modo forward na MCS, menor log dec, 1ª velocidade crítica (secante
  // a partir da crítica nominal do Campbell) e os coeficientes de cada mancal na MCS.
  Job.prototype._sensSetup = function () {
    var a = this.a, dT = Math.abs(num(a.sens_dT, 20)), dC = Math.abs(num(a.sens_dC, 20)), cases = [];
    linspace(-dT, dT, 7).forEach(function (v) { cases.push({ kind: 'T', v: v, mods: { dT: v } }); });
    linspace(-dC, dC, 7).forEach(function (v) { cases.push({ kind: 'C', v: v, mods: { crFactor: 1 + v / 100 } }); });
    cases.push({ kind: 'cold', mods: { crMode: 'cold' } }, { kind: 'hot', mods: { crMode: 'hot' } });
    var c0 = this.results.campbell && this.results.campbell.crit.length ? this.results.campbell.crit[0].rpm : null;
    return { cases: cases, out: [], crit0: c0, dT: dT, dC: dC };
  };
  function firstForward(m) {
    for (var i = 0; i < m.wd.length; i++) if (m.whirl[i] === 'F') return { w: m.wd[i], ld: m.logdec[i] };
    return null;
  }
  Job.prototype._sensPoint = function (c, sn) {
    var self = this, a = this.a, w = a.op_max * RPM, model = buildModel(this.p, this.tables, c.mods, true);
    var m = filterModes(modal(model, w, Math.round(a.n_modes)), 0.5), f = firstForward(m);
    var out = { kind: c.kind, v: c.v, f1: f ? toCpm(f.w) : NaN, ld1: f ? f.ld : NaN,
                ldmin: m.logdec.length ? Math.min.apply(null, m.logdec) : NaN, crit: NaN, brg: [] };
    if (sn.crit0) {                                        // ωd(Ω) = Ω no ramo forward mais próximo
      var g = function (rpm) {
        var mm = filterModes(modal(model, rpm * RPM, Math.round(a.n_modes)), 0.5), best = null;
        mm.wd.forEach(function (wd, i) { if (mm.whirl[i] === 'F' && (best === null || Math.abs(toCpm(wd) - rpm) < Math.abs(best - rpm))) best = toCpm(wd); });
        return best === null ? NaN : best - rpm;
      };
      try { var x = secant(g, sn.crit0, sn.crit0 * 1.03, 0.5, 12); if (isFinite(x) && x > 0 && x < 2 * a.speed_max) out.crit = x; } catch (e) { /* sem convergência */ }
    }
    this.p.bearings.forEach(function (r, i) {
      if (!isFluid(r)) return;
      var W = bearingLoad(self.p, r, i, self.loads);
      var q = bearingState(self.p, r, W, w, self.tables, c.mods, true);
      out.brg.push({ name: r.name, T: q.Tef, Tout: q.Tout, dT: q.dT, mu: q.mu, cr: q.cr, m: q.m, S: q.S, eps: q.eps, hmin: q.hmin_um,
                     power: q.power, Qsup: q.Qsup,
                     kxx: q.Kdim[0][0], kyy: q.Kdim[1][1], kxy: q.Kdim[0][1], kyx: q.Kdim[1][0], cxx: q.Cdim[0][0], cyy: q.Cdim[1][1] });
    });
    return out;
  };
  Job.prototype._sensFinish = function (sn) {
    var pick = function (k) { return sn.out.filter(function (o) { return o.kind === k; }); };
    return { dT: sn.dT, dC: sn.dC, T: pick('T'), C: pick('C'), cold: pick('cold')[0], hot: pick('hot')[0], hasCrit: !!sn.crit0 };
  };

  // ---- relatório --------------------------------------------------------- //
  Job.prototype._report = function () {
    var R = this.results, a = this.a, L = [], s = R.summary;
    L.push('ROTORDIN — ' + (this.p.name || 'Rotor'));
    L.push('Nós: ' + s.nNodes + '   Elementos: ' + (s.nNodes - 1) + '   GDL: ' + s.ndof);
    L.push('Comprimento: ' + fmt(s.length, 4) + ' m   Massa: ' + fmt(s.mass, 2) + ' kg   CG: z = ' + fmt(s.cg, 4) + ' m');
    s.disks.forEach(function (d) { L.push("  Massa '" + d.name + "': nó " + d.node + ', m=' + fmt(d.m, 2) + ' kg, Ip=' + fmt(d.Ip, 4) + ', Id=' + fmt(d.Id, 4) + ' kg·m²'); });
    L.push('', 'Mancais (carga estática pelo peso próprio):');
    s.bearings.forEach(function (b) {
      L.push("  " + b.name + ' (' + b.type + '): nó ' + b.node + ', z = ' + fmt(b.z, 4) + ' m, W = ' + fmt(b.load, 0) + ' N (' + fmt(b.load / G_ACCEL, 1) + ' kgf)');
      if (b.variable) L.push('    em ' + fmt(a.op_max, 0) + ' rpm: kxx=' + fexp(b.K[0][0]) + ' kxy=' + fexp(b.K[0][1]) + ' kyx=' + fexp(b.K[1][0]) + ' kyy=' + fexp(b.K[1][1]) + ' N/m | cxx=' + fexp(b.C[0][0]) + ' cyy=' + fexp(b.C[1][1]) + ' N·s/m');
    });
    if (R.bearings && R.bearings.length) {
      L.push('', 'MANCAIS HIDRODINÂMICOS (Reynolds + interpolação por Sommerfeld)');
      R.bearings.forEach(function (b) {
        var o = b.op;
        L.push(b.name + ' (' + b.type + '): D=' + b.D + ' mm, L=' + b.Lb + ' mm, ' + b.oil + ' a ' + fmt(b.T, 1) + ' °C (μ = ' + fmt(b.mu * 1e3, 2) + ' mPa·s), W = ' + fmt(b.W, 0) + ' N');
        var th = b.thermal, o0 = b.op;
        L.push('  Térmica ' + (b.calc ? 'calculada (balanço)' : 'informada') + ': T entrada ' + (b.calc ? fmt(o0.Tin, 1) : '—') + ' °C, ΔT ' + fmt(o0.dT, 1) +
               ' °C, T efetiva ' + fmt(o0.Tef, 1) + ' °C, T saída ' + (b.calc ? fmt(o0.Tout, 1) : fmt(o0.Tef + (1 - 0.75) * o0.dT, 1) + ' (est.)') +
               ' °C, T munhão ' + fmt(o0.Tj, 1) + ' °C, T mancal ' + fmt(o0.Th, 1) + ' °C');
        L.push('  Perda de potência ' + fmt(o0.power / 1000, 2) + ' kW; vazão de alimentação ' + fmt(o0.Qsup * 6e4, 2) + ' L/min (vazamento lateral ' + fmt(o0.Qs * 6e4, 2) + ' L/min)');
        L.push('  Folga radial: a frio ' + fmt(th.cold, 1) + ' µm → a quente ' + fmt(th.hot, 1) + ' µm ' +
               (th.given ? '(informada)' : '(dilatação: mancal ' + (th.dRb >= 0 ? '+' : '') + fmt(th.dRb, 1) + ' µm, α=' + fmt(th.ab, 1) +
               '; munhão ' + (th.dRj >= 0 ? '+' : '') + fmt(th.dRj, 1) + ' µm, α=' + fmt(th.aj, 1) + '; montagem ' + fmt(th.Tm, 0) + ' °C)'));
        if (o0.eBore !== null) L.push('  Excentricidade do furo ' + fmt(o0.eBore, 1) + ' µm → pré-carga a frio ' + fmt(o0.mCold, 3) + ', de operação ' + fmt(o0.m, 3));
        L.push('  Pressão específica W/(L·D) = ' + fmt(b.pspec, 3) + ' MPa');
        L.push('  Com a folga a frio em ' + fmt(a.op_max, 0) + ' rpm: ε = ' + fmt(b.opCold.eps, 3) + ', h_min = ' + fmt(b.opCold.hmin_um, 1) +
               ' µm, kyy = ' + fexp(b.opCold.Kdim[1][1], 3) + ' N/m, cyy = ' + fexp(b.opCold.Cdim[1][1], 3) + ' N·s/m');
        L.push('  Em ' + fmt(a.op_max, 0) + ' rpm: S = ' + Number(o.S).toPrecision(4) + ', ε = ' + fmt(o.eps, 3) + ', atitude = ' + fmt(o.att, 1) + '°, h_min = ' + fmt(o.hmin_um, 1) + ' µm');
        L.push('  K [N/m]:   kxx=' + fexp(o.Kdim[0][0], 4) + '  kxy=' + fexp(o.Kdim[0][1], 4) + '  kyx=' + fexp(o.Kdim[1][0], 4) + '  kyy=' + fexp(o.Kdim[1][1], 4));
        L.push('  C [N·s/m]: cxx=' + fexp(o.Cdim[0][0], 4) + '  cxy=' + fexp(o.Cdim[0][1], 4) + '  cyx=' + fexp(o.Cdim[1][0], 4) + '  cyy=' + fexp(o.Cdim[1][1], 4));
        L.push('  Faixa da tabela: S = ' + Number(b.Srange[0]).toPrecision(3) + ' a ' + Number(b.Srange[1]).toPrecision(3));
        if (b.belowUpTo !== null) L.push('  AVISO: até ' + fmt(b.belowUpTo, 0) + ' rpm, S abaixo do mínimo tabelado (ε > ' + fmt(b.epsMax, 2) + '); extremo mantido');
        if (b.aboveFrom !== null) L.push('  AVISO: a partir de ' + fmt(b.aboveFrom, 0) + ' rpm, S acima do máximo tabelado; extremo mantido');
      });
    }
    if (R.deflection) {
      var d = R.deflection;
      L.push('', 'FLECHA ESTÁTICA (peso próprio)',
        'Eixo sobre apoios rígidos: flecha máxima ' + fmt(d.maxRigid.value, 2) + ' µm em z = ' + fmt(d.maxRigid.z, 1) + ' mm (perto do nó ' + d.maxRigid.node + ', ' + d.maxRigid.where + ')',
        'Linha de centro com o munhão na posição de equilíbrio (' + fmt(d.rpm, 0) + ' rpm): ' + fmt(d.maxTotal.value, 2) + ' µm em z = ' + fmt(d.maxTotal.z, 1) + ' mm (' + d.maxTotal.where + ')');
      d.bearings.forEach(function (b) {
        L.push('  ' + b.name + ' (nó ' + b.node + '): reação ' + fmt(b.load, 0) + ' N, munhão Δy = ' + fmt(b.dy, 1) + ' µm' +
               (b.eps !== undefined ? ' (ε = ' + fmt(b.eps, 3) + ', atitude ' + fmt(b.att, 1) + '°, Δx = ' + fmt(b.dx, 1) + ' µm)' : '') +
               ', inclinação do eixo ' + fmt(b.slopeRigid, 3) + ' mrad (apoio rígido) / ' + fmt(b.slopeTotal, 3) + ' mrad (real)');
      });
    }
    if (R.campbell) {
      L.push('', 'DIAGRAMA DE CAMPBELL', 'Velocidades críticas (1X, forward):');
      if (!R.campbell.crit.length) L.push('  nenhuma na faixa analisada');
      R.campbell.crit.forEach(function (c) { L.push('  modo ' + c.mode + ': ' + fmt(c.rpm, 0) + ' rpm, log dec = ' + fmt(c.logdec, 3) + (c.inRange ? '  DENTRO da faixa de operação' : '')); });
    }
    if (R.modes) {
      L.push('', 'ANÁLISE MODAL AMORTECIDA', 'Rotação: ' + fmt(R.modes.rpm, 0) + ' rpm',
             'Modo    fd [Hz]   fd [rpm]   log dec       ζ Precessão');
      R.modes.list.forEach(function (m, i) {
        L.push(pad(i + 1, 4) + ' ' + pad(fmt(m.hz, 2), 10) + ' ' + pad(fmt(m.cpm, 0), 10) + ' ' + pad(fmt(m.logdec, 3), 9) + ' ' + pad(fmt(m.zeta, 4), 7) + ' ' + pad(m.whirl, 9));
      });
      if (R.modes.omitted) L.push('(' + R.modes.omitted + ' modo(s) com ζ > 0,5 – superamortecidos – omitido(s))');
    }
    if (R.unbalance) { L.push('', 'RESPOSTA AO DESBALANCEAMENTO'); R.unbalance.lines.forEach(function (x) { L.push(x); }); }
    if (R.stability) {
      var st = R.stability;
      L.push('', 'ESTABILIDADE', 'Log dec 1º modo forward em ' + fmt(st.rpm, 0) + ' rpm (Q = 0): ' + fmt(st.ld0, 3) + ' → ' + (st.ok ? 'ATENDE' : 'NÃO ATENDE') + ' δ ≥ 0,1');
      if (st.Q01 !== null) L.push('  Rigidez cruzada no nó ' + st.node + ' que reduz δ a 0,1: ' + fmt(st.Q01 / 1e6, 2) + ' MN/m');
      if (st.Q0 !== null) L.push('  Limiar de instabilidade (δ = 0): ' + fmt(st.Q0 / 1e6, 2) + ' MN/m');
    }
    if (R.sensitivity) {
      var S2 = R.sensitivity, row = function (o, lab) {
        return '  ' + lab + ': 1º forward ' + fmt(o.f1, 0) + ' cpm, δ = ' + fmt(o.ld1, 3) + ', δ mín = ' + fmt(o.ldmin, 3) +
               (S2.hasCrit ? ', 1ª crítica ' + (isFinite(o.crit) ? fmt(o.crit, 0) + ' rpm' : 'não identificada (modo forward com ζ > 0,5, praticamente sem ressonância)') : '') + ' | ' +
               o.brg.map(function (b) { return b.name + ': T ef ' + fmt(b.T, 1) + ' °C, C ' + fmt(b.cr, 1) + ' µm, h_min ' + fmt(b.hmin, 1) + ' µm, kyy ' + fexp(b.kyy, 2) + ', ' + fmt(b.power / 1000, 2) + ' kW, ' + fmt(b.Qsup * 6e4, 1) + ' L/min'; }).join('; ');
      };
      L.push('', 'SENSIBILIDADE — TEMPERATURA DO ÓLEO (entrada, se térmica calculada) E FOLGA DE FABRICAÇÃO (em ' + fmt(a.op_max, 0) + ' rpm)');
      L.push(row(S2.cold, 'Folga a frio'), row(S2.hot, 'Folga a quente'));
      S2.T.forEach(function (o) { L.push(row(o, 'T ' + (o.v >= 0 ? '+' : '') + fmt(o.v, 1) + ' °C')); });
      S2.C.forEach(function (o) { L.push(row(o, 'Folga ' + (o.v >= 0 ? '+' : '') + fmt(o.v, 1) + ' %')); });
    }
    return L.join('\n');
    function pad(v, n) { v = String(v); while (v.length < n) v = ' ' + v; return v; }
  };

  // Execução síncrona completa (testes em Node / scripts)
  function run(params, opts) {
    var job = new Job(params, opts);
    while (!job.step(Infinity).done) { /* continua */ }
    return job.results;
  }

  // ======================================================================= //
  // API pública
  // ======================================================================= //
  return {
    version: '1.0.0',
    RPM: RPM,
    SCHEMA: SCHEMA, MATERIALS: MATERIALS, BEARING_TYPES: BEARING_TYPES, OILS: OILS,
    DEFAULT_ANALYSIS: DEFAULT_ANALYSIS, blankRow: blankRow,
    isFluidBearing: isFluid,
    validate: validate, nodePositionsMm: nodePositionsMm, staticLoads: staticLoads, bearingThermal: bearingThermal, deflection: deflection,
    requiredGeometries: requiredGeometries, buildModel: buildModel,
    diskFromGeometry: diskFromGeometry, bladeRow: bladeRow,
    modal: modal, filterModes: filterModes, criticalSpeeds: criticalSpeeds,
    unbalanceAt: unbalanceAt, majorAxis: majorAxis, stabilityPoint: stabilityPoint,
    standards: standards,
    Job: Job, run: run,
    fluid: { makeGeometry: makeGeometry, geometryForRow: geometryForRow, FluidModel: FluidModel, ReynoldsPad: ReynoldsPad,
             makePad: makePad, tableBuilder: tableBuilder, buildTable: buildTable, interpTable: interpTable,
             oilViscosity: oilViscosity, oilDensity: oilDensity, oilCp: oilCp, bearingState: bearingState, geoGrid: geoGrid, PRELOAD_STEP: PRELOAD_STEP },
    _linalg: { eigvals: eigvals, luFactor: luFactor, luSolve: luSolve, cluFactor: cluFactor, cluSolve: cluSolve, bandSolve: bandSolve }
  };



});
