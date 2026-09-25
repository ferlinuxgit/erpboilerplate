import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contraste WCAG 2.2 AA calculado desde los tokens de `globals.css` para los 8 temas.
 * - Texto de StatusBadge / InlineAlert (tono al 10 % sobre cualquier superficie): ≥ 4,5:1.
 * - Enlaces (`--link`) sobre las superficies: ≥ 4,5:1.
 * - Anillo de foco (`--focus-accent`) sobre las superficies: ≥ 3:1 (WCAG 1.4.11).
 */

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function themeBlock(selector: string) {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`Falta el bloque ${selector} en globals.css`);
  const body = css.slice(start, css.indexOf("\n}", start));
  const vars: Record<string, string> = {};
  for (const match of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) vars[match[1]] = match[2].trim();
  return vars;
}

const root = themeBlock(":root");
const dark = themeBlock(".dark");
const themed = (id: string) => themeBlock(`:root[data-theme="${id}"]`);

// Los temas oscuros llevan además la clase `.dark` (ver `themeInitializationScript`).
const themeTokens: Record<string, Record<string, string>> = {
  "classic-light": root,
  "mono-white": { ...root, ...themed("mono-white") },
  "paper-light": { ...root, ...themed("paper-light") },
  "os2-light": { ...root, ...themed("os2-light") },
  "midnight-dark": { ...root, ...dark },
  "mono-black": { ...root, ...dark, ...themed("mono-black") },
  "dos-green": { ...root, ...dark, ...themed("dos-green") },
  "amber-dark": { ...root, ...dark, ...themed("amber-dark") },
};

type Rgb = [number, number, number];

function resolveToken(tokens: Record<string, string>, name: string) {
  let value = tokens[name];
  for (let depth = 0; value?.startsWith("var(") && depth < 5; depth += 1) value = tokens[value.slice(6, -1)];
  if (!value || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`Token --${name} no es un color hexadecimal: ${value}`);
  return value;
}

function hexToRgb(hex: string): Rgb {
  const clean = hex.replace("#", "");
  return [0, 2, 4].map((index) => Number.parseInt(clean.slice(index, index + 2), 16)) as Rgb;
}

function luminance([r, g, b]: Rgb) {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: Rgb, b: Rgb) {
  const [light, darkest] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (darkest + 0.05);
}

function blend(foreground: Rgb, background: Rgb, alpha: number): Rgb {
  return foreground.map((channel, index) => Math.round(channel * alpha + background[index] * (1 - alpha))) as Rgb;
}

const SURFACES = ["background", "card", "window-panel", "window-surface", "popover"];
/** Opacidad del fondo tintado de StatusBadge/InlineAlert (`bg-success/10`). */
const TINT_ALPHA = 0.1;

function worstOnSurfaces(tokens: Record<string, string>, foreground: Rgb, tint?: Rgb) {
  return Math.min(
    ...SURFACES.map((surface) => {
      const base = hexToRgb(resolveToken(tokens, surface));
      return contrastRatio(foreground, tint ? blend(tint, base, TINT_ALPHA) : base);
    }),
  );
}

const tonePairs = [
  ["success-text", "success"],
  ["warning-text", "warning"],
  ["danger-text", "destructive"],
  ["info-text", "info"],
] as const;

describe("contraste de los tokens de globals.css", () => {
  const themes = Object.entries(themeTokens);

  it("cubre los 8 temas", () => {
    expect(themes).toHaveLength(8);
  });

  it.each(themes)("%s: texto de estado sobre fondo tintado ≥ 4,5:1", (_, tokens) => {
    for (const [text, tone] of tonePairs) {
      const ratio = worstOnSurfaces(tokens, hexToRgb(resolveToken(tokens, text)), hexToRgb(resolveToken(tokens, tone)));
      expect(ratio, `${text} sobre ${tone}/10`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(themes)("%s: enlaces ≥ 4,5:1", (_, tokens) => {
    expect(worstOnSurfaces(tokens, hexToRgb(resolveToken(tokens, "link")))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(themes)("%s: anillo de foco ≥ 3:1", (_, tokens) => {
    expect(worstOnSurfaces(tokens, hexToRgb(resolveToken(tokens, "focus-accent")))).toBeGreaterThanOrEqual(3);
  });

  it.each(themes)("%s: texto secundario ≥ 4,5:1", (_, tokens) => {
    expect(worstOnSurfaces(tokens, hexToRgb(resolveToken(tokens, "muted-foreground")))).toBeGreaterThanOrEqual(4.5);
  });

  it("el desplazamiento suave respeta prefers-reduced-motion", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\)\s*\{\s*html\s*\{\s*scroll-behavior: smooth;/);
    expect(css).not.toMatch(/html\s*\{\s*@apply font-sans;\s*scroll-behavior/);
  });
});
