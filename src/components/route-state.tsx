import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type RouteStateProps = {
  title: string;
  description: string;
  actionHref?: string;
  actionLabel?: string;
};

export function RouteLoadingState({ title, description }: RouteStateProps) {
  return (
    <main className="w-full space-y-3 p-3" aria-busy="true" aria-live="polite">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="h-4 w-2/5 animate-pulse bg-muted" />
          <div className="h-16 animate-pulse border border-window-shadow bg-muted" />
          <div className="grid gap-2 md:grid-cols-3">
            <div className="h-12 animate-pulse border border-window-shadow bg-muted" />
            <div className="h-12 animate-pulse border border-window-shadow bg-muted" />
            <div className="h-12 animate-pulse border border-window-shadow bg-muted" />
          </div>
        </CardContent>
      </Card>
    </main>
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
    <main className="flex min-h-[70vh] w-full items-center justify-center p-3">
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
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
              Volver al dashboard
            </Link>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

export function RouteNotFoundState({ actionHref = "/dashboard", actionLabel = "Volver al dashboard", description, title }: RouteStateProps) {
  return (
    <main className="flex min-h-[70vh] w-full items-center justify-center p-3">
      <Card className="max-w-xl text-center">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
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
