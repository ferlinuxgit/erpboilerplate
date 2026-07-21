import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import type { HTMLAttributes, ReactNode } from "react";

import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

type PageShellProps = {
  children: ReactNode;
  className?: string;
};

type PageHeaderProps = {
  title: string;
  description?: ReactNode;
  eyebrow?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  backHref?: string;
  backLabel?: string;
  className?: string;
};

type PageSectionProps = Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  size?: "default" | "sm";
  variant?: "plain" | "surface";
};

type EmptyStateProps = {
  title: string;
  description: ReactNode;
  action?: ReactNode;
  className?: string;
};

type InlineAlertProps = HTMLAttributes<HTMLDivElement> & {
  title?: string;
  children: ReactNode;
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
};

type MetricCardProps = {
  label: string;
  value: ReactNode;
  helper?: ReactNode;
  href?: string;
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
  className?: string;
};

const alertToneClasses = {
  neutral: "border-border bg-muted/40 text-foreground",
  info: "border-sky-200 bg-sky-50 text-sky-950",
  success: "border-emerald-200 bg-emerald-50 text-emerald-950",
  warning: "border-amber-200 bg-amber-50 text-amber-950",
  danger: "border-red-200 bg-red-50 text-red-950",
};

const metricToneClasses = {
  neutral: "hover:border-primary/50",
  info: "border-sky-200 bg-sky-50/50",
  success: "border-emerald-200 bg-emerald-50/50",
  warning: "border-amber-200 bg-amber-50/50",
  danger: "border-red-200 bg-red-50/50",
};

export function PageShell({ children, className }: PageShellProps) {
  return (
    <main
      className={cn(
        "mx-auto w-full max-w-[1480px] space-y-8 px-4 pb-10 pt-5 sm:px-6 sm:pt-6 lg:px-8 lg:pb-14 lg:pt-8",
        className,
      )}
    >
      {children}
    </main>
  );
}

export function PageHeader({
  actions,
  backHref,
  backLabel = "Volver",
  className,
  description,
  eyebrow,
  meta,
  title,
}: PageHeaderProps) {
  return (
    <header
      data-slot="page-header"
      className={cn(
        "relative isolate grid min-h-36 gap-6 overflow-hidden rounded-2xl border border-border/80 bg-card px-5 py-5 shadow-[0_1px_2px_rgba(25,55,45,0.03),0_12px_40px_rgba(25,55,45,0.035)] sm:px-6 sm:py-6 lg:min-h-40 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-10 lg:px-8 lg:py-7",
        "before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-primary",
        "after:pointer-events-none after:absolute after:-right-24 after:-top-28 after:-z-10 after:size-80 after:rounded-full after:bg-primary/[0.045] after:blur-3xl",
        className,
      )}
    >
      <div className="min-w-0 self-stretch space-y-3 lg:flex lg:flex-col lg:justify-end">
        {backHref ? (
          <Link
            className={cn(
              buttonVariants({ variant: "link", size: "sm" }),
              "-ml-3 w-fit text-muted-foreground hover:text-foreground lg:mb-auto",
            )}
            href={backHref}
          >
            <ArrowLeft aria-hidden="true" />
            {backLabel}
          </Link>
        ) : null}
        {eyebrow ? (
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-primary/75">
            {eyebrow}
          </p>
        ) : null}
        <div className="space-y-1.5">
          <h1 className="max-w-4xl text-[1.7rem] font-semibold leading-[1.08] tracking-[-0.04em] text-foreground text-balance sm:text-[2rem] lg:text-[2.25rem]">
            {title}
          </h1>
          {description ? (
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground text-pretty sm:text-[0.95rem]">
              {description}
            </p>
          ) : null}
        </div>
        {meta ? (
          <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
            {meta}
          </div>
        ) : null}
      </div>
      {actions ? (
        <div
          aria-label="Acciones de la página"
          className="flex w-full flex-wrap items-center gap-2 border-t border-border/70 pt-4 lg:w-auto lg:max-w-[42rem] lg:justify-end lg:border-l lg:border-t-0 lg:pl-7 lg:pt-0 [&>a]:h-11 [&>a]:grow [&>a]:px-4 [&>button]:h-11 [&>button]:grow sm:[&>a]:grow-0 sm:[&>button]:grow-0 [&>[aria-label]]:size-11 [&>[aria-label]]:grow-0 [&>[aria-label]]:px-0"
          role="group"
        >
          {actions}
        </div>
      ) : null}
    </header>
  );
}

export function PageSection({
  actions,
  children,
  className,
  contentClassName,
  description,
  size = "default",
  title,
  variant = "plain",
  ...props
}: PageSectionProps) {
  if (variant === "plain") {
    return (
      <section
        className={cn("border-t border-border/90 pt-5", className)}
        {...props}
      >
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <h2 className="font-heading text-base font-semibold leading-snug tracking-[-0.01em]">
              {title}
            </h2>
            {description ? (
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
          ) : null}
        </div>
        <div className={contentClassName}>{children}</div>
      </section>
    );
  }

  return (
    <Card className={className} size={size} {...props}>
      <CardHeader className="border-b border-border/70 pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <CardTitle>{title}</CardTitle>
            {description ? (
              <CardDescription>{description}</CardDescription>
            ) : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className={contentClassName}>{children}</CardContent>
    </Card>
  );
}

export function EmptyState({
  action,
  className,
  description,
  title,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-dashed border-border bg-muted/25 px-6 py-10 text-center",
        className,
      )}
    >
      <p className="font-semibold tracking-[-0.01em]">{title}</p>
      <p className="mx-auto mt-1.5 max-w-xl text-sm leading-6 text-muted-foreground">
        {description}
      </p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function InlineAlert({
  children,
  className,
  title,
  tone = "neutral",
  ...props
}: InlineAlertProps) {
  return (
    <div
      className={cn(
        "rounded-lg border p-4 text-sm",
        alertToneClasses[tone],
        className,
      )}
      role={tone === "danger" ? "alert" : "status"}
      {...props}
    >
      {title ? <p className="mb-1 font-medium">{title}</p> : null}
      <div className="text-current/90">{children}</div>
    </div>
  );
}

export function MetricCard({
  className,
  helper,
  href,
  label,
  tone = "neutral",
  value,
}: MetricCardProps) {
  const content = (
    <>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      {helper ? (
        <p className="mt-2 text-xs text-muted-foreground">{helper}</p>
      ) : null}
    </>
  );

  const classes = cn(
    "border-t-2 border-border bg-card/25 px-4 py-4 transition-[background-color,border-color,transform] duration-200 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/15",
    metricToneClasses[tone],
    href && "hover:-translate-y-0.5 hover:border-primary/30 hover:bg-accent/30",
    className,
  );

  if (href) {
    return (
      <Link className={classes} href={href}>
        {content}
      </Link>
    );
  }

  return <div className={classes}>{content}</div>;
}
