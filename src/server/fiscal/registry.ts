import type { FiscalProvider } from "@/server/fiscal/provider";
import { esFiscalProvider } from "@/server/fiscal/providers/es/provider";
import { frFiscalProvider } from "@/server/fiscal/providers/fr/provider";
import { ptFiscalProvider } from "@/server/fiscal/providers/pt/provider";

const registry: Record<string, FiscalProvider> = {
  ES: esFiscalProvider,
  PT: ptFiscalProvider,
  FR: frFiscalProvider,
};

export function getFiscalProvider(countryCode: string): FiscalProvider {
  return registry[countryCode] ?? esFiscalProvider;
}
