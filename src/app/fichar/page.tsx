import type { Metadata } from "next";

import { ClockKiosk } from "@/components/timesheets/clock-kiosk";
import { requireContext } from "@/lib/current-context";

export const metadata: Metadata = { title: "Fichar" };

/** Tablet de fichar del local (pantalla completa, cada trabajador con su PIN). */
export default async function ClockKioskPage() {
  const ctx = await requireContext("timesheet.own");
  return <ClockKiosk companyName={ctx.company.name} />;
}
