"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { bandScale, formatCompactMoney, labelStride, linearScale } from "@/components/charts/scale";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ChartSeries = {
  key: string;
  label: string;
  /** CSS color, normally a theme token such as `var(--chart-income)`. */
  color: string;
  values: number[];
};

export type ChartCategory = { label: string; longLabel: string };

type TimeSeriesChartProps = {
  /** Accessible name and caption of the data table. */
  title: string;
  /** What the values are, e.g. "Importes sin IVA". Shown as the y-axis title. */
  valueLabel: string;
  categories: ChartCategory[];
  series: ChartSeries[];
  kind: "bars" | "line";
  currencyCode?: string;
  height?: number;
  className?: string;
  testId?: string;
};

const MARGIN = { top: 14, right: 12, bottom: 26, left: 60 };
const MAX_BAR_WIDTH = 24;
const BAR_GAP = 2;
const RADIUS = 4;

/** Column path with a rounded data end and a square base (grows up or down from the baseline). */
function columnPath(x: number, width: number, baseline: number, top: number) {
  const height = Math.abs(baseline - top);
  if (height < 0.5) return "";
  const radius = Math.min(RADIUS, width / 2, height);
  if (top <= baseline) {
    return `M${x},${baseline}V${top + radius}Q${x},${top} ${x + radius},${top}H${x + width - radius}Q${x + width},${top} ${x + width},${top + radius}V${baseline}Z`;
  }
  return `M${x},${baseline}V${top - radius}Q${x},${top} ${x + radius},${top}H${x + width - radius}Q${x + width},${top} ${x + width},${top - radius}V${baseline}Z`;
}

/**
 * Lightweight SVG chart for monthly money series (grouped columns or a line with a soft
 * area). Colors come from theme tokens so it follows the 8 themes, including dark ones.
 * Accessibility: the SVG is decorative for assistive tech; a visually hidden table carries
 * the data, the chart is focusable and ←/→ move a tooltip announced through a live region.
 */
export function TimeSeriesChart({
  title,
  valueLabel,
  categories,
  series,
  kind,
  currencyCode = "EUR",
  height = 220,
  className,
  testId,
}: TimeSeriesChartProps) {
  const id = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => setWidth(Math.max(260, Math.round(element.getBoundingClientRect().width)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const plotLeft = MARGIN.left;
  const plotRight = width - MARGIN.right;
  const plotTop = MARGIN.top;
  const plotBottom = height - MARGIN.bottom;
  const y = linearScale(series.flatMap((entry) => entry.values), plotBottom, plotTop, 4);
  const band = bandScale(categories.length, plotLeft, plotRight, kind === "bars" ? 0.28 : 0);
  const stride = labelStride(categories.length, plotRight - plotLeft);
  const baseline = y.map(0);
  const barWidth = Math.max(2, Math.min(MAX_BAR_WIDTH, (band.bandwidth - BAR_GAP * (series.length - 1)) / Math.max(1, series.length)));
  const groupWidth = barWidth * series.length + BAR_GAP * (series.length - 1);
  const money = (value: number) => formatMoney(value, currencyCode);
  const describe = (index: number) =>
    `${categories[index]?.longLabel}: ${series.map((entry) => `${entry.label} ${money(entry.values[index] ?? 0)}`).join(", ")}`;

  function activate(index: number | null, announce = false) {
    setActive(index);
    if (announce && index !== null) setAnnouncement(describe(index));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const last = categories.length - 1;
    const current = active ?? last;
    let next: number | null = null;
    if (event.key === "ArrowLeft") next = Math.max(0, current - 1);
    else if (event.key === "ArrowRight") next = Math.min(last, current + 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    else if (event.key === "Escape") {
      activate(null);
      return;
    }
    if (next === null) return;
    event.preventDefault();
    activate(next, true);
  }

  const tooltipLeft = active === null ? 0 : band.center(active);
  const tooltipOnLeft = tooltipLeft > width * 0.6;

  return (
    <figure className={cn("min-w-0 space-y-1.5", className)} data-testid={testId}>
      <div aria-hidden="true" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 font-mono text-xs">
        {/* Y-axis title (units), kept outside the SVG so it never collides with tick labels. */}
        <span className="text-muted-foreground">{valueLabel}</span>
        {series.length > 1 ? (
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-foreground">
            {series.map((entry) => (
              <li className="inline-flex items-center gap-1.5" key={entry.key}>
                <span className="inline-block size-2.5 rounded-[2px]" style={{ background: entry.color }} />
                {entry.label}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div
        aria-describedby={`${id}-help`}
        aria-label={`${title}. Gráfico interactivo: usa las flechas izquierda y derecha para recorrer los meses.`}
        aria-roledescription="gráfico"
        className="relative rounded-[2px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        onBlur={() => activate(null)}
        onFocus={() => activate(active ?? categories.length - 1, true)}
        onKeyDown={handleKeyDown}
        onMouseLeave={() => activate(null)}
        ref={containerRef}
        role="group"
        tabIndex={0}
      >
        <svg aria-hidden="true" className="block h-auto w-full overflow-visible" viewBox={`0 0 ${width} ${height}`}>
          {y.ticks.map((tick) => (
            <g key={tick}>
              <line
                style={{ stroke: tick === 0 ? "var(--muted-foreground)" : "var(--border)" }}
                strokeOpacity={tick === 0 ? 0.7 : 0.45}
                strokeWidth={1}
                x1={plotLeft}
                x2={plotRight}
                y1={Math.round(y.map(tick)) + 0.5}
                y2={Math.round(y.map(tick)) + 0.5}
              />
              <text className="fill-muted-foreground tabular-nums" dominantBaseline="middle" fontSize={12} textAnchor="end" x={plotLeft - 6} y={y.map(tick)}>
                {formatCompactMoney(tick, currencyCode)}
              </text>
            </g>
          ))}
          {categories.map((category, index) =>
            index % stride === (categories.length - 1) % stride ? (
              <text className="fill-muted-foreground" fontSize={12} key={category.label} textAnchor="middle" x={band.center(index)} y={height - 8}>
                {category.label}
              </text>
            ) : null,
          )}
          {active !== null ? (
            kind === "bars" ? (
              <rect height={plotBottom - plotTop} opacity={0.07} style={{ fill: "var(--foreground)" }} width={band.slot} x={band.center(active) - band.slot / 2} y={plotTop} />
            ) : (
              <line strokeWidth={1} style={{ stroke: "var(--muted-foreground)" }} x1={band.center(active)} x2={band.center(active)} y1={plotTop} y2={plotBottom} />
            )
          ) : null}
          {kind === "bars"
            ? series.map((entry, seriesIndex) =>
                entry.values.map((value, index) => {
                  const x = band.center(index) - groupWidth / 2 + seriesIndex * (barWidth + BAR_GAP);
                  const path = columnPath(x, barWidth, baseline, y.map(value));
                  return path ? <path d={path} key={`${entry.key}-${index}`} style={{ fill: entry.color }} /> : null;
                }),
              )
            : series.map((entry) => {
                const points = entry.values.map((value, index) => [band.center(index), y.map(value)] as const);
                const line = points.map(([x, py], index) => `${index === 0 ? "M" : "L"}${x},${py}`).join("");
                const area = points.length > 0 ? `${line}L${points[points.length - 1][0]},${baseline}L${points[0][0]},${baseline}Z` : "";
                const marked = [points.length - 1, ...(active !== null ? [active] : [])];
                return (
                  <g key={entry.key}>
                    <path d={area} opacity={0.1} style={{ fill: entry.color }} />
                    <path d={line} fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} style={{ stroke: entry.color }} />
                    {[...new Set(marked)].map((index) =>
                      points[index] ? (
                        <circle cx={points[index][0]} cy={points[index][1]} key={index} r={4.5} strokeWidth={2} style={{ fill: entry.color, stroke: "var(--card)" }} />
                      ) : null,
                    )}
                  </g>
                );
              })}
          {categories.map((category, index) => (
            <rect
              fill="transparent"
              height={plotBottom - plotTop}
              key={`hit-${category.label}`}
              onMouseEnter={() => activate(index)}
              width={band.slot}
              x={band.center(index) - band.slot / 2}
              y={plotTop}
            />
          ))}
        </svg>
        {active !== null && categories[active] ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute z-10 min-w-40 border border-window-dark-shadow bg-popover p-2 font-mono text-xs text-popover-foreground shadow-[2px_2px_0_rgba(0,0,0,0.25)]"
            style={{ top: plotTop, ...(tooltipOnLeft ? { right: width - tooltipLeft + 10 } : { left: tooltipLeft + 10 }) }}
          >
            <p className="mb-1 font-bold capitalize">{categories[active].longLabel}</p>
            <dl className="space-y-0.5">
              {series.map((entry) => (
                <div className="flex items-center justify-between gap-3" key={entry.key}>
                  <dt className="inline-flex items-center gap-1.5">
                    <span className="inline-block size-2 rounded-[2px]" style={{ background: entry.color }} />
                    {entry.label}
                  </dt>
                  <dd className="tabular-nums">{money(entry.values[active] ?? 0)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </div>
      <p className="sr-only" id={`${id}-help`}>
        Los datos completos están en la tabla que sigue al gráfico.
      </p>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <table className="sr-only">
        <caption>
          {title} ({valueLabel})
        </caption>
        <thead>
          <tr>
            <th scope="col">Mes</th>
            {series.map((entry) => (
              <th key={entry.key} scope="col">
                {entry.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {categories.map((category, index) => (
            <tr key={category.label}>
              <th scope="row">{category.longLabel}</th>
              {series.map((entry) => (
                <td key={entry.key}>{money(entry.values[index] ?? 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
