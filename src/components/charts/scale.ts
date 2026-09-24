/**
 * Small, dependency-free scale helpers for the SVG charts.
 */

/** A "nice" step (1, 2, 2.5 or 5 × 10^n) so ticks read as round numbers. */
export function niceStep(roughStep: number) {
  if (!Number.isFinite(roughStep) || roughStep <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const residual = roughStep / magnitude;
  const nice = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 2.5 ? 2.5 : residual <= 5 ? 5 : 10;
  return nice * magnitude;
}

export type LinearScale = {
  min: number;
  max: number;
  ticks: number[];
  /** Maps a value to a pixel between `rangeStart` (min) and `rangeEnd` (max). */
  map: (value: number) => number;
};

/**
 * Linear scale over `values` that always includes zero (bars grow from a real baseline)
 * with about `tickCount` round ticks.
 */
export function linearScale(values: number[], rangeStart: number, rangeEnd: number, tickCount = 4): LinearScale {
  const finite = values.filter(Number.isFinite);
  let low = Math.min(0, ...finite);
  let high = Math.max(0, ...finite);
  if (low === high) high = low + 1;
  const step = niceStep((high - low) / Math.max(1, tickCount));
  low = Math.floor(low / step) * step;
  high = Math.ceil(high / step) * step;
  const ticks: number[] = [];
  // Rounded to the step's precision to avoid 0.30000000000000004-style labels.
  const precision = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  for (let tick = low; tick <= high + step / 2; tick += step) ticks.push(Number(tick.toFixed(precision)));
  const span = high - low;
  return {
    min: low,
    max: high,
    ticks,
    map: (value: number) => rangeStart + ((value - low) / span) * (rangeEnd - rangeStart),
  };
}

/** Band scale: `count` equal slots across `[start, end]`; returns the slot start and width. */
export function bandScale(count: number, start: number, end: number, paddingRatio = 0.2) {
  const slot = count > 0 ? (end - start) / count : 0;
  const padding = slot * paddingRatio;
  return {
    slot,
    bandwidth: Math.max(0, slot - padding),
    x: (index: number) => start + index * slot + padding / 2,
    center: (index: number) => start + index * slot + slot / 2,
  };
}

/** Which x labels to draw so they never collide: every label, every 2nd, every 3rd… (the last is always kept). */
export function labelStride(count: number, width: number, minLabelWidth = 44) {
  if (count <= 0 || width <= 0) return 1;
  return Math.max(1, Math.ceil((count * minLabelWidth) / width));
}

const compactFormatters = new Map<string, Intl.NumberFormat>();

/** Axis label: "12 mil €", "1,2 M€" (es-ES compact notation). */
export function formatCompactMoney(value: number, currencyCode = "EUR") {
  let formatter = compactFormatters.get(currencyCode);
  if (!formatter) {
    // minimumFractionDigits must be explicit: older ICU builds (Node 22) otherwise
    // keep the currency minimum and render "12,0 mil €" instead of "12 mil €".
    formatter = new Intl.NumberFormat("es-ES", { style: "currency", currency: currencyCode, notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1 });
    compactFormatters.set(currencyCode, formatter);
  }
  return formatter.format(value);
}
