import type { Metadata } from "next";
import QRCode from "qrcode";

import { MenuDishes, MenuPublishing, MenuSections } from "@/components/menu/menu-admin";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { can } from "@/lib/rbac";
import { appBaseUrl } from "@/server/email/templates";
import { getMenuAdmin } from "@/server/pos/menu";

export const metadata: Metadata = { title: "TPV · Carta" };

/** Carta digital: publicación con QR, secciones con horario y fichas de los platos. */
export default async function MenuPage() {
  const ctx = await requireContext("pos.sell");
  const canManage = can(ctx.membership.role, "pos.manage");
  const data = await getMenuAdmin(ctx.company.id);
  const baseUrl = appBaseUrl();
  const qrDataUrl = await QRCode.toDataURL(`${baseUrl}/carta/${data.settings.slug}`, { margin: 1, width: 288 }).catch(() => null);
  return (
    <PageShell>
      <PageHeader breadcrumbs={[{ label: "TPV", href: "/pos?choose=1" }, { label: "Carta" }]} description="La carta que ven tus clientes al escanear el QR: sale de los artículos del TPV, así que los precios siempre coinciden." title="Carta digital" />
      <PageSection description="Enlace, QR y textos de bienvenida." id="publicar" title="Publicación">
        <MenuPublishing baseUrl={baseUrl} canManage={canManage} qrDataUrl={qrDataUrl} settings={data.settings} />
      </PageSection>
      <PageSection description="Agrupan los platos. Pueden servirse solo ciertos días u horas (desayunos, menú del día) y tener precio cerrado." id="secciones" title="Secciones">
        <MenuSections canManage={canManage} sections={data.sections} />
      </PageSection>
      <PageSection description="Marca qué sale en la carta y rellena alérgenos, descripción, inglés y foto. «Agotar» lo quita por hoy; mañana vuelve solo." id="platos" title="Platos y bebidas">
        <MenuDishes canManage={canManage} items={data.items} sections={data.sections} />
      </PageSection>
    </PageShell>
  );
}
