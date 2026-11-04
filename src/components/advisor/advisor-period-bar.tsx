import { CalendarBlank } from "@phosphor-icons/react/dist/ssr";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { AdvisorFiscalYear, AdvisorPeriod } from "@/server/advisor/period";

const formatDay = (value: string) => value.split("-").reverse().join("/");

/** Selector de ejercicio y periodo (formulario GET: el periodo viaja en la URL). */
export function AdvisorPeriodBar({ action, period, years, children }: { action: string; period: AdvisorPeriod; years: AdvisorFiscalYear[]; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-control border border-window-dark-shadow bg-window-panel p-2 lg:flex-row lg:items-end lg:justify-between">
      <form action={action} className="flex flex-wrap items-end gap-2" method="get">
        <div className="space-y-1">
          <Label htmlFor="advisor-year">Ejercicio</Label>
          <Select className="w-32" defaultValue={period.year.id} id="advisor-year" name="year">
            {[...years].reverse().map((year) => <option key={year.id} value={year.id}>{year.code}{year.isClosed ? " (cerrado)" : ""}</option>)}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="advisor-period">Periodo</Label>
          <Select className="w-48" defaultValue={period.period.key} id="advisor-period" name="period">
            {period.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
        </div>
        <Button type="submit" variant="secondary">
          <CalendarBlank aria-hidden="true" />
          Ver periodo
        </Button>
        <p className="pb-1.5 font-mono text-xs text-muted-foreground" data-testid="advisor-period-label">
          {period.period.label}: del {formatDay(period.from)} al {formatDay(period.to)}
        </p>
      </form>
      {children ? <div className="flex flex-wrap gap-1.5">{children}</div> : null}
    </div>
  );
}
