import type { Metadata } from "next";
import { headers } from "next/headers";

import { PublicBookingShell } from "@/components/bookings/public-shell";
import { PublicMenuView } from "@/components/menu/public-menu";
import { MENU_TEXT, pickLang } from "@/modules/hospitality/menu";
import { getPublicMenu } from "@/server/pos/menu";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ lang?: string; mesa?: string; embed?: string }> };

async function load({ params, searchParams }: Props) {
  const [{ slug }, query, headerList] = await Promise.all([params, searchParams, headers()]);
  const lang = pickLang(headerList.get("accept-language"), query.lang);
  const tableId = query.mesa && /^[\w-]{1,64}$/.test(query.mesa) ? query.mesa : null;
  return { lang, tableId, embed: query.embed === "1", menu: await getPublicMenu(slug, lang, tableId) };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { lang, menu } = await load(props);
  return { title: menu ? `${MENU_TEXT[lang].menu} · ${menu.name}` : MENU_TEXT[lang].menu, description: menu?.intro ?? undefined };
}

/** Carta digital pública: se abre con el QR de la mesa o del local, sin cuenta. */
export default async function PublicMenuPage(props: Props) {
  const { lang, tableId, embed, menu } = await load(props);
  const text = MENU_TEXT[lang];
  if (!menu) {
    return (
      <PublicBookingShell embed={embed} label={text.menu} name={text.menu}>
        <h1 className="font-mono text-lg font-bold">{text.unavailableTitle}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{text.unavailableBody}</p>
      </PublicBookingShell>
    );
  }
  return (
    <PublicBookingShell address={menu.address} embed={embed} label={text.menu} logo={menu.logo} name={menu.name} phone={menu.phone} wide>
      <PublicMenuView embed={embed} lang={lang} menu={menu} tableId={tableId} />
    </PublicBookingShell>
  );
}
