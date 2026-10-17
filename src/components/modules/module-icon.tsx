import type { Icon } from "@phosphor-icons/react";
import { Bank, CashRegister, ClipboardText, Clock, FileText, ForkKnife, Package, Scan, UsersFour } from "@phosphor-icons/react/dist/ssr";

import type { ModuleId } from "@/modules/registry";

const icons: Record<ModuleId, Icon> = {
  "sales-documents": FileText,
  "purchase-orders": ClipboardText,
  inventory: Package,
  banking: Bank,
  "invoice-reading": Scan,
  crm: UsersFour,
  pos: CashRegister,
  hospitality: ForkKnife,
  timesheets: Clock,
};

export function ModuleIcon({ id, className }: { id: ModuleId; className?: string }) {
  const Component = icons[id];
  return <Component aria-hidden="true" className={className} />;
}
