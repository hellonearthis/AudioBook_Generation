/**
 * Pure functional color contrast solver adhering to WCAG 2.1 specifications
 * and the Antigravity Brand-Safe Contrast Protocol.
 */

function hexToRgb(hex) {
  const cleanHex = hex.replace('#', '');
  if (cleanHex.length === 3) {
    return {
      r: parseInt(cleanHex[0] + cleanHex[0], 16),
      g: parseInt(cleanHex[1] + cleanHex[1], 16),
      b: parseInt(cleanHex[2] + cleanHex[2], 16)
    };
  }
  return {
    r: parseInt(cleanHex.substring(0, 2), 16),
    g: parseInt(cleanHex.substring(2, 4), 16),
    b: parseInt(cleanHex.substring(4, 6), 16)
  };
}

function rgbToHex(r, g, b) {
  const clamp = (val) => Math.max(0, Math.min(255, Math.round(val)));
  const toHex = (c) => clamp(c).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function getRelativeLuminance(rgb) {
  const { r, g, b } = rgb;
  const [rs, gs, bs] = [r / 255, g / 255, b / 255].map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function getContrastRatio(colorA, colorB) {
  const rgbA = typeof colorA === 'string' ? hexToRgb(colorA) : colorA;
  const rgbB = typeof colorB === 'string' ? hexToRgb(colorB) : colorB;
  const lumA = getRelativeLuminance(rgbA);
  const lumB = getRelativeLuminance(rgbB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

function rgbToHsl(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      case bn:
        h = (rn - gn) / d + 4;
        break;
    }
    h /= 6;
  }

  return { h, s, l };
}

function hslToRgb(h, s, l) {
  let r, g, b;

  if (s === 0) {
    r = g = b = l; // achromatic
  } else {
    const hue2rgb = (p, q, t) => {
      let tc = t;
      if (tc < 0) tc += 1;
      if (tc > 1) tc -= 1;
      if (tc < 1 / 6) return p + (q - p) * 6 * tc;
      if (tc < 1 / 2) return q;
      if (tc < 2 / 3) return p + (q - p) * (2 / 3 - tc) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255)
  };
}

function solveBrandSafeLightness(tokenHex, backgroundHex, targetRatio = 4.5, isLightMode = false) {
  const bgRgb = hexToRgb(backgroundHex);
  const bgLum = getRelativeLuminance(bgRgb);
  const tokenRgb = hexToRgb(tokenHex);
  const initialHsl = rgbToHsl(tokenRgb.r, tokenRgb.g, tokenRgb.b);

  let workingHsl = { ...initialHsl };
  let currentRgb = hslToRgb(workingHsl.h, workingHsl.s, workingHsl.l);
  let currentRatio = getContrastRatio(currentRgb, bgRgb);

  let iterations = 0;
  while (currentRatio < targetRatio && iterations < 150) {
    iterations += 1;
    if (isLightMode) {
      workingHsl.l -= 0.01;
      if (workingHsl.l <= 0.10) {
        workingHsl.s = Math.min(1.0, workingHsl.s + 0.05);
      }
      if (workingHsl.l <= 0) break;
    } else {
      workingHsl.l += 0.01;
      if (workingHsl.l >= 0.85) {
        workingHsl.s = Math.max(0.0, workingHsl.s - 0.05);
      }
      if (workingHsl.l >= 1) break;
    }
    currentRgb = hslToRgb(workingHsl.h, workingHsl.s, workingHsl.l);
    currentRatio = getContrastRatio(currentRgb, bgRgb);
  }

  return {
    originalHex: tokenHex,
    solvedHex: rgbToHex(currentRgb.r, currentRgb.g, currentRgb.b),
    contrastRatio: currentRatio,
    iterations
  };
}

module.exports = {
  hexToRgb,
  rgbToHex,
  getRelativeLuminance,
  getContrastRatio,
  rgbToHsl,
  hslToRgb,
  solveBrandSafeLightness
};

