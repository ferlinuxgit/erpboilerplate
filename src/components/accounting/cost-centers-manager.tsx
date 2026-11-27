"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { DeleteButton } from "@/components/delete-button";
import { Button } from "@/components/ui/button";
import { AccessibleField, FormErrorMessage, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCsrfHeader } from "@/lib/csrf-client";

export type CostCenterRow = { id: string; code: string; name: string; isActive: boolean; lineCount: number; assetCount: number };

/** Alta, edición, activación y borrado de centros de coste. */
export function CostCentersManager({ canWrite, centers }: { canWrite: boolean; centers: CostCenterRow[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setEditingId(null);
    setCode("");
    setName("");
    setError(null);
  }

  async function save(target: { id?: string; code: string; name: string; isActive?: boolean }, successMessage: string) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(target.id ? `/api/cost-centers/${target.id}` : "/api/cost-centers", {
        method: target.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ code: target.code, name: target.name, isActive: target.isActive }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo guardar el centro de coste."));
      toast.success(successMessage);
      reset();
      router.refresh();
    } catch (caught) {
      const message = errorMessage(caught, "No se pudo guardar el centro de coste.");
      setError(message);
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      {canWrite ? (
        <form
          className="grid items-end gap-3 sm:grid-cols-[10rem_1fr_auto]"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!code.trim() || !name.trim()) return setError("Indica el código y el nombre del centro de coste.");
            void save({ id: editingId ?? undefined, code, name }, editingId ? "Centro de coste guardado." : "Centro de coste creado.");
          }}
        >
          <AccessibleField helperText="Corto: ADM, TALLER, OBRA-12…" id="cost-center-code" label="Código" required>
            <Input data-testid="cost-center-code" maxLength={20} onChange={(event) => setCode(event.target.value)} value={code} />
          </AccessibleField>
          <AccessibleField id="cost-center-name" label="Nombre" required>
            <Input data-testid="cost-center-name" maxLength={120} onChange={(event) => setName(event.target.value)} placeholder="Ej. Administración" value={name} />
          </AccessibleField>
          <div className="flex gap-2 pb-0.5">
            <SubmitButton pending={pending} pendingLabel="Guardando…">{editingId ? "Guardar cambios" : "Añadir centro"}</SubmitButton>
            {editingId ? <Button onClick={reset} type="button" variant="outline">Cancelar</Button> : null}
          </div>
          <div className="sm:col-span-3"><FormErrorMessage>{error}</FormErrorMessage></div>
        </form>
      ) : null}

      {centers.length === 0 ? (
        <EmptyState title="Sin centros de coste" description="Crea el primero para repartir gastos por departamento, obra o proyecto. De momento se asignan a los bienes de inmovilizado: sus amortizaciones los llevan." />
      ) : (
        <TableContainer>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead className="text-right">Apuntes</TableHead>
                <TableHead className="text-right">Bienes</TableHead>
                <TableHead>Estado</TableHead>
                {canWrite ? <TableHead className="text-right">Acciones</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {centers.map((center) => (
                <TableRow key={center.id}>
                  <TableCell className="font-mono font-semibold">{center.code}</TableCell>
                  <TableCell>{center.name}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{center.lineCount}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{center.assetCount}</TableCell>
                  <TableCell><StatusBadge tone={center.isActive ? "success" : "neutral"}>{center.isActive ? "Activo" : "Inactivo"}</StatusBadge></TableCell>
                  {canWrite ? (
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button
                          onClick={() => {
                            setEditingId(center.id);
                            setCode(center.code);
                            setName(center.name);
                            setError(null);
                          }}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          Editar
                        </Button>
                        <Button
                          disabled={pending}
                          onClick={() => void save({ id: center.id, code: center.code, name: center.name, isActive: !center.isActive }, center.isActive ? "Centro desactivado: ya no se ofrece al asignar." : "Centro activado.")}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          {center.isActive ? "Desactivar" : "Activar"}
                        </Button>
                        {center.lineCount === 0 && center.assetCount === 0 ? (
                          <DeleteButton
                            description="El centro de coste no tiene apuntes ni bienes asignados y se borrará definitivamente."
                            label="Borrar"
                            successMessage="Centro de coste borrado."
                            title={`Borrar el centro ${center.code}`}
                            url={`/api/cost-centers/${center.id}`}
                          />
                        ) : null}
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </div>
  );
}
