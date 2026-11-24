import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AdvisorLoginForm } from "@/components/advisor/advisor-login-form";
import { getAdvisorContext } from "@/server/advisor/auth";

export const metadata: Metadata = { title: "Portal del asesor", robots: { index: false, follow: false } };

export default async function AdvisorLoginPage({ searchParams }: { searchParams: Promise<{ caducada?: string }> }) {
  if (await getAdvisorContext()) redirect("/asesor");
  const query = await searchParams;
  return (
    <main className="retro-checker grid min-h-dvh place-items-center px-2 py-4 sm:px-6 sm:py-10">
      <div className="w-full max-w-md overflow-hidden rounded-surface border border-window-dark-shadow bg-window-surface shadow-window-lg">
        <div className="flex h-11 items-center gap-2 border-b border-window-dark-shadow bg-chrome-active px-2 text-chrome-active-foreground">
          <span aria-hidden="true" className="grid size-7 place-items-center border border-white/70 bg-window-highlight text-xs font-black text-window-text shadow-raised">N</span>
          <span className="font-mono text-sm font-bold">Norpie</span>
          <span aria-hidden="true" className="ml-auto truncate font-mono text-xs text-chrome-active-foreground/75">Asesoría</span>
        </div>
        <section className="p-3 sm:p-5">
          <AdvisorLoginForm notice={query.caducada ? "Tu sesión ha caducado. Vuelve a entrar para seguir descargando." : null} />
        </section>
      </div>
    </main>
  );
}
