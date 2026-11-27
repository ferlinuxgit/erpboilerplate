import { InlineAlert, PageSection } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableContainer, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney, formatPercent } from "@/lib/format";
import {
  ANNUAL_SUMMARY_OF,
  MODELO_190_E_SUBKEYS,
  MODELO_190_G_SUBKEYS,
  MODELO_190_KEYS,
  MODELO_193_CODES,
  RENTAL_PROPERTY_SITUATIONS,
  type AnnualReconciliation,
  type WithholdingAllocation,
  type WithholdingBox,
  type WithholdingItem,
} from "@/server/fiscal/withholdings";
import type { WithholdingModelSummary } from "@/server/payroll/withholding-data";

type WithholdingModelViewProps = {
  model: WithholdingModelSummary;
  currencyCode: string;
  /** Detalle de partidas del periodo (solo en el cálculo en vivo; la foto de lo presentado no lo guarda). */
  items?: WithholdingItem[];
  /** Enseña también los avisos (en la ficha del modelo ya salen con el resto de comprobaciones). */
  showChecks?: boolean;
};

const ALLOCATION_LABELS: Record<WithholdingAllocation, string> = {
  payment: "Fecha de pago",
  accrual: "Devengo mensual",
  registration: "Fecha de registro",
  "registration-unpaid": "Registro (sin pago)",
  "registration-filed": "Registro (periodo presentado)",
};

const FAMILY_SITUATIONS: Record<number, string> = { 1: "1 · Monoparental con hijos", 2: "2 · Casado, cónyuge sin rentas", 3: "3 · Otra situación" };

function formatIso(iso: string) {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

function BoxesTable({ boxes, currencyCode, caption }: { boxes: WithholdingBox[]; currencyCode: string; caption: string }) {
  return (
    <TableContainer>
      <Table>
        <caption className="sr-only">{caption}</caption>
        <TableHeader>
          <TableRow>
            <TableHead className="w-20">Casilla</TableHead>
            <TableHead>Concepto</TableHead>
            <TableHead className="text-right">Importe</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {boxes.map((box) => (
            <TableRow key={box.box}>
              <TableCell className="font-mono">{box.box}</TableCell>
              <TableCell className={box.kind === "settlement" ? "font-bold" : undefined}>{box.label}</TableCell>
              <TableCell className={`whitespace-nowrap text-right font-mono ${box.kind === "settlement" ? "font-bold" : ""}`}>
                {box.kind === "count" ? box.amount : formatMoney(box.amount, currencyCode)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function Reconciliation({ annual, reconciliation, currencyCode }: { annual: "190" | "180" | "193"; reconciliation: AnnualReconciliation; currencyCode: string }) {
  const periodic = ANNUAL_SUMMARY_OF[annual];
  const money = (cents: number) => formatMoney(cents / 100, currencyCode);
  return (
    <PageSection
      title={`Cuadre con los modelos ${periodic} del año`}
      description={`La AEAT cruza las retenciones del ${annual} con la suma de los ${periodic} presentados. De un ${periodic} presentado se toma el importe que se presentó; del resto, el cálculo de hoy.`}
      contentClassName="space-y-3"
    >
      {reconciliation.balanced ? (
        <InlineAlert title="Cuadra" tone="success">El resumen anual y los modelos {periodic} suman {money(reconciliation.annualCents)}.</InlineAlert>
      ) : (
        <InlineAlert role="alert" title="No cuadra: no lo presentes así" tone="danger">
          El {annual} suma {money(reconciliation.annualCents)} de retenciones y los {periodic} del año suman {money(reconciliation.periodicCents)}: diferencia de {money(reconciliation.differenceCents)}. Lo habitual es que se hayan cambiado datos después de presentar un {periodic}: revisa ese periodo y presenta una complementaria, o corrige los datos.
        </InlineAlert>
      )}
      <TableContainer>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Periodo</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Resultado del {periodic}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reconciliation.periods.map((period) => (
              <TableRow key={period.period}>
                <TableCell className="font-mono">{period.period}</TableCell>
                <TableCell><StatusBadge tone={period.filed ? "success" : "neutral"}>{period.filed ? "Presentado" : "Sin presentar (cálculo de hoy)"}</StatusBadge></TableCell>
                <TableCell className="whitespace-nowrap text-right font-mono">{money(period.resultCents)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={2}>Suma de los {periodic}</TableCell>
              <TableCell className="whitespace-nowrap text-right font-mono">{money(reconciliation.periodicCents)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell colSpan={2}>Retenciones del {annual}</TableCell>
              <TableCell className="whitespace-nowrap text-right font-mono">{money(reconciliation.annualCents)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </TableContainer>
    </PageSection>
  );
}

/**
 * Vista de un modelo de retenciones: casillas del 111, 115 y 123, o perceptores y cuadre anual del
 * 190, 180 y 193. Sin estado: sirve en páginas de servidor.
 */
export function WithholdingModelView({ model, currencyCode, items, showChecks = false }: WithholdingModelViewProps) {
  const money = (cents: number) => formatMoney(cents / 100, currencyCode);
  const checks = model.checks.filter((check) => check.status !== "ok");

  return (
    <>
      {showChecks && checks.length > 0 ? (
        <div className="space-y-2">
          {checks.map((check) => (
            <InlineAlert key={check.code} title={check.title} tone={check.status === "blocking" ? "danger" : "warning"}>
              {check.detail} {check.action}
            </InlineAlert>
          ))}
        </div>
      ) : null}

      {model.boxes.length > 0 ? (
        <PageSection
          title={`Casillas del modelo ${model.code}`}
          description={`Numeración del diseño de registro oficial del ${model.code}. Las casillas de número de perceptores o de rentas son recuentos, no importes.`}
        >
          <BoxesTable boxes={model.boxes} caption={`Casillas del modelo ${model.code}`} currencyCode={currencyCode} />
        </PageSection>
      ) : null}

      {model.modelo190 ? (
        <>
          <Reconciliation annual="190" currencyCode={currencyCode} reconciliation={model.modelo190.reconciliation} />
          <PageSection title="Perceptores" description="Un registro por perceptor, clave y subclave de percepción.">
            <TableContainer>
              <Table className="min-w-[64rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead>NIF</TableHead>
                    <TableHead>Perceptor</TableHead>
                    <TableHead>Clave</TableHead>
                    <TableHead>Datos (clave A)</TableHead>
                    <TableHead className="text-right">Percepción íntegra</TableHead>
                    <TableHead className="text-right">Retenciones</TableHead>
                    <TableHead className="text-right">En especie</TableHead>
                    <TableHead className="text-right">Ingresos a cuenta</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {model.modelo190.recipients.map((row) => {
                    const subkeyLabel = row.key === "E" ? MODELO_190_E_SUBKEYS[row.subkey ?? ""] : row.key === "G" ? MODELO_190_G_SUBKEYS[row.subkey ?? ""] : undefined;
                    return (
                      <TableRow key={`${row.taxId ?? row.name}-${row.key}-${row.subkey ?? ""}`}>
                        <TableCell className="font-mono">{row.taxId ?? <span className="text-danger-text">Sin NIF</span>}</TableCell>
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell title={`${MODELO_190_KEYS[row.key] ?? ""}${subkeyLabel ? ` · ${subkeyLabel}` : ""}`}>
                          <span className="font-mono">{row.key}{row.subkey ? `/${row.subkey}` : ""}</span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {row.key === "A"
                            ? [
                                row.personal?.birthYear ? `Nac. ${row.personal.birthYear}` : "Sin año de nacimiento",
                                row.personal?.familySituation ? FAMILY_SITUATIONS[row.personal.familySituation] : "Sin situación familiar",
                                row.personal?.contractType ? `Contrato ${row.personal.contractType}` : "Sin tipo de contrato",
                              ].join(" · ")
                            : "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-mono">{money(row.cashCents)}</TableCell>
                        <TableCell className="whitespace-nowrap text-right font-mono">{money(row.withheldCents)}</TableCell>
                        <TableCell className="whitespace-nowrap text-right font-mono">{row.inKindCents ? money(row.inKindCents) : "—"}</TableCell>
                        <TableCell className="whitespace-nowrap text-right font-mono">{row.inKindWithheldCents ? money(row.inKindWithheldCents) : "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={4}>{model.modelo190.recordCount} registro(s) de percepción</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono" colSpan={2}>Percepciones {money(model.modelo190.totalIncomeCents)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono" colSpan={2}>Retenciones e ingresos a cuenta {money(model.modelo190.totalWithheldCents)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </TableContainer>
          </PageSection>
        </>
      ) : null}

      {model.modelo180 ? (
        <>
          <Reconciliation annual="180" currencyCode={currencyCode} reconciliation={model.modelo180.reconciliation} />
          <PageSection title="Arrendadores" description="Un registro por arrendador, con el inmueble dado de alta en Nóminas y retenciones › Inmuebles alquilados.">
            <TableContainer>
              <Table className="min-w-[60rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead>NIF</TableHead>
                    <TableHead>Arrendador</TableHead>
                    <TableHead>Inmueble</TableHead>
                    <TableHead className="text-right">Base</TableHead>
                    <TableHead className="text-right">% ret.</TableHead>
                    <TableHead className="text-right">Retenciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {model.modelo180.recipients.map((row) => (
                    <TableRow key={row.taxId ?? row.name}>
                      <TableCell className="font-mono">{row.taxId ?? <span className="text-danger-text">Sin NIF</span>}</TableCell>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell className="text-sm">
                        {row.property ? (
                          <>
                            <span className="font-mono">{row.property.cadastralReference ?? "Sin referencia catastral"}</span>
                            <span className="block text-xs text-muted-foreground">
                              Situación {row.property.situation} ({RENTAL_PROPERTY_SITUATIONS[row.property.situation] ?? "—"}){row.property.address ? ` · ${[row.property.address, row.property.postalCode, row.property.city].filter(Boolean).join(", ")}` : ""}
                              {row.propertyCount > 1 ? ` · y ${row.propertyCount - 1} inmueble(s) más` : ""}
                            </span>
                          </>
                        ) : <span className="text-warning-text">Falta el inmueble</span>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono">{money(row.baseCents)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono">{row.rate === null ? "—" : formatPercent(row.rate)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono">{money(row.withheldCents)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={3}>{model.modelo180.recordCount} arrendador(es)</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono">{money(model.modelo180.totalBaseCents)}</TableCell>
                    <TableCell />
                    <TableCell className="whitespace-nowrap text-right font-mono">{money(model.modelo180.totalWithheldCents)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </TableContainer>
          </PageSection>
        </>
      ) : null}

      {model.modelo193 ? (
        <>
          <Reconciliation annual="193" currencyCode={currencyCode} reconciliation={model.modelo193.reconciliation} />
          <PageSection title="Perceptores" description="Un registro por perceptor y clave de percepción. Pago «1»: la empresa paga como emisora.">
            <TableContainer>
              <Table className="min-w-[56rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead>NIF</TableHead>
                    <TableHead>Perceptor</TableHead>
                    <TableHead>Clave / naturaleza</TableHead>
                    <TableHead className="text-right">Importe íntegro</TableHead>
                    <TableHead className="text-right">% ret.</TableHead>
                    <TableHead className="text-right">Retenciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {model.modelo193.recipients.map((row) => (
                    <TableRow key={`${row.taxId ?? row.name}-${row.kind}`}>
                      <TableCell className="font-mono">{row.taxId ?? <span className="text-danger-text">Sin NIF</span>}</TableCell>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell><span className="font-mono">{row.key} / {row.nature}</span> <span className="text-xs text-muted-foreground">{MODELO_193_CODES[row.kind].label}</span></TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono">{money(row.incomeCents)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono">{row.rate === null ? "—" : formatPercent(row.rate)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono">{money(row.withheldCents)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={3}>{model.modelo193.recordCount} registro(s)</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono">{money(model.modelo193.totalBaseCents)}</TableCell>
                    <TableCell />
                    <TableCell className="whitespace-nowrap text-right font-mono">{money(model.modelo193.totalWithheldCents)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </TableContainer>
          </PageSection>
        </>
      ) : null}

      {items ? (
        <PageSection title="Detalle de partidas" description="De dónde sale cada importe y con qué fecha se ha imputado al periodo.">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay nóminas, facturas ni rendimientos con retención en este periodo.</p>
          ) : (
            <TableContainer>
              <Table className="min-w-[56rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Documento</TableHead>
                    <TableHead>Perceptor</TableHead>
                    <TableHead>Imputación</TableHead>
                    <TableHead className="text-right">Base</TableHead>
                    <TableHead className="text-right">Retención</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...items].sort((left, right) => left.date.localeCompare(right.date) || left.documentLabel.localeCompare(right.documentLabel)).map((item, index) => (
                    <TableRow key={`${item.sourceId}-${index}`}>
                      <TableCell className="whitespace-nowrap">{formatIso(item.date)}</TableCell>
                      <TableCell>{item.documentLabel}{item.inKind ? " (en especie)" : ""}</TableCell>
                      <TableCell>{item.recipientName}</TableCell>
                      <TableCell>
                        <StatusBadge tone={item.allocation === "registration-unpaid" ? "warning" : "neutral"}>{ALLOCATION_LABELS[item.allocation]}</StatusBadge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono">{money(item.baseCents)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono">{money(item.withheldCents)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </PageSection>
      ) : null}
    </>
  );
}
