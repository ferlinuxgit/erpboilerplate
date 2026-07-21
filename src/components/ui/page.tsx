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
  neutral: "border-window-dark-shadow bg-window-panel text-window-text",
  info: "border-info bg-info/15 text-info",
  success: "border-success bg-success/15 text-success",
  warning: "border-warning bg-warning/15 text-warning",
  danger: "border-destructive bg-destructive/15 text-destructive",
};

const metricToneClasses = {
  neutral: "border-window-dark-shadow",
  info: "border-l-4 border-l-info",
  success: "border-l-4 border-l-success",
  warning: "border-l-4 border-l-warning",
  danger: "border-l-4 border-l-destructive",
};

export function PageShell({ children, className }: PageShellProps) {
  return (
    <main
      className={cn(
        "w-full space-y-3 px-2 pb-4 pt-2 sm:px-3 lg:px-3 lg:pb-4 lg:pt-3",
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
        "grid gap-2 rounded-[2px] border border-window-dark-shadow bg-card px-3 py-2 shadow-[inset_1px_1px_0_var(--window-highlight),inset_-1px_-1px_0_var(--window-shadow)] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4",
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        {backHref || eyebrow || meta ? (
          <div className="flex min-h-5 min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {backHref ? (
              <Link
                className={cn(
                  buttonVariants({ variant: "link", size: "xs" }),
                  "-ml-1 w-fit border-0 px-1 text-[0.62rem] text-muted-foreground hover:text-foreground",
                )}
                href={backHref}
              >
                <ArrowLeft aria-hidden="true" />
                {backLabel}
              </Link>
            ) : null}
            {eyebrow ? (
              <p className="font-mono text-[0.6rem] font-bold uppercase tracking-[0.07em] text-primary">
                [ {eyebrow} ]
              </p>
            ) : null}
            {meta ? <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">{meta}</div> : null}
          </div>
        ) : null}
        <div className="flex min-w-0 flex-col gap-0.5 lg:flex-row lg:items-baseline lg:gap-3">
          <h1 className="shrink-0 font-mono text-lg font-bold leading-tight text-foreground sm:text-xl">
            {title}
          </h1>
          {description ? (
            <p className="min-w-0 max-w-5xl text-xs leading-4 text-muted-foreground lg:truncate">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div
          aria-label="Acciones de la página"
          className="flex w-full flex-wrap items-center gap-1.5 border-t border-window-shadow pt-2 sm:w-auto sm:max-w-[48rem] sm:justify-end sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0 [&>a]:h-8 [&>a]:grow [&>a]:px-2.5 [&>button]:h-8 [&>button]:grow sm:[&>a]:grow-0 sm:[&>button]:grow-0 [&>[aria-label]]:size-8 [&>[aria-label]]:grow-0 [&>[aria-label]]:px-0"
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
        className={cn(
          "overflow-hidden rounded-[2px] border border-window-dark-shadow bg-card shadow-[inset_1px_1px_0_var(--window-highlight),inset_-1px_-1px_0_var(--window-shadow)]",
          className,
        )}
        {...props}
      >
        <div className="flex flex-col gap-1 border-b border-window-dark-shadow bg-window-panel px-2.5 py-1.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 sm:flex sm:items-baseline sm:gap-2">
            <h2 className="shrink-0 font-mono text-[0.78rem] font-bold leading-snug">
              {title}
            </h2>
            {description ? (
              <p className="min-w-0 max-w-5xl text-xs leading-4 text-muted-foreground sm:truncate">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 flex-wrap gap-1">{actions}</div>
          ) : null}
        </div>
        <div className={cn("p-2.5", contentClassName)}>{children}</div>
      </section>
    );
  }

  return (
    <Card className={className} size={size} {...props}>
      <CardHeader className="border-b border-window-dark-shadow bg-window-panel pb-2">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1">
            <CardTitle>{title}</CardTitle>
            {description ? (
              <CardDescription>{description}</CardDescription>
            ) : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 flex-wrap gap-1">{actions}</div>
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
        "border border-dashed border-window-dark-shadow bg-window-panel px-4 py-5 text-center",
        className,
      )}
    >
      <p className="font-mono text-sm font-bold">{title}</p>
      <p className="mx-auto mt-1 max-w-xl text-xs leading-4 text-muted-foreground">
        {description}
      </p>
      {action ? <div className="mt-2 flex justify-center">{action}</div> : null}
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
        "rounded-[1px] border p-2 font-mono text-xs shadow-[inset_1px_1px_0_rgba(255,255,255,0.5)]",
        alertToneClasses[tone],
        className,
      )}
      role={tone === "danger" ? "alert" : "status"}
      {...props}
    >
      {title ? <p className="mb-1 font-bold">{title}</p> : null}
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
      <p className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.04em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-xl font-bold tabular-nums">{value}</p>
      {helper ? (
        <p className="mt-1 text-[0.7rem] leading-4 text-muted-foreground">{helper}</p>
      ) : null}
    </>
  );

  const classes = cn(
    "rounded-[1px] border bg-card px-2.5 py-2 shadow-[inset_1px_1px_0_var(--window-highlight),inset_-1px_-1px_0_var(--window-shadow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
    metricToneClasses[tone],
    href && "hover:bg-window-highlight active:translate-x-px active:translate-y-px",
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
