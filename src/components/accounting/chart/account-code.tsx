import { Lock, Warning } from "@phosphor-icons/react";

import { balanceSideLetter, balanceSideWord, contradictsNature, formatCents, splitCode } from "@/lib/chart-of-accounts/format";
import { highlightParts } from "@/lib/chart-of-accounts/tree";
import type { ChartNature } from "@/lib/chart-of-accounts/types";
import { cn } from "@/lib/utils";

/** Texto con las coincidencias de la búsqueda resaltadas con `<mark>`. */
export function Highlighted({ query, text }: { query: string; text: string }) {
  if (!query.trim()) return <>{text}</>;
  return (
    <>
      {highlightParts(text, query).map((part, index) =>
        part.match ? (
          <mark className="rounded-[1px] bg-info/10 font-bold text-info-text underline decoration-1 underline-offset-2" key={index}>
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

type AccountCodeProps = {
  code: string;
  parentCode: string | null;
  /** Resalta el código entero (coincidencia exacta, p. ej. con el atajo 43.1). */
  highlightAll?: boolean;
  /** Prefijo buscado que se resalta al principio del código. */
  highlightPrefix?: string;
  className?: string;
};

/** Código segmentado: dígitos heredados del padre atenuados y los propios en negrita (4300|0001). */
export function AccountCode({ className, code, highlightAll, highlightPrefix, parentCode }: AccountCodeProps) {
  const { inherited, own } = splitCode(code, parentCode);
  const content = (
    <>
      {inherited ? <span className="font-normal text-muted-foreground">{inherited}</span> : null}
      <span className="font-bold">{own}</span>
    </>
  );
  const marked = highlightAll || (highlightPrefix && /^\d+$/.test(highlightPrefix) && code.startsWith(highlightPrefix));
  return (
    <span className={cn("font-mono tabular-nums", className)}>
      {marked ? <mark className="rounded-[1px] bg-info/10 text-info-text underline decoration-1 underline-offset-2">{content}</mark> : content}
    </span>
  );
}

/** Importe en cifras tabulares; el cero se muestra como «·» atenuado. */
export function AmountCell({ cents }: { cents: number }) {
  if (cents === 0) {
    return (
      <span className="text-muted-foreground">
        <span aria-hidden="true">·</span>
        <span className="sr-only">0,00</span>
      </span>
    );
  }
  return <span className="font-mono tabular-nums">{formatCents(cents)}</span>;
}

/** Saldo sin signo con insignia D/A y aviso si contradice la naturaleza de la cuenta. */
export function BalanceCell({ cents, nature }: { cents: number; nature: ChartNature }) {
  const letter = balanceSideLetter(cents);
  if (!letter) return <AmountCell cents={0} />;
  const contrary = contradictsNature(cents, nature);
  return (
    <span className="inline-flex items-center justify-end gap-1">
      {contrary ? (
        <span className="inline-flex text-warning-text" title="Saldo contrario a la naturaleza de la cuenta">
          <Warning aria-hidden="true" className="size-3.5" weight="bold" />
          <span className="sr-only">Saldo contrario a la naturaleza de la cuenta.</span>
        </span>
      ) : null}
      <span className="font-mono tabular-nums">{formatCents(Math.abs(cents))}</span>
      <span
        aria-label={balanceSideWord(cents)}
        className={cn(
          "inline-flex w-4 justify-center rounded-[1px] border font-mono text-xs leading-4 font-bold",
          contrary ? "border-warning/70 bg-warning/10 text-warning-text" : "border-window-dark-shadow bg-window-panel text-window-text",
        )}
        role="img"
        title={cents > 0 ? "Deudor" : "Acreedor"}
      >
        {letter}
      </span>
    </span>
  );
}

export function BlockedIcon() {
  return (
    <span className="inline-flex text-muted-foreground" title="Bloqueada: no admite apuntes manuales nuevos">
      <Lock aria-hidden="true" className="size-3.5" weight="bold" />
      <span className="sr-only">Bloqueada</span>
    </span>
  );
}

export function PartnerBadge({ name, taxId }: { name: string | null; taxId: string | null }) {
  const label = `Tercero${name ? `: ${name}` : ""}${taxId ? ` (NIF ${taxId})` : ""}`;
  return (
    <span
      aria-label={label}
      className="inline-flex h-4 shrink-0 items-center rounded-[1px] border border-info/70 bg-info/10 px-1 font-mono text-xs leading-4 font-bold text-info-text"
      role="img"
      title={taxId ? `NIF ${taxId}` : "Tercero sin NIF"}
    >
      T
    </span>
  );
}
