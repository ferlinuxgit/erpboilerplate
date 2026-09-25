"use client";

import { CaretDown, MagnifyingGlass, Plus } from "@phosphor-icons/react";
import { useId, useMemo, useState, type KeyboardEvent } from "react";

import { normalizeSearchText } from "@/lib/account-aliases";
import { cn } from "@/lib/utils";

export type SupplierPickerOption = { id: string; number: string; name: string; taxId?: string | null; isActive?: boolean };

function compactTaxId(value: string | null | undefined) {
  return (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Busca por nombre, NIF (sin espacios ni guiones) o número de proveedor. */
export function searchSuppliers<T extends SupplierPickerOption>(suppliers: readonly T[], rawQuery: string, limit = 50): T[] {
  const query = normalizeSearchText(rawQuery);
  const taxQuery = compactTaxId(rawQuery);
  if (!query) return suppliers.slice(0, limit);
  return suppliers
    .map((supplier) => {
      const name = normalizeSearchText(supplier.name);
      const taxId = compactTaxId(supplier.taxId);
      let score = 0;
      if (taxQuery.length >= 3 && taxId && taxId === taxQuery) score = 1000;
      else if (taxQuery.length >= 3 && taxId.includes(taxQuery)) score = 800;
      else if (name === query) score = 700;
      else if (name.startsWith(query)) score = 600;
      else if (name.split(" ").some((word) => word.startsWith(query))) score = 500;
      else if (name.includes(query)) score = 400;
      else if (normalizeSearchText(supplier.number).includes(query)) score = 300;
      return { supplier, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.supplier.name.localeCompare(right.supplier.name, "es-ES"))
    .slice(0, limit)
    .map((entry) => entry.supplier);
}

type SupplierPickerProps = {
  suppliers: readonly SupplierPickerOption[];
  value: string;
  onChange: (supplierId: string) => void;
  id: string;
  /**
   * Muestra la opción explícita "Crear proveedor «texto»" al final de la lista. Nunca se crea
   * un proveedor por escribir un nombre: hay que elegir esta opción.
   */
  onCreateRequested?: (query: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  "aria-required"?: boolean | "true" | "false";
};

/** Combobox ARIA para elegir un proveedor existente buscando por nombre o NIF. */
export function SupplierPicker({
  className,
  disabled,
  id,
  onChange,
  onCreateRequested,
  placeholder = "Busca por nombre o NIF",
  suppliers,
  value,
  ...aria
}: SupplierPickerProps) {
  const helpId = useId();
  const listboxId = `${id}-listbox`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = suppliers.find((supplier) => supplier.id === value) ?? null;
  const results = useMemo(() => searchSuppliers(suppliers, isTyping ? query : ""), [isTyping, query, suppliers]);
  const canCreate = Boolean(onCreateRequested);
  const optionCount = results.length + (canCreate ? 1 : 0);
  const safeActiveIndex = optionCount === 0 ? -1 : Math.min(activeIndex, optionCount - 1);
  const optionId = (index: number) => `${id}-option-${index}`;
  const label = (supplier: SupplierPickerOption) => `${supplier.name}${supplier.taxId ? ` · ${supplier.taxId}` : ""}`;
  const inputValue = isTyping ? query : selected ? label(selected) : "";

  function close() {
    setOpen(false);
    setIsTyping(false);
    setQuery("");
  }

  function chooseIndex(index: number) {
    if (index < 0) return;
    if (index < results.length) {
      onChange(results[index].id);
      close();
      return;
    }
    if (canCreate) {
      const typed = isTyping ? query.trim() : "";
      close();
      onCreateRequested?.(typed);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(0);
        return;
      }
      setActiveIndex((current) => (event.key === "ArrowDown" ? Math.min(current + 1, Math.max(optionCount - 1, 0)) : Math.max(current - 1, 0)));
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      chooseIndex(safeActiveIndex);
    } else if (event.key === "Escape" && (open || isTyping)) {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "Tab") {
      close();
    }
  }

  return (
    <div className={cn("relative", className)} data-slot="supplier-picker">
      <div className="relative">
        <MagnifyingGlass aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-window-muted" />
        <input
          {...aria}
          aria-activedescendant={open && safeActiveIndex >= 0 ? optionId(safeActiveIndex) : undefined}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-describedby={[aria["aria-describedby"], helpId].filter(Boolean).join(" ")}
          aria-expanded={open}
          autoComplete="off"
          className="h-8 w-full min-w-0 rounded-[1px] border border-window-dark-shadow bg-window-highlight py-1 pl-7 pr-7 font-mono text-[0.78rem] text-window-text shadow-[inset_1px_1px_0_var(--window-shadow),inset_-1px_-1px_0_var(--window-surface)] outline-none placeholder:text-window-muted/75 focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-55 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/25 max-sm:min-h-9 max-sm:text-base"
          disabled={disabled}
          id={id}
          onBlur={close}
          onChange={(event) => {
            setIsTyping(true);
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(0);
          }}
          onClick={() => {
            if (disabled) return;
            if (open) close();
            else {
              setOpen(true);
              setActiveIndex(0);
            }
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          role="combobox"
          spellCheck={false}
          type="text"
          value={inputValue}
        />
        <CaretDown aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-window-muted" />
      </div>
      <span className="sr-only" id={helpId}>
        {selected ? `Proveedor elegido: ${label(selected)}.` : "Sin proveedor elegido."} Escribe para buscar; flechas para recorrer e Intro para elegir.
      </span>
      {open ? (
        <ul
          aria-label="Proveedores"
          className="absolute left-0 right-0 z-30 mt-0.5 max-h-72 overflow-y-auto border border-window-dark-shadow bg-window-surface py-0.5 shadow-[3px_3px_0_var(--window-shadow)]"
          id={listboxId}
          onMouseDown={(event) => event.preventDefault()}
          role="listbox"
        >
          {results.map((supplier, index) => (
            <li
              aria-selected={supplier.id === value}
              className={cn("flex cursor-pointer flex-col px-2 py-1 text-xs", index === safeActiveIndex ? "bg-primary text-primary-foreground" : "hover:bg-window-highlight")}
              id={optionId(index)}
              key={supplier.id}
              onClick={() => chooseIndex(index)}
              onMouseMove={() => setActiveIndex(index)}
              role="option"
            >
              <span className="font-mono font-bold">{supplier.name}{supplier.isActive === false ? " (inactivo)" : ""}</span>
              <span className={index === safeActiveIndex ? "text-primary-foreground" : "text-muted-foreground"}>{supplier.number} · {supplier.taxId ?? "sin NIF"}</span>
            </li>
          ))}
          {results.length === 0 && !canCreate ? (
            <li aria-disabled="true" aria-selected={false} className="px-2 py-1.5 text-xs text-muted-foreground" role="option">Ningún proveedor coincide.</li>
          ) : null}
          {canCreate ? (
            <li
              aria-selected={false}
              className={cn("flex cursor-pointer items-center gap-1.5 border-t border-window-shadow px-2 py-1.5 font-mono text-xs font-bold", safeActiveIndex === results.length ? "bg-primary text-primary-foreground" : "text-primary hover:bg-window-highlight")}
              id={optionId(results.length)}
              onClick={() => chooseIndex(results.length)}
              onMouseMove={() => setActiveIndex(results.length)}
              role="option"
            >
              <Plus aria-hidden="true" /> {isTyping && query.trim() ? `Crear proveedor «${query.trim()}»` : "Crear proveedor nuevo"}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
