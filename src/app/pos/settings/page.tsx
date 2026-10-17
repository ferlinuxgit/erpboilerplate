import type { Metadata } from "next";

import QRCode from "qrcode";

import { BookingSettings } from "@/components/bookings/booking-settings";
import { AreasTablesManager, StaffPins, StationsEditor } from "@/components/hospitality/hospitality-settings";
import { RegisterForm, RegisterList } from "@/components/pos/register-settings";
import { InlineAlert, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { can } from "@/lib/rbac";
import type { TableShape } from "@/modules/hospitality/floor-plan";
import { appBaseUrl } from "@/server/email/templates";
import { isModuleEnabled } from "@/server/modules/service";
import { getBookingSettings } from "@/server/pos/bookings";
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
  const [areas, stations, staff, bookings] = hospitalityEnabled
    ? await Promise.all([listAreasWithTables(ctx.company.id), listCategoryStations(ctx.company.id), listStaff(ctx.company.id, ctx.tenant.id), getBookingSettings(ctx.company.id)])
    : [[], [], [], null];
  const baseUrl = appBaseUrl();
  const qrDataUrl = bookings ? await QRCode.toDataURL(`${baseUrl}/reservar/${bookings.slug}`, { margin: 1, width: 288 }).catch(() => null) : null;
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
          <PageSection className="scroll-mt-24" description="Dibuja cada sala como es tu local: arrastra las mesas, elige forma y tamaño. Es el plano que verán los camareros en las cajas en modo «Mesas»." id="mesas" title="Salas y mesas">
            <AreasTablesManager areas={areas.map((area) => ({ id: area.id, name: area.name, bookable: area.bookable, tables: area.tables.map((table) => ({ id: table.id, name: table.name, seats: table.seats, isActive: table.isActive, bookable: table.bookable, shape: table.shape as TableShape, posX: table.posX, posY: table.posY, width: table.width, height: table.height })) }))} canManage={canManage} />
          </PageSection>
          {bookings ? (
            <PageSection className="scroll-mt-24" description="Formulario público para que tus clientes reserven mesa: se asigna la mesa sola según el plano y las reservas ya hechas." id="reservas" title="Reservas online">
              <BookingSettings baseUrl={baseUrl} canManage={canManage} initial={bookings} qrDataUrl={qrDataUrl} registers={registers.filter((register) => register.mode === "TABLES").map((register) => ({ id: register.id, name: register.name }))} />
            </PageSection>
          ) : null}
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
