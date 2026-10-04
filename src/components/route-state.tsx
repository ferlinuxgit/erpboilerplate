import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, PageShell } from "@/components/ui/page";
import { cn } from "@/lib/utils";

type RouteStateProps = {
  title: string;
  description: string;
  actionHref?: string;
  actionLabel?: string;
};

const skeletonClassName = "motion-safe:animate-pulse bg-muted";

/**
 * Esqueleto de carga con la misma geometría que la página final (PageShell + PageHeader,
 * fila de indicadores y una sección), para que el contenido no salte al llegar.
 */
export function RouteLoadingState({ title, description }: RouteStateProps) {
  return (
    <PageShell aria-busy="true" aria-live="polite">
      <PageHeader description={description} title={title} />
      <div aria-hidden="true" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div className="rounded-control border border-window-dark-shadow bg-card px-2.5 py-2 shadow-raised" key={index}>
            <div className={cn("h-3 w-1/2", skeletonClassName)} />
            <div className={cn("mt-2 h-6 w-2/3", skeletonClassName)} />
          </div>
        ))}
      </div>
      <section aria-hidden="true" className="overflow-hidden rounded-surface border border-window-dark-shadow bg-card shadow-raised">
        <div className="flex items-center gap-2 border-b border-window-dark-shadow bg-window-panel px-2.5 py-1.5">
          <div className={cn("h-5 w-40", skeletonClassName)} />
        </div>
        <div className="space-y-2 p-2.5">
          <div className={cn("h-9 border border-window-shadow", skeletonClassName)} />
          {[0, 1, 2, 3, 4].map((index) => (
            <div className={cn("h-7", skeletonClassName)} key={index} />
          ))}
        </div>
      </section>
    </PageShell>
  );
}

export function RouteErrorState({
  description,
  error,
  reset,
  title,
}: RouteStateProps & {
  error?: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-[70vh] w-full items-center justify-center p-3" role="alert">
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>
            <h1>{title}</h1>
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error?.digest ? (
            <p className="border border-window-shadow bg-muted p-2 font-mono text-xs text-muted-foreground">Código de error: {error.digest}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={reset}>
              Reintentar
            </Button>
            <Link className={cn(buttonVariants({ variant: "outline" }))} href="/dashboard">
              Volver al panel
            </Link>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

export function RouteNotFoundState({ actionHref = "/dashboard", actionLabel = "Volver al panel", description, title }: RouteStateProps) {
  return (
    <main className="flex min-h-[70vh] w-full items-center justify-center p-3">
      <Card className="max-w-xl text-center">
        <CardHeader>
          <CardTitle>
            <h1>{title}</h1>
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <Link className={cn(buttonVariants({ variant: "outline" }))} href={actionHref}>
            {actionLabel}
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
