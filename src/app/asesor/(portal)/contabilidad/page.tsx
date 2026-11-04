import type { Metadata } from "next";

import { AdvisorDownloadList } from "@/components/advisor/advisor-download-list";
import { AdvisorPeriodBar } from "@/components/advisor/advisor-period-bar";
import { InlineAlert, PageSection } from "@/components/ui/page";
import { advisorPeriodQuery } from "@/server/advisor/period";

import { loadPortalPage, type PortalSearchParams } from "../load";

export const metadata: Metadata = { title: "Contabilidad" };

export default async function AdvisorAccountingPage({ searchParams }: { searchParams: PortalSearchParams }) {
  const { years, period } = await loadPortalPage(searchParams, "accounting");
  if (!period) return <InlineAlert tone="warning">La empresa todavía no tiene ejercicios contables.</InlineAlert>;
  const query = advisorPeriodQuery(period);
  return (
    <>
      <AdvisorPeriodBar action="/asesor/contabilidad" period={period} years={years} />
      <PageSection description="Se generan en el momento con los asientos registrados. Para importarlos en tu programa de contabilidad, usa el diario." title={`Libros contables · ${period.period.label}`}>
        <AdvisorDownloadList
          items={[
            { key: "paquete", title: "Paquete contable y fiscal", description: "Diario, mayor, sumas y saldos, libros registro de IVA y PDF de los modelos del periodo, en un ZIP con LEEME.", href: `/api/advisor/books/paquete?${query}`, kind: "zip", primary: true },
            { key: "diario", title: "Libro diario", description: "Cada asiento con todas sus líneas: fecha, número, concepto, origen, cuenta, debe y haber.", href: `/api/advisor/books/diario?${query}`, kind: "xlsx" },
            { key: "mayor", title: "Libro mayor", description: "Movimientos por cuenta con saldo anterior y saldo acumulado.", href: `/api/advisor/books/mayor?${query}`, kind: "xlsx" },
            { key: "sumas-y-saldos", title: "Balance de sumas y saldos", description: "Saldo inicial, debe, haber y saldo final de cada cuenta (sin regularización, cierre ni apertura).", href: `/api/advisor/books/sumas-y-saldos?${query}`, kind: "xlsx" },
          ]}
          testId="advisor-books"
        />
      </PageSection>
    </>
  );
}
