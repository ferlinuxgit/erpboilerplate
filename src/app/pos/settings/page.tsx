import type { Metadata } from "next";

import { RegisterForm, RegisterList } from "@/components/pos/register-settings";
import { InlineAlert, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { can } from "@/lib/rbac";
import { isModuleEnabled } from "@/server/modules/service";
import { listBankAccountOptions, listRegisters, listWarehouseOptions } from "@/server/pos/service";

export const metadata: Metadata = { title: "TPV · Cajas" };

export default async function PosSettingsPage() {
  const ctx = await requireContext("pos.read");
  const canManage = can(ctx.membership.role, "pos.manage");
  const [registers, bankAccounts, warehouses, inventoryEnabled] = await Promise.all([
    listRegisters(ctx.company.id),
    listBankAccountOptions(ctx.company.id),
    listWarehouseOptions(ctx.company.id),
    isModuleEnabled(ctx.company.id, "inventory"),
  ]);
  return (
    <PageShell>
      <PageHeader breadcrumbs={[{ label: "TPV", href: "/pos?choose=1" }, { label: "Cajas" }]} description="Cada caja tiene su serie de tickets, el almacén del que sale el stock y el banco donde entran los cobros con tarjeta." title="Cajas del TPV" />
      <InlineAlert tone="neutral">
        Los tickets son facturas simplificadas: se emiten con VeriFactu, se contabilizan (ventas, IVA repercutido y cobro en caja 570 o en el banco de la tarjeta) y entran en el modelo 303 como cualquier factura.
      </InlineAlert>
      <PageSection title="Cajas"><RegisterList bankAccounts={bankAccounts} inventoryEnabled={inventoryEnabled} registers={registers.map((register) => ({ ...register, hasCard: Boolean(register.cardPaymentMethodId) }))} warehouses={warehouses} /></PageSection>
      {canManage ? (
        <PageSection title="Nueva caja"><RegisterForm bankAccounts={bankAccounts} inventoryEnabled={inventoryEnabled} warehouses={warehouses} /></PageSection>
      ) : <InlineAlert tone="neutral">Solo un administrador puede crear o cambiar cajas.</InlineAlert>}
    </PageShell>
  );
}
