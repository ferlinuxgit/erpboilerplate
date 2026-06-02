import Link from "next/link";
import type { HTMLAttributes, ReactNode } from "react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

type PageSectionProps = {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  size?: "default" | "sm";
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
  return <main className={cn("mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8", className)}>{children}</main>;
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
    <section className={cn("flex flex-col gap-4 border-b pb-5 md:flex-row md:items-end md:justify-between", className)}>
      <div className="min-w-0 space-y-2">
        {eyebrow ? <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{eyebrow}</p> : null}
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">{title}</h1>
          {description ? <p className="max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {meta ? <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">{meta}</div> : null}
      </div>
      {actions || backHref ? (
        <div className="flex shrink-0 flex-wrap gap-2">
          {backHref ? (
            <Link className={buttonVariants({ variant: "outline" })} href={backHref}>
              {backLabel}
            </Link>
          ) : null}
          {actions}
        </div>
      ) : null}
    </section>
  );
}

export function PageSection({ actions, children, className, contentClassName, description, size = "default", title }: PageSectionProps) {
  return (
    <Card className={className} size={size}>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <CardTitle>{title}</CardTitle>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
        </div>
      </CardHeader>
      <CardContent className={contentClassName}>{children}</CardContent>
    </Card>
  );
}

export function EmptyState({ action, className, description, title }: EmptyStateProps) {
  return (
    <div className={cn("rounded-lg border border-dashed bg-muted/20 p-6 text-center", className)}>
      <p className="font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">{description}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function InlineAlert({ children, className, title, tone = "neutral", ...props }: InlineAlertProps) {
  return (
    <div className={cn("rounded-lg border p-4 text-sm", alertToneClasses[tone], className)} role={tone === "danger" ? "alert" : "status"} {...props}>
      {title ? <p className="mb-1 font-medium">{title}</p> : null}
      <div className="text-current/90">{children}</div>
    </div>
  );
}

export function MetricCard({ className, helper, href, label, tone = "neutral", value }: MetricCardProps) {
  const content = (
    <>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      {helper ? <p className="mt-2 text-xs text-muted-foreground">{helper}</p> : null}
    </>
  );

  const classes = cn(
    "rounded-lg border bg-card p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    metricToneClasses[tone],
    href && "hover:bg-muted/40",
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
