import type { Metadata } from "next";

import { AreasTablesManager, StaffPins, StationsEditor } from "@/components/hospitality/hospitality-settings";
import { RegisterForm, RegisterList } from "@/components/pos/register-settings";
import { InlineAlert, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { can } from "@/lib/rbac";
import { isModuleEnabled } from "@/server/modules/service";
import { listAreasWithTables, listCategoryStations, listStaff } from "@/server/pos/hospitality";
import { listBankAccountOptions, listRegisters, listWarehouseOptions } from "@/server/pos/service";

export const metadata: Metadata = { title: "TPV · Cajas" };

export default async function PosSettingsPage() {
  const ctx = await requireContext("pos.read");
  const canManage = can(ctx.membership.role, "pos.manage");
  const [registers, bankAccounts, warehouses, inventoryEnabled, hospitalityEnabled] = await Promise.all([
    listRegisters(ctx.company.id),
    listBankAccountOptions(ctx.company.id),
    listWarehouseOptions(ctx.company.id),
    isModuleEnabled(ctx.company.id, "inventory"),
    isModuleEnabled(ctx.company.id, "hospitality"),
  ]);
  const [areas, stations, staff] = hospitalityEnabled
    ? await Promise.all([listAreasWithTables(ctx.company.id), listCategoryStations(ctx.company.id), listStaff(ctx.company.id, ctx.tenant.id)])
    : [[], [], []];
  return (
    <PageShell>
      <PageHeader breadcrumbs={[{ label: "TPV", href: "/pos?choose=1" }, { label: "Cajas" }]} description="Cada caja tiene su serie de tickets, el almacén del que sale el stock y el banco donde entran los cobros con tarjeta." title="Cajas del TPV" />
      <InlineAlert tone="neutral">
        Los tickets son facturas simplificadas: se emiten con VeriFactu, se contabilizan (ventas, IVA repercutido y cobro en caja 570 o en el banco de la tarjeta) y entran en el modelo 303 como cualquier factura.
      </InlineAlert>
      <PageSection title="Cajas"><RegisterList bankAccounts={bankAccounts} hospitalityEnabled={hospitalityEnabled} inventoryEnabled={inventoryEnabled} registers={registers.map((register) => ({ ...register, hasCard: Boolean(register.cardPaymentMethodId) }))} warehouses={warehouses} /></PageSection>
      {canManage ? (
        <PageSection title="Nueva caja"><RegisterForm bankAccounts={bankAccounts} hospitalityEnabled={hospitalityEnabled} inventoryEnabled={inventoryEnabled} warehouses={warehouses} /></PageSection>
      ) : <InlineAlert tone="neutral">Solo un administrador puede crear o cambiar cajas.</InlineAlert>}
      {hospitalityEnabled ? (
        <>
          <PageSection className="scroll-mt-24" description="El plano de mesas de las cajas en modo «Mesas»." id="mesas" title="Salas y mesas">
            <AreasTablesManager areas={areas.map((area) => ({ id: area.id, name: area.name, tables: area.tables.map((table) => ({ id: table.id, name: table.name, seats: table.seats, isActive: table.isActive })) }))} canManage={canManage} />
          </PageSection>
          <PageSection className="scroll-mt-24" description="Al enviar una cuenta, cada producto va a la pantalla (o impresora) de su estación según su categoría." id="cocina" title="Cocina y barra">
            <StationsEditor canManage={canManage} initial={stations} />
          </PageSection>
          <PageSection className="scroll-mt-24" description="En una tablet compartida cada camarero toca su nombre y pone su PIN: los pedidos y cobros quedan a su nombre." id="camareros" title="Camareros">
            <StaffPins canManage={canManage} staff={staff} />
          </PageSection>
        </>
      ) : null}
    </PageShell>
  );
}
