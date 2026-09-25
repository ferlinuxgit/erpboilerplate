import { BankConnectionsManager } from "@/components/treasury/bank-connections-manager";
import { EmptyState, InlineAlert, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { bankSyncIntervalHours, isBankConnectionsEnabled } from "@/lib/bank-connections-config";
import { requireContext } from "@/lib/current-context";
import { can } from "@/lib/rbac";
import { listBankConnections } from "@/server/bank-connections/service";
import { listBankAccounts } from "@/server/treasury/service";

const resultMessages: Record<string, { tone: "success" | "warning" | "danger"; text: string }> = {
  linked: { tone: "success", text: "Banco conectado. Revisa a qué cuenta va cada una y pulsa «Sincronizar ahora» para traer los movimientos." },
  "not-linked": { tone: "warning", text: "El banco no confirmó el permiso (lo cancelaste o caducó el enlace). Puedes intentarlo de nuevo." },
  error: { tone: "danger", text: "No pudimos completar la conexión con el banco. Inténtalo de nuevo en unos minutos." },
  missing: { tone: "warning", text: "Volviste del banco sin la referencia de la conexión. Inténtalo de nuevo." },
};

export default async function BankConnectionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext("treasury.read");
  const params = await searchParams;
  const result = typeof params.result === "string" ? resultMessages[params.result] : undefined;
  const enabled = isBankConnectionsEnabled();
  const [connections, accounts] = enabled ? await Promise.all([listBankConnections(ctx.company.id), listBankAccounts(ctx.company.id)]) : [[], []];
  return (
    <PageShell>
      <PageHeader
        eyebrow="Tesorería"
        title="Conexión con el banco (PSD2)"
        description="Recibe los movimientos de tus cuentas automáticamente, sin descargar extractos."
        backHref="/treasury"
        backLabel="Volver al resumen"
      />
      {result ? <InlineAlert tone={result.tone}>{result.text}</InlineAlert> : null}
      <PageSection title="Cómo funciona y qué datos vemos" description="Tu banco, tu permiso.">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>La conexión usa la normativa europea PSD2 a través de GoCardless (Bank Account Data), entidad autorizada para acceder a información de cuentas.</li>
          <li>Das el permiso en la web de tu banco con tus claves habituales: nunca las vemos ni las guardamos.</li>
          <li>Es de solo lectura: saldos, datos de la cuenta y movimientos. No se puede mover dinero.</li>
          <li>El permiso dura 90 días (lo marca la ley); te avisaremos antes para renovarlo. Puedes retirarlo cuando quieras aquí o en tu banco.</li>
          <li>Los movimientos se sincronizan cada {bankSyncIntervalHours()} horas y cuando pulses «Sincronizar ahora»; entran como en la importación de extractos, sin duplicados, y quedan pendientes de conciliar.</li>
        </ul>
      </PageSection>
      {!enabled ? (
        <EmptyState
          title="Conexión automática no disponible"
          description="El administrador del servidor debe configurar las credenciales de GoCardless Bank Account Data (GOCARDLESS_SECRET_ID y GOCARDLESS_SECRET_KEY). Mientras tanto puedes importar los extractos en CSV, Excel o Norma 43 desde «Importar extracto»."
        />
      ) : (
        <PageSection title="Bancos conectados" description="Estado del permiso, última sincronización y cuenta de destino de cada cuenta del banco.">
          <BankConnectionsManager
            accounts={accounts.filter((account) => account.isActive).map((account) => ({ id: account.id, bankName: account.bankName, iban: account.iban }))}
            canWrite={can(ctx.membership.role, "treasury.write")}
            connections={connections}
          />
        </PageSection>
      )}
    </PageShell>
  );
}
