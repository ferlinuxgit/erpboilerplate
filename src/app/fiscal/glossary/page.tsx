import type { Metadata } from "next";
import Link from "next/link";

import { glossaryEntries, type GlossaryEntry } from "@/components/help/glossary";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";

export const metadata: Metadata = { title: "Ayuda: glosario fiscal y contable" };

const sections: Array<{ category: GlossaryEntry["category"]; title: string; description: string }> = [
  { category: "fiscal", title: "Impuestos y modelos", description: "Qué es cada modelo de Hacienda y cuándo te afecta." },
  { category: "contabilidad", title: "Contabilidad", description: "Los conceptos básicos para entender tus libros y estados financieros." },
];

export default async function GlossaryPage() {
  await requireContext("fiscal.read");
  const entries: readonly GlossaryEntry[] = glossaryEntries;
  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[{ label: "Fiscalidad", href: "/fiscal" }, { label: "Ayuda" }]}
        title="Ayuda: glosario fiscal y contable"
        description="Explicaciones en lenguaje llano. Son orientativas: ante una duda concreta, consulta con tu asesor."
      />
      <nav aria-label="Términos del glosario" className="rounded-[2px] border border-window-dark-shadow bg-card p-2.5">
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
          {entries.map((entry) => (
            <li key={entry.id}>
              <a className="link" href={`#${entry.id}`}>{entry.term}</a>
            </li>
          ))}
        </ul>
      </nav>
      {sections.map((section) => (
        <PageSection description={section.description} key={section.category} title={section.title}>
          <dl className="divide-y divide-window-shadow">
            {entries.filter((entry) => entry.category === section.category).map((entry) => (
              <div className="scroll-mt-4 py-2.5" id={entry.id} key={entry.id}>
                <dt className="font-mono text-sm font-bold">{entry.term}</dt>
                <dd className="mt-1 max-w-3xl space-y-1 text-sm">
                  <p>{entry.short}</p>
                  {entry.long ? <p className="text-muted-foreground">{entry.long}</p> : null}
                  {entry.href ? (
                    <p>
                      <Link className="link" href={entry.href}>Ir a la sección relacionada</Link>
                    </p>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
        </PageSection>
      ))}
    </PageShell>
  );
}
