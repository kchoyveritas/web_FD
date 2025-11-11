/*
  test1.js
  JavaScript port of key functionality from the original Python `test1.py`.
  This file intentionally implements the calculation and helper utilities only
  (no GUI). It provides:
    - CROSS_SECTIONS, MATERIAL_E_RANGES, MATERIAL_DEFAULT_E
    - clamp(x, lo, hi)
    - calculateCantileverDeflection(L_mm, F_g, E_GPa, I_10_15, numPoints)
    - calculateFDrate(L_mm, E_GPa, I_10_15) // returns g per mm for 1 mm deflection

  Usage (Node):
    node test1.js

*/

const CROSS_SECTIONS = {
  "0.009 Round": 0.13,
  "0.010 Round": 0.20,
  "0.012 Round": 0.42,
  "0.014 Round": 0.78,
  "0.016 Round": 1.34,
  "0.017 Round": 1.71,
  "0.018 Round": 2.14,
  "0.019 Round": 2.66,
  "0.020 Round": 3.27,
  "0.021 Round": 3.97,
  "0.022 Round": 4.79,
  "0.010x0.020 Rect": 0.69,
  "0.016x0.022 Rect": 3.13,
  "0.017x0.025 Rect": 4.26,
  "0.018x0.025 Rect": 5.06,
  "0.019x0.025 Rect": 5.95,
  "0.021x0.025 Rect": 8.03,
  "0.022x0.028 Rect": 10.34
};

const MATERIAL_E_RANGES = {
  "Stainless Steel": [190.0, 207.0],
  "Beta Titanium": [82.8, 93.2],
  "Nickel Titanium": [14.5, 58.0]
};

const MATERIAL_DEFAULT_E = {
  "Stainless Steel": 207.0,
  "Beta Titanium": 87.0,
  "Nickel Titanium": 14.5
};

function clamp(value, lower, upper) {
  const v = Number(value);
  if (Number.isNaN(v)) return lower;
  return Math.max(lower, Math.min(upper, v));
}

/**
 * calculateCantileverDeflection
 * L_mm: length in mm
 * F_g: force in grams
 * E_GPa: Young's modulus in GPa
 * I_10_15: moment of inertia in m^4 × 10^-15
 * numPoints: number of sample points (default 100)
 * Returns: { x_mm: Float32Array, deflection_mm: Float32Array }
 */
function calculateCantileverDeflection(L_mm, F_g, E_GPa, I_10_15, numPoints = 100) {
  // unit conversions
  const L_m = Number(L_mm) / 1000.0;
  // grams-force to Newtons: 1 gf ~= 0.00981 N (approx)
  const F_N = Number(F_g) * 0.00981;
  const E_Pa = Number(E_GPa) * 1e9;
  const I_m4 = Number(I_10_15) * 1e-15;

  const n = Math.max(2, Math.floor(numPoints));
  const x_mm = new Float64Array(n);
  const deflection_mm = new Float64Array(n);

  if (L_m <= 0 || E_Pa <= 0 || I_m4 <= 0) {
    for (let i = 0; i < n; i++) {
      x_mm[i] = (i / (n - 1)) * L_mm;
      deflection_mm[i] = 0.0;
    }
    return { x_mm, deflection_mm };
  }

  for (let i = 0; i < n; i++) {
    const x_m = (i / (n - 1)) * L_m;
    // y(x) = (F * x^2 / (6 * E * I)) * (3L - x)
    const y_m = (F_N * x_m * x_m / (6.0 * E_Pa * I_m4)) * (3.0 * L_m - x_m);
    x_mm[i] = x_m * 1000.0;
    deflection_mm[i] = y_m * 1000.0;
  }
  return { x_mm, deflection_mm };
}

/**
 * calculateFDrate
 * Calculate grams required to produce 1 mm deflection using cantilever formula
 * Returns grams-force (g) per mm (i.e., g/mm for δ = 1 mm)
 */
function calculateFDrate(L_mm, E_GPa, I_10_15) {
  const L_m = Number(L_mm) / 1000.0;
  const E_Pa = Number(E_GPa) * 1e9;
  const I_m4 = Number(I_10_15) * 1e-15;
  if (L_m <= 0 || E_Pa <= 0 || I_m4 <= 0) return NaN;
  const delta_m = 1e-3; // 1 mm
  const F_N = delta_m * 3.0 * E_Pa * I_m4 / Math.pow(L_m, 3);
  const F_g = F_N / 0.00981;
  return F_g; // grams for 1 mm deflection
}

// Simple colormap helper: interpolate between colors given as hex strings
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16)
  };
}
function rgbToHex({ r, g, b }) {
  const toP = (v) => Math.round(v).toString(16).padStart(2, '0');
  return `#${toP(r)}${toP(g)}${toP(b)}`;
}
function lerp(a, b, t) { return a + (b - a) * t; }
function interpolateColor(hexA, hexB, t) {
  const A = hexToRgb(hexA);
  const B = hexToRgb(hexB);
  return rgbToHex({ r: lerp(A.r, B.r, t), g: lerp(A.g, B.g, t), b: lerp(A.b, B.b, t) });
}

/**
 * colorForE(E_GPa)
 * Maps E in [14.5, 207] to a color gradient: blue -> purple -> gray
 */
function colorForE(E_GPa) {
  const E_min = 14.5, E_max = 207.0;
  let norm = (Number(E_GPa) - E_min) / (E_max - E_min);
  norm = Math.max(0, Math.min(1, norm));
  // split 0..0.5 -> blue to purple, 0.5..1 -> purple to gray
  if (norm <= 0.5) {
    const t = norm / 0.5;
    return interpolateColor('#0000ff', '#800080', t);
  } else {
    const t = (norm - 0.5) / 0.5;
    return interpolateColor('#800080', '#808080', t);
  }
}

// Export for Node/browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CROSS_SECTIONS,
    MATERIAL_E_RANGES,
    MATERIAL_DEFAULT_E,
    clamp,
    calculateCantileverDeflection,
    calculateFDrate,
    colorForE
  };
}

// Expose as browser global for simple consumption from an HTML page
try {
  if (typeof window !== 'undefined') {
    window.FD = window.FD || {};
    Object.assign(window.FD, {
      CROSS_SECTIONS,
      MATERIAL_E_RANGES,
      MATERIAL_DEFAULT_E,
      clamp,
      calculateCantileverDeflection,
      calculateFDrate,
      colorForE
    });
  }
} catch (e) {
  // ignore in non-browser environments
}

// Quick command-line test when run with node
if (typeof require !== 'undefined' && require.main === module) {
  const L = 7.0; // mm
  const F = 100.0; // g
  const E = 207.0; // GPa
  const I = CROSS_SECTIONS['0.016 Round'];
  console.log('Sample parameters:');
  console.log({ L, F, E, I });
  const res = calculateCantileverDeflection(L, F, E, I, 11);
  console.log('x positions (mm):', Array.from(res.x_mm).map(v => Number(v.toFixed(3))));
  console.log('deflections (mm):', Array.from(res.deflection_mm).map(v => Number(v.toFixed(6))));
  console.log('F/Δ (g/mm) for 1 mm:', Number(calculateFDrate(L, E, I).toFixed(3)));
  console.log('color for E:', colorForE(E));
}
