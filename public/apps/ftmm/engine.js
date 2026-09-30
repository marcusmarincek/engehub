// ============================================================================
// MOTOR — conversão pés/polegadas <-> milímetros. Só matemática, sem DOM,
// sem fetch (ver ARCHITECTURE.md, seção "Separação engine.js / ui.js").
// ============================================================================
(function () {
  'use strict';

  const MM_PER_INCH = 25.4;

  function gcd(a, b) {
    a = Math.abs(a); b = Math.abs(b);
    return b === 0 ? a : gcd(b, a % b);
  }

  // Aceita "3 1/2", "3-1/2", "1/2", "3.5", "3,5" -> polegadas decimais.
  function parseInches(raw) {
    if (raw === null || raw === undefined) return 0;
    const str = String(raw).trim().replace(',', '.');
    if (!str) return 0;
    const fracMatch = str.match(/^(-?\d+(?:\.\d+)?)?[\s-]*(\d+)\s*\/\s*(\d+)$/);
    if (fracMatch) {
      const whole = fracMatch[1] ? parseFloat(fracMatch[1]) : 0;
      const num = parseFloat(fracMatch[2]);
      const den = parseFloat(fracMatch[3]);
      if (!den) return whole;
      const sign = whole < 0 ? -1 : 1;
      return whole + sign * (num / den);
    }
    const val = parseFloat(str);
    return isNaN(val) ? 0 : val;
  }

  // pés + polegadas (decimal ou fração) -> milímetros
  function ftInToMm(feetRaw, inchesRaw) {
    const f = parseFloat(feetRaw);
    const feet = isNaN(f) ? 0 : f;
    const inches = parseInches(inchesRaw);
    return (feet * 12 + inches) * MM_PER_INCH;
  }

  // milímetros -> pés + polegadas, arredondado para a fração mais próxima
  // de 1/denom (denom tipicamente 2, 4, 8, 16, 32 ou 64).
  function mmToFtInFraction(mmRaw, denom) {
    const mm = parseFloat(mmRaw);
    const d = denom || 16;
    if (isNaN(mm)) {
      return { sign: 1, feet: 0, wholeInches: 0, fracLabel: '', label: '0\' 0"', decimalFeet: 0, decimalInches: 0 };
    }
    const totalInches = mm / MM_PER_INCH;
    const sign = totalInches < 0 ? -1 : 1;
    const absInches = Math.abs(totalInches);
    const totalUnits = Math.round(absInches * d);
    const unitsPerFoot = d * 12;
    const feet = Math.floor(totalUnits / unitsPerFoot);
    const remUnits = totalUnits % unitsPerFoot;
    const wholeInches = Math.floor(remUnits / d);
    const numerator = remUnits % d;
    let fracLabel = '';
    if (numerator !== 0) {
      const g = gcd(numerator, d);
      fracLabel = (numerator / g) + '/' + (d / g);
    }
    const inchesLabel = fracLabel ? (wholeInches + ' ' + fracLabel + '"') : (wholeInches + '"');
    return {
      sign,
      feet,
      wholeInches,
      fracLabel,
      label: (sign < 0 ? '-' : '') + feet + '\' ' + inchesLabel,
      decimalFeet: sign * (totalUnits / unitsPerFoot),
      decimalInches: sign * absInches
    };
  }

  window.Engine = { MM_PER_INCH, gcd, parseInches, ftInToMm, mmToFtInFraction };
})();
