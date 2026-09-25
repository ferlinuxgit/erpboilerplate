"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { AccessibleField, FormActions, FormErrorMessage, RequiredFieldsNote, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { QuantityInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatDecimalInput, parseDecimalInput } from "@/lib/format";
import { todayDateInput } from "@/server/invoices/due-dates";

type DeliveryOrder = {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  lines: Array<{ id: string; itemId: string | null; description: string; orderedQuantity: number; deliveredQuantity: number; pendingQuantity: number }>;
};

type FieldErrors = Partial<Record<"salesOrderId" | "warehouseId" | "issuedAt", string>>;

function formatQuantity(value: number) {
  return formatDecimalInput(value, { maximumFractionDigits: 3 }) || "0";
}

export function CreateDeliveryNoteForm({ orders, warehouses, initialOrderId }: { orders: DeliveryOrder[]; warehouses: Array<{ id: string; name: string }>; initialOrderId?: string }) {
  const router = useRouter();
  const [salesOrderId, setSalesOrderId] = useState(initialOrderId && orders.some((order) => order.id === initialOrderId) ? initialOrderId : orders[0]?.id ?? "");
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  const [issuedAt, setIssuedAt] = useState(() => todayDateInput());
  const selected = orders.find((order) => order.id === salesOrderId);
  const [quantities, setQuantities] = useState<Record<string, string>>(() => Object.fromEntries(orders.flatMap((order) => order.lines.map((line) => [line.id, String(line.pendingQuantity)]))));
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const selectedLines = useMemo(() => selected?.lines ?? [], [selected]);

  function validate() {
    const nextFieldErrors: FieldErrors = {};
    const nextLineErrors: Record<string, string> = {};
    if (!salesOrderId) nextFieldErrors.salesOrderId = "Selecciona el pedido que vas a entregar.";
    if (!warehouseId) nextFieldErrors.warehouseId = "Selecciona el almacén de salida.";
    if (!issuedAt) nextFieldErrors.issuedAt = "Indica la fecha de entrega.";

    const lines = selectedLines.flatMap((line) => {
      const raw = quantities[line.id] ?? "";
      const quantity = raw.trim() === "" ? 0 : parseDecimalInput(raw, { maximumFractionDigits: 3 });
      if (quantity === null) {
        nextLineErrors[line.id] = "Cantidad no válida.";
        return [];
      }
      if (quantity < 0) {
        nextLineErrors[line.id] = "No puede ser negativa.";
        return [];
      }
      if (quantity > line.pendingQuantity + 0.0005) {
        nextLineErrors[line.id] = `Máximo pendiente: ${formatQuantity(line.pendingQuantity)}.`;
        return [];
      }
      return quantity > 0 ? [{ salesOrderLineId: line.id, quantity }] : [];
    });

    setFieldErrors(nextFieldErrors);
    setLineErrors(nextLineErrors);
    if (Object.keys(nextFieldErrors).length > 0) return { lines, error: "Revisa los campos marcados antes de registrar la entrega." };
    if (Object.keys(nextLineErrors).length > 0) return { lines, error: "Revisa las cantidades a entregar: alguna no es válida o supera lo pendiente." };
    if (lines.length === 0) return { lines, error: "Indica al menos una cantidad a entregar." };
    return { lines, error: null };
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const { error, lines } = validate();
    if (error) {
      setFormError(error);
      toast.error(error);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/delivery-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ salesOrderId, warehouseId, customerId: selected?.customerId, issuedAt, lines }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo crear el albarán."));
      const payload = (await response.json().catch(() => null)) as { id?: string } | null;
      if (!payload?.id) throw new Error("El albarán se ha registrado, pero no se pudo abrir. Revisa el listado de albaranes.");
      toast.success("Albarán creado y stock actualizado.");
      router.push(`/sales/delivery-notes/${payload.id}`);
      router.refresh();
    } catch (submissionError) {
      const message = errorMessage(submissionError, "No se pudo crear el albarán. Inténtalo de nuevo.");
      setFormError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="space-y-4" noValidate onSubmit={submit}>
      <RequiredFieldsNote />
      <div className="grid gap-4 md:grid-cols-3">
        <AccessibleField error={fieldErrors.salesOrderId} id="delivery-order" label="Pedido confirmado" required>
          <Select autoFocus id="delivery-order" onChange={(event) => setSalesOrderId(event.target.value)} value={salesOrderId}>
            {orders.map((order) => <option key={order.id} value={order.id}>{order.number} · {order.customerName}</option>)}
          </Select>
        </AccessibleField>
        <AccessibleField error={fieldErrors.warehouseId} helperText="El stock se descuenta de este almacén." id="delivery-warehouse" label="Almacén de salida" required>
          <Select id="delivery-warehouse" onChange={(event) => setWarehouseId(event.target.value)} value={warehouseId}>
            {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
          </Select>
        </AccessibleField>
        <AccessibleField error={fieldErrors.issuedAt} id="delivery-date" label="Fecha de entrega" required>
          <Input id="delivery-date" onChange={(event) => setIssuedAt(event.target.value)} type="date" value={issuedAt} />
        </AccessibleField>
      </div>
      <section className="space-y-3" aria-labelledby="delivery-lines-title">
        <div>
          <h2 className="font-mono text-sm font-bold" id="delivery-lines-title">Cantidades a entregar</h2>
          <p className="mt-1 text-xs text-muted-foreground">Puedes completar una entrega parcial; el pedido conservará las cantidades pendientes.</p>
        </div>
        <div className="overflow-x-auto rounded-[2px] border border-window-dark-shadow bg-window-surface">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Concepto</TableHead>
                <TableHead className="text-right" scope="col">Pedido</TableHead>
                <TableHead className="text-right" scope="col">Entregado</TableHead>
                <TableHead className="text-right" scope="col">Pendiente</TableHead>
                <TableHead className="text-right" scope="col">Esta entrega</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {selectedLines.map((line) => {
                const lineError = lineErrors[line.id];
                const errorId = `delivery-line-${line.id}-error`;
                return (
                  <TableRow key={line.id}>
                    <TableCell className="font-bold">{line.description}</TableCell>
                    <TableCell className="text-right">{formatQuantity(line.orderedQuantity)}</TableCell>
                    <TableCell className="text-right">{formatQuantity(line.deliveredQuantity)}</TableCell>
                    <TableCell className="text-right">{formatQuantity(line.pendingQuantity)}</TableCell>
                    <TableCell className="align-top">
                      <QuantityInput
                        aria-describedby={lineError ? errorId : undefined}
                        aria-invalid={lineError ? true : undefined}
                        aria-label={`Cantidad a entregar de ${line.description}`}
                        className="font-mono"
                        onChange={(event) => setQuantities((current) => ({ ...current, [line.id]: event.target.value }))}
                        value={quantities[line.id] ?? "0"}
                        wrapperClassName="ml-auto w-28"
                      />
                      {lineError ? <p className="mt-1 text-right font-mono text-xs text-destructive" id={errorId} role="alert">{lineError}</p> : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>
      <FormErrorMessage>{formError}</FormErrorMessage>
      <FormActions>
        <SubmitButton disabled={!salesOrderId || !warehouseId} pending={loading} pendingLabel="Registrando…">
          Registrar entrega
        </SubmitButton>
      </FormActions>
    </form>
  );
}
