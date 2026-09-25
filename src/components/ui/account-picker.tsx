"use client";

import { CaretDown, MagnifyingGlass } from "@phosphor-icons/react";
import { Fragment, useId, useMemo, useState, useSyncExternalStore, type KeyboardEvent } from "react";

import { aliasTermsForCode, rankAccounts, type AccountOption, type RankedAccount } from "@/lib/account-aliases";
import { cn } from "@/lib/utils";

const RECENT_STORAGE_PREFIX = "erp-account-picker:recent:";
const RECENT_CHANGED_EVENT = "erp:account-picker-recent";
const MAX_RECENT = 6;

export type AccountPickerProps = {
  /** Cuentas elegibles (normalmente las cuentas imputables de la empresa). */
  accounts: readonly AccountOption[];
  /** Id de la cuenta elegida; "" = sin elegir (nunca se elige una por defecto en silencio). */
  value: string;
  onChange: (accountId: string, account: AccountOption | null) => void;
  /** Id del campo de texto (lo conecta el `<label htmlFor>` de `AccessibleField`). */
  id: string;
  /** Prefijos de código admitidos, p. ej. "6" para gastos o ["6", "2"] para gasto o inmovilizado. */
  groupFilter?: string | readonly string[];
  placeholder?: string;
  /** Cuentas propuestas (IA, OCR, proveedor); se muestran arriba con la etiqueta "Sugerida". */
  suggestedIds?: readonly string[];
  /** Espacio de "recientes" en este navegador; por defecto se agrupa por `groupFilter`. */
  recentKey?: string;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  "aria-required"?: boolean | "true" | "false";
};

function readRecentRaw(storageKey: string) {
  try {
    return window.localStorage.getItem(storageKey) ?? "";
  } catch {
    // Almacenamiento bloqueado (modo privado estricto): sin recientes.
    return "";
  }
}

function subscribeRecent(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(RECENT_CHANGED_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(RECENT_CHANGED_EVENT, callback);
  };
}

function rememberRecent(storageKey: string, accountId: string) {
  try {
    const current = readRecentRaw(storageKey).split(",").filter(Boolean);
    const next = [accountId, ...current.filter((id) => id !== accountId)].slice(0, MAX_RECENT);
    window.localStorage.setItem(storageKey, next.join(","));
    window.dispatchEvent(new Event(RECENT_CHANGED_EVENT));
  } catch {
    // Sin almacenamiento local simplemente no se recuerdan recientes.
  }
}

function accountLabel(account: AccountOption) {
  return `${account.code} · ${account.name}`;
}

const groupLabels: Record<RankedAccount["group"], string> = {
  suggested: "Sugeridas",
  recent: "Usadas recientemente",
  match: "Resultados",
  all: "Todas las cuentas",
};

/**
 * Selector de cuentas con búsqueda (combobox ARIA con lista). Busca por código, nombre y
 * palabras llanas ("luz" → 628, "gestor" → 623). Muestra arriba las sugeridas y las usadas
 * recientemente. Teclado: ↓/↑ recorren, Intro elige, Esc cierra y restaura, Tab sale.
 */
export function AccountPicker({
  accounts,
  className,
  disabled,
  groupFilter,
  id,
  onChange,
  placeholder = "Busca por concepto, nombre o código (p. ej. luz, alquiler, 628)",
  recentKey,
  required,
  suggestedIds,
  value,
  ...aria
}: AccountPickerProps) {
  const listboxId = `${id}-listbox`;
  const helpId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const prefixKey = groupFilter === undefined ? "" : typeof groupFilter === "string" ? groupFilter : groupFilter.join(",");
  const prefixes = useMemo(() => prefixKey.split(",").filter(Boolean), [prefixKey]);
  const eligible = useMemo(
    () => (prefixes.length === 0 ? accounts : accounts.filter((account) => prefixes.some((prefix) => account.code.startsWith(prefix)))),
    [accounts, prefixes],
  );
  const storageKey = `${RECENT_STORAGE_PREFIX}${recentKey ?? (prefixes.join("-") || "all")}`;
  const recentRaw = useSyncExternalStore(subscribeRecent, () => readRecentRaw(storageKey), () => "");
  const recentIds = useMemo(() => recentRaw.split(",").filter((accountId) => eligible.some((account) => account.id === accountId)), [eligible, recentRaw]);

  const selected = accounts.find((account) => account.id === value) ?? null;
  const results = useMemo(
    () => rankAccounts(eligible, isTyping ? query : "", { recentIds, suggestedIds }),
    [eligible, isTyping, query, recentIds, suggestedIds],
  );
  const safeActiveIndex = results.length === 0 ? -1 : Math.min(activeIndex, results.length - 1);
  const optionId = (index: number) => `${id}-option-${index}`;
  const inputValue = isTyping ? query : selected ? accountLabel(selected) : "";
  const isSuggested = selected ? (suggestedIds ?? []).includes(selected.id) : false;

  function openList() {
    if (disabled) return;
    setOpen(true);
    setActiveIndex(0);
  }

  function close(restore: boolean) {
    setOpen(false);
    if (restore) {
      setIsTyping(false);
      setQuery("");
    }
  }

  function choose(account: RankedAccount | undefined) {
    if (!account) return;
    rememberRecent(storageKey, account.id);
    onChange(account.id, { id: account.id, code: account.code, name: account.name });
    setIsTyping(false);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) return openList();
      setActiveIndex((current) => Math.min(current + 1, Math.max(results.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) return openList();
      setActiveIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === "Home" && open) {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End" && open) {
      event.preventDefault();
      setActiveIndex(Math.max(results.length - 1, 0));
    } else if (event.key === "Enter") {
      // Intro con la lista abierta elige; nunca envía el formulario a medio elegir.
      if (open) {
        event.preventDefault();
        choose(results[safeActiveIndex]);
      }
    } else if (event.key === "Escape") {
      if (open || isTyping) {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      }
    } else if (event.key === "Tab") {
      close(true);
    }
  }

  return (
    <div className={cn("relative", className)} data-slot="account-picker">
      <div className="relative">
        <MagnifyingGlass aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-window-muted" />
        <input
          {...aria}
          aria-activedescendant={open && safeActiveIndex >= 0 ? optionId(safeActiveIndex) : undefined}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-describedby={[aria["aria-describedby"], helpId].filter(Boolean).join(" ")}
          aria-expanded={open}
          aria-required={aria["aria-required"] ?? (required ? true : undefined)}
          autoComplete="off"
          className="h-8 w-full min-w-0 rounded-[1px] border border-window-dark-shadow bg-window-highlight py-1 pl-7 pr-7 font-mono text-[0.78rem] text-window-text shadow-[inset_1px_1px_0_var(--window-shadow),inset_-1px_-1px_0_var(--window-surface)] outline-none placeholder:text-window-muted/75 focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-55 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/25 max-sm:min-h-9 max-sm:text-base"
          disabled={disabled}
          id={id}
          onBlur={() => close(true)}
          onChange={(event) => {
            setIsTyping(true);
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(0);
          }}
          onClick={() => (open ? close(true) : openList())}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          role="combobox"
          spellCheck={false}
          title={selected ? accountLabel(selected) : undefined}
          type="text"
          value={inputValue}
        />
        <CaretDown aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-window-muted" />
      </div>
      <span className="sr-only" id={helpId}>
        {selected ? `Cuenta elegida: ${accountLabel(selected)}${isSuggested ? " (sugerida)" : ""}.` : "Sin cuenta elegida."} Escribe para buscar; flechas para recorrer e Intro para elegir.
      </span>
      {open ? (
        <ul
          aria-label="Cuentas contables"
          className="absolute left-0 right-0 z-30 mt-0.5 max-h-72 overflow-y-auto border border-window-dark-shadow bg-window-surface py-0.5 shadow-[3px_3px_0_var(--window-shadow)]"
          id={listboxId}
          // Evita que el clic en la lista quite el foco (y cierre) antes de elegir.
          onMouseDown={(event) => event.preventDefault()}
          role="listbox"
        >
          {results.length === 0 ? (
            <li aria-disabled="true" className="px-2 py-1.5 text-xs text-muted-foreground" role="option" aria-selected={false}>
              Sin coincidencias. Prueba con otra palabra (p. ej. «suministros») o con el código.
            </li>
          ) : (
            results.map((account, index) => {
              const previousGroup = index > 0 ? results[index - 1].group : null;
              const showHeader = account.group !== previousGroup && (previousGroup !== null || account.group === "suggested" || account.group === "recent");
              const hints = account.matchedAlias ? [] : aliasTermsForCode(account.code).slice(0, 4);
              const active = index === safeActiveIndex;
              return (
                <Fragment key={account.id}>
                  {showHeader ? (
                    <li aria-hidden="true" className="border-b border-window-shadow px-2 pb-0.5 pt-1 font-mono text-xs font-bold uppercase tracking-[0.06em] text-muted-foreground" role="presentation">
                      {groupLabels[account.group]}
                    </li>
                  ) : null}
                  <li
                    aria-selected={account.id === value}
                    className={cn("flex cursor-pointer flex-col px-2 py-1 text-left text-xs", active ? "bg-primary text-primary-foreground" : "hover:bg-window-highlight")}
                    id={optionId(index)}
                    onClick={() => choose(account)}
                    onMouseMove={() => setActiveIndex(index)}
                    role="option"
                  >
                    <span className="font-mono font-bold">
                      {account.code} · {account.name}
                      {account.group === "suggested" ? <span className="ml-1 font-normal">(sugerida)</span> : null}
                    </span>
                    {account.matchedAlias || hints.length > 0 ? (
                      <span className={cn("text-xs", active ? "text-primary-foreground" : "text-muted-foreground")}>
                        {account.matchedAlias ? `Coincide con «${account.matchedAlias}»` : hints.join(", ")}
                      </span>
                    ) : null}
                  </li>
                </Fragment>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
