import type { ChartNode, ChartTreeResponse } from "@/lib/chart-of-accounts/types";

/**
 * Modelo del árbol en el cliente (funciones puras): almacén de nodos cargados perezosamente,
 * lista plana de filas visibles para la virtualización y navegación por teclado (treegrid WAI-ARIA).
 */

export const ROOT_KEY = "";

export type TreeStore = {
  nodes: ReadonlyMap<string, ChartNode>;
  /** Hijos por cuenta padre ("" = raíz), en orden de código. */
  children: ReadonlyMap<string, readonly string[]>;
  /** Padres cuyos hijos están completos. */
  loaded: ReadonlySet<string>;
};

export type LoadStatus = { state: "loading" } | { state: "error"; message: string };

export type VisibleRow =
  | {
      kind: "node";
      key: string;
      node: ChartNode;
      depth: number;
      posinset: number;
      setsize: number;
      expanded: boolean;
      expandable: boolean;
    }
  | { kind: "loading"; key: string; depth: number; parentCode: string }
  | { kind: "error"; key: string; depth: number; parentCode: string; message: string }
  | { kind: "empty"; key: string; depth: number; parentCode: string };

export function emptyTreeStore(): TreeStore {
  return { nodes: new Map(), children: new Map(), loaded: new Set() };
}

function parentKey(node: ChartNode) {
  return node.parentCode ?? ROOT_KEY;
}

function byCode(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Añade una respuesta de la API al almacén. Para cada padre de `loadedParents` los hijos se
 * sustituyen (la respuesta es la lista completa con los filtros vigentes); el resto se suma.
 */
export function mergeTreeResponse(store: TreeStore, response: Pick<ChartTreeResponse, "nodes" | "loadedParents">): TreeStore {
  const nodes = new Map(store.nodes);
  const children = new Map<string, readonly string[]>(store.children);
  const loaded = new Set(store.loaded);
  const replaced = new Set(response.loadedParents);
  const incoming = new Map<string, string[]>();
  for (const node of response.nodes) {
    nodes.set(node.code, node);
    const key = parentKey(node);
    const list = incoming.get(key) ?? [];
    list.push(node.code);
    incoming.set(key, list);
  }
  for (const key of replaced) {
    children.set(key, [...(incoming.get(key) ?? [])].sort(byCode));
    loaded.add(key);
  }
  for (const [key, codes] of incoming) {
    if (replaced.has(key)) continue;
    children.set(key, [...new Set([...(children.get(key) ?? []), ...codes])].sort(byCode));
  }
  return { nodes, children, loaded };
}

export function treeStoreFromResponse(response: Pick<ChartTreeResponse, "nodes" | "loadedParents">): TreeStore {
  return mergeTreeResponse(emptyTreeStore(), response);
}

/** Sustituye un nodo ya cargado (p. ej. tras bloquearlo) sin tocar la estructura. */
export function updateStoreNode(store: TreeStore, code: string, patch: Partial<ChartNode>): TreeStore {
  const current = store.nodes.get(code);
  if (!current) return store;
  const nodes = new Map(store.nodes);
  nodes.set(code, { ...current, ...patch });
  return { ...store, nodes };
}

export function isExpandable(store: TreeStore, node: ChartNode) {
  return node.childCount > 0 || (store.children.get(node.code)?.length ?? 0) > 0;
}

/** Filas visibles en orden (recorrido en profundidad por las cuentas desplegadas). */
export function flattenVisible(store: TreeStore, expanded: ReadonlySet<string>, status: ReadonlyMap<string, LoadStatus> = new Map()): VisibleRow[] {
  const rows: VisibleRow[] = [];
  const visit = (key: string, depth: number) => {
    const codes = store.children.get(key) ?? [];
    codes.forEach((code, index) => {
      const node = store.nodes.get(code);
      if (!node) return;
      const expandable = isExpandable(store, node);
      const isOpen = expandable && expanded.has(code);
      rows.push({ kind: "node", key: code, node, depth, posinset: index + 1, setsize: codes.length, expanded: isOpen, expandable });
      if (!isOpen) return;
      const childStatus = status.get(code);
      if (childStatus?.state === "error") {
        rows.push({ kind: "error", key: `${code}:error`, depth: depth + 1, parentCode: code, message: childStatus.message });
      } else if (!store.loaded.has(code)) {
        // Esqueleto con la sangría de los hijos mientras llegan.
        const count = Math.min(Math.max(node.childCount, 1), 3);
        for (let index = 0; index < count; index += 1) rows.push({ kind: "loading", key: `${code}:loading:${index}`, depth: depth + 1, parentCode: code });
      } else if ((store.children.get(code)?.length ?? 0) === 0) {
        rows.push({ kind: "empty", key: `${code}:empty`, depth: depth + 1, parentCode: code });
      } else {
        visit(code, depth + 1);
      }
    });
  };
  visit(ROOT_KEY, 1);
  return rows;
}

/** Ancestros de una cuenta presentes en el almacén (del más cercano a la raíz, en orden raíz → padre). */
export function ancestorsInStore(store: TreeStore, code: string): string[] {
  const path: string[] = [];
  let current = store.nodes.get(code)?.parentCode ?? null;
  const guard = new Set<string>();
  while (current && !guard.has(current)) {
    guard.add(current);
    path.unshift(current);
    current = store.nodes.get(current)?.parentCode ?? null;
  }
  return path;
}

/** Cuentas desplegadas tras cargar hasta un nivel: las que tienen hijos cargados. */
export function expandedFromLoaded(store: TreeStore): Set<string> {
  const expanded = new Set<string>();
  for (const key of store.loaded) {
    if (key !== ROOT_KEY && (store.children.get(key)?.length ?? 0) > 0) expanded.add(key);
  }
  return expanded;
}

export type TreeKeyInput = { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean };

export type TreeKeyAction =
  | { type: "focus"; index: number }
  | { type: "expand"; code: string }
  | { type: "collapse"; code: string }
  | { type: "expandSiblings"; codes: string[] }
  | { type: "open"; code: string }
  | { type: "ledger"; code: string }
  | { type: "newChild"; code: string }
  | { type: "menu"; code: string }
  | { type: "search" };

const PAGE_SIZE = 10;

function nodeIndexFrom(rows: readonly VisibleRow[], start: number, step: 1 | -1) {
  for (let index = start; index >= 0 && index < rows.length; index += step) {
    if (rows[index].kind === "node") return index;
  }
  return -1;
}

/**
 * Teclado del treegrid: ↑↓ Inicio Fin RePág AvPág mueven; → despliega o baja al primer hijo;
 * ← pliega o sube al padre; * despliega los hermanos; Intro abre la ficha; Ctrl+Intro el mayor;
 * / busca; n crea una subcuenta; Mayús+F10 o la tecla de menú abren el menú contextual.
 */
export function treeKeyAction(rows: readonly VisibleRow[], index: number, input: TreeKeyInput): TreeKeyAction | null {
  const row = rows[index];
  if (!row || row.kind !== "node") {
    const first = nodeIndexFrom(rows, 0, 1);
    return first >= 0 ? { type: "focus", index: first } : null;
  }
  const code = row.node.code;
  const modifier = Boolean(input.ctrlKey || input.metaKey);
  switch (input.key) {
    case "ArrowDown": {
      const next = nodeIndexFrom(rows, index + 1, 1);
      return next >= 0 ? { type: "focus", index: next } : null;
    }
    case "ArrowUp": {
      const previous = nodeIndexFrom(rows, index - 1, -1);
      return previous >= 0 ? { type: "focus", index: previous } : null;
    }
    case "Home":
      return { type: "focus", index: nodeIndexFrom(rows, 0, 1) };
    case "End":
      return { type: "focus", index: nodeIndexFrom(rows, rows.length - 1, -1) };
    case "PageDown": {
      const target = nodeIndexFrom(rows, Math.min(rows.length - 1, index + PAGE_SIZE), -1);
      return target >= 0 ? { type: "focus", index: target } : null;
    }
    case "PageUp": {
      const target = nodeIndexFrom(rows, Math.max(0, index - PAGE_SIZE), 1);
      return target >= 0 ? { type: "focus", index: target } : null;
    }
    case "ArrowRight": {
      if (!row.expandable) return null;
      if (!row.expanded) return { type: "expand", code };
      const child = rows[index + 1];
      return child && child.kind === "node" && child.depth === row.depth + 1 ? { type: "focus", index: index + 1 } : null;
    }
    case "ArrowLeft": {
      if (row.expanded) return { type: "collapse", code };
      for (let candidate = index - 1; candidate >= 0; candidate -= 1) {
        const previous = rows[candidate];
        if (previous.kind === "node" && previous.depth === row.depth - 1) return { type: "focus", index: candidate };
      }
      return null;
    }
    case "*": {
      const codes: string[] = [];
      for (const candidate of rows) {
        if (candidate.kind === "node" && candidate.depth === row.depth && candidate.node.parentCode === row.node.parentCode && candidate.expandable && !candidate.expanded) codes.push(candidate.node.code);
      }
      return codes.length > 0 ? { type: "expandSiblings", codes } : null;
    }
    case "Enter":
      return modifier ? { type: "ledger", code } : { type: "open", code };
    case "/":
      return { type: "search" };
    case "n":
    case "N":
      return modifier || input.altKey ? null : { type: "newChild", code };
    case "ContextMenu":
      return { type: "menu", code };
    case "F10":
      return input.shiftKey ? { type: "menu", code } : null;
    default:
      return null;
  }
}

/** Siguiente (o anterior) coincidencia de la búsqueda, dando la vuelta al final. */
export function nextMatchCode(matches: readonly string[], current: string | null, direction: 1 | -1 = 1): string | null {
  if (matches.length === 0) return null;
  const index = current ? matches.indexOf(current) : -1;
  if (index < 0) return direction === 1 ? matches[0] : matches[matches.length - 1];
  return matches[(index + direction + matches.length) % matches.length];
}

/** Trozos de un texto con las coincidencias de la búsqueda marcadas (sin distinguir mayúsculas). */
export function highlightParts(text: string, query: string): Array<{ text: string; match: boolean }> {
  const needle = query.trim().toLocaleLowerCase("es");
  if (!needle) return [{ text, match: false }];
  const haystack = text.toLocaleLowerCase("es");
  const parts: Array<{ text: string; match: boolean }> = [];
  let cursor = 0;
  while (cursor <= text.length) {
    const found = haystack.indexOf(needle, cursor);
    if (found < 0) break;
    if (found > cursor) parts.push({ text: text.slice(cursor, found), match: false });
    parts.push({ text: text.slice(found, found + needle.length), match: true });
    cursor = found + needle.length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), match: false });
  return parts.length > 0 ? parts : [{ text, match: false }];
}

/** Ventana de filas a pintar (virtualización con filas de alto fijo). */
export function visibleWindow(input: { scrollTop: number; viewportHeight: number; rowHeight: number; total: number; overscan?: number }) {
  const overscan = input.overscan ?? 8;
  const first = Math.max(0, Math.floor(input.scrollTop / input.rowHeight) - overscan);
  const count = Math.ceil(input.viewportHeight / input.rowHeight) + overscan * 2;
  return { start: first, end: Math.min(input.total, first + count) };
}

/** Desplazamiento necesario para que una fila quede a la vista (o null si ya lo está). */
export function scrollToReveal(input: { index: number; scrollTop: number; viewportHeight: number; rowHeight: number; headerHeight?: number }) {
  const top = input.index * input.rowHeight;
  const bottom = top + input.rowHeight;
  const header = input.headerHeight ?? 0;
  if (top < input.scrollTop) return top;
  if (bottom > input.scrollTop + input.viewportHeight - header) return bottom - input.viewportHeight + header;
  return null;
}
