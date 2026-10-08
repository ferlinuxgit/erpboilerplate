import type { ReactNode } from "react";

import { SETTINGS_HOME, settingsSections } from "@/components/settings/settings-catalog";
import { PageHeader } from "@/components/ui/page";

/** Cabecera común de las secciones de Configuración: miga de pan al índice y texto del catálogo. */
export function SettingsPageHeader({ sectionId, actions, meta }: { sectionId: string; actions?: ReactNode; meta?: ReactNode }) {
  const section = settingsSections.find((candidate) => candidate.id === sectionId);
  if (!section) throw new Error(`Sección de configuración desconocida: ${sectionId}`);
  return (
    <PageHeader
      actions={actions}
      breadcrumbs={[{ label: "Configuración", href: SETTINGS_HOME }, { label: section.label }]}
      description={section.description}
      meta={meta}
      title={section.label}
    />
  );
}
