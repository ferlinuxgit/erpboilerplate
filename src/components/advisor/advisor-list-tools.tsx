import { MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Búsqueda dentro del periodo (formulario GET que conserva ejercicio y periodo). */
export function AdvisorSearch({ action, yearId, periodKey, q, placeholder }: { action: string; yearId: string; periodKey: string; q: string; placeholder: string }) {
  return (
    <form action={action} className="flex flex-wrap items-center gap-1.5" method="get" role="search">
      <input name="year" type="hidden" value={yearId} />
      <input name="period" type="hidden" value={periodKey} />
      <Input aria-label="Buscar" className="w-72 max-w-full" defaultValue={q} name="q" placeholder={placeholder} type="search" />
      <Button type="submit" variant="secondary">
        <MagnifyingGlass aria-hidden="true" />
        Buscar
      </Button>
      {q ? <Link className={buttonVariants({ variant: "ghost" })} href={`${action}?year=${encodeURIComponent(yearId)}&period=${encodeURIComponent(periodKey)}`}>Quitar búsqueda</Link> : null}
    </form>
  );
}

/** Paginación simple (anterior/siguiente) conservando los parámetros. */
export function AdvisorPagination({ action, params, page, pageSize, total }: { action: string; params: Record<string, string>; page: number; pageSize: number; total: number }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const href = (target: number) => `${action}?${new URLSearchParams({ ...params, page: String(target) }).toString()}`;
  return (
    <nav aria-label="Paginación" className="flex items-center justify-end gap-2 text-xs">
      {page > 1 ? <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={href(page - 1)}>Anterior</Link> : null}
      <span className="font-mono">Página {page} de {pages}</span>
      {page < pages ? <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={href(page + 1)}>Siguiente</Link> : null}
    </nav>
  );
}
