"use client";

import { ArrowsClockwise, Copy, Key, PencilSimple, Prohibit, UserPlus, ArrowCounterClockwise } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { DeleteButton } from "@/components/delete-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ADVISOR_PASSWORD_MIN_LENGTH, advisorScopeLabel, advisorScopeOptions, DEFAULT_ADVISOR_SCOPES, type AdvisorScope } from "@/lib/advisor-scopes";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatDate, formatDateTime } from "@/lib/format";

export type AdvisorAccessView = {
  id: string;
  name: string;
  firm: string | null;
  email: string;
  scopes: AdvisorScope[];
  status: "ACTIVE" | "REVOKED" | "EXPIRED";
  expiresAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
};

type Credentials = { name: string; email: string; password: string; action: "created" | "reset" };

type FormState = { name: string; firm: string; email: string; password: string; expiresAt: string; scopes: AdvisorScope[] };

const emptyForm: FormState = { name: "", firm: "", email: "", password: "", expiresAt: "", scopes: [...DEFAULT_ADVISOR_SCOPES] };

const statusTone = { ACTIVE: "success", REVOKED: "danger", EXPIRED: "warning" } as const;
const statusLabel = { ACTIVE: "Activo", REVOKED: "Revocado", EXPIRED: "Caducado" } as const;

async function send(url: string, method: "POST" | "PATCH", body: unknown, failure: string) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json", ...getCsrfHeader() }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(await readApiError(response, failure));
  return (await response.json()) as { password?: string | null; email?: string; name?: string };
}

export function credentialsText(credentials: Pick<Credentials, "email" | "password">, portalUrl: string, companyName: string) {
  return [
    `Acceso al portal del asesor de ${companyName}`,
    "",
    `Dirección: ${portalUrl}`,
    `Email: ${credentials.email}`,
    `Contraseña: ${credentials.password}`,
    "",
    "Desde el portal puedes descargar facturas emitidas y recibidas, libros contables y de IVA, modelos y otros listados de cada periodo.",
  ].join("\n");
}

/** Gestión de los accesos del asesor (crear, editar secciones, nueva contraseña, revocar, eliminar). */
export function AdvisorAccessManager({ rows, canManage, portalUrl, companyName }: { rows: AdvisorAccessView[]; canManage: boolean; portalUrl: string; companyName: string }) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState<null | { mode: "create" } | { mode: "edit"; id: string }>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [pending, setPending] = useState<null | { row: AdvisorAccessView; action: "revoke" | "reactivate" | "reset-password" }>(null);

  function openCreate() {
    setForm(emptyForm);
    setFormOpen({ mode: "create" });
  }

  function openEdit(row: AdvisorAccessView) {
    setForm({ name: row.name, firm: row.firm ?? "", email: row.email, password: "", expiresAt: row.expiresAt ? row.expiresAt.slice(0, 10) : "", scopes: row.scopes });
    setFormOpen({ mode: "edit", id: row.id });
  }

  async function submitForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formOpen) return;
    setBusy(true);
    try {
      const common = { name: form.name, firm: form.firm || null, scopes: form.scopes, expiresAt: form.expiresAt || null };
      if (formOpen.mode === "create") {
        const created = await send("/api/advisor-access", "POST", { ...common, email: form.email, password: form.password || null }, "No se pudo crear el acceso.");
        setCredentials({ name: form.name, email: created.email ?? form.email, password: created.password ?? "", action: "created" });
        toast.success("Acceso creado. Copia la contraseña ahora: no se volverá a mostrar.");
      } else {
        await send(`/api/advisor-access/${formOpen.id}`, "PATCH", { action: "update", ...common }, "No se pudo guardar el acceso.");
        toast.success("Acceso actualizado.");
      }
      setFormOpen(null);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar el acceso.");
    } finally {
      setBusy(false);
    }
  }

  async function runAction() {
    if (!pending) return;
    setBusy(true);
    try {
      const result = await send(`/api/advisor-access/${pending.row.id}`, "PATCH", { action: pending.action }, "No se pudo actualizar el acceso.");
      if (pending.action === "reset-password" && result.password) {
        setCredentials({ name: pending.row.name, email: pending.row.email, password: result.password, action: "reset" });
        toast.success("Contraseña nueva generada. Se ha cerrado la sesión del asesor.");
      } else {
        toast.success(pending.action === "revoke" ? "Acceso revocado: el asesor ya no puede entrar." : "Acceso reactivado.");
      }
      setPending(null);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo actualizar el acceso.");
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string, message: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(message);
    } catch {
      toast.error("No se pudo copiar. Selecciona el texto y cópialo a mano.");
    }
  }

  return (
    <div className="space-y-3">
      {canManage ? (
        <div className="flex justify-end">
          <Button data-testid="advisor-access-create" onClick={openCreate} type="button">
            <UserPlus aria-hidden="true" />
            Dar acceso a mi asesor
          </Button>
        </div>
      ) : (
        <p className="rounded-control border border-dashed p-2 text-sm text-muted-foreground">Solo el propietario o un administrador puede crear o cambiar accesos.</p>
      )}

      {rows.length === 0 ? (
        <EmptyState description="Crea un acceso con email y contraseña para que tu gestoría descargue la documentación sin pedírtela cada trimestre." title="Tu asesor todavía no tiene acceso" />
      ) : (
        <TableContainer>
          <Table data-testid="advisor-access-list">
            <TableHeader>
              <TableRow>
                <TableHead>Asesor</TableHead>
                <TableHead>Email de acceso</TableHead>
                <TableHead>Secciones</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Último acceso</TableHead>
                <TableHead>Caduca</TableHead>
                {canManage ? <TableHead className="text-right">Acciones</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <span className="font-bold">{row.name}</span>
                    {row.firm ? <span className="block text-xs text-muted-foreground">{row.firm}</span> : null}
                  </TableCell>
                  <TableCell className="font-mono">{row.email}</TableCell>
                  <TableCell className="max-w-64 whitespace-normal">{row.scopes.map(advisorScopeLabel).join(", ")}</TableCell>
                  <TableCell><StatusBadge tone={statusTone[row.status]}>{statusLabel[row.status]}</StatusBadge></TableCell>
                  <TableCell>{row.lastLoginAt ? formatDateTime(row.lastLoginAt) : "Nunca"}</TableCell>
                  <TableCell>{row.expiresAt ? formatDate(row.expiresAt) : "No caduca"}</TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button onClick={() => openEdit(row)} size="xs" type="button" variant="outline"><PencilSimple aria-hidden="true" />Editar</Button>
                        <Button onClick={() => setPending({ row, action: "reset-password" })} size="xs" type="button" variant="outline"><Key aria-hidden="true" />Nueva contraseña</Button>
                        {row.status === "REVOKED" ? (
                          <Button onClick={() => setPending({ row, action: "reactivate" })} size="xs" type="button" variant="outline"><ArrowCounterClockwise aria-hidden="true" />Reactivar</Button>
                        ) : (
                          <Button onClick={() => setPending({ row, action: "revoke" })} size="xs" type="button" variant="destructive"><Prohibit aria-hidden="true" />Revocar</Button>
                        )}
                        <DeleteButton description={`Se elimina el acceso de ${row.name}. Su historial de descargas se conserva en la auditoría.`} successMessage="Acceso eliminado." title="Eliminar acceso del asesor" url={`/api/advisor-access/${row.id}`} />
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog
        description={formOpen?.mode === "create" ? "El asesor entrará con este email y la contraseña. Solo podrá consultar y descargar, nunca modificar." : "Los cambios de secciones se aplican en su próxima página."}
        initialFocusId="advisor-name"
        onClose={() => setFormOpen(null)}
        open={Boolean(formOpen)}
        size="lg"
        title={formOpen?.mode === "create" ? "Dar acceso a mi asesor" : "Editar acceso del asesor"}
      >
        <form className="space-y-3" onSubmit={(event) => void submitForm(event)}>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="advisor-name">Nombre del asesor</Label>
              <Input id="advisor-name" maxLength={120} onChange={(event) => setForm({ ...form, name: event.target.value })} required value={form.name} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="advisor-firm">Gestoría o despacho (opcional)</Label>
              <Input id="advisor-firm" maxLength={120} onChange={(event) => setForm({ ...form, firm: event.target.value })} value={form.firm} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="advisor-email">Email de acceso</Label>
              <Input disabled={formOpen?.mode === "edit"} id="advisor-email" onChange={(event) => setForm({ ...form, email: event.target.value })} required type="email" value={form.email} />
              {formOpen?.mode === "edit" ? <p className="text-xs text-muted-foreground">Para cambiar el email, elimina este acceso y crea otro.</p> : null}
            </div>
            <div className="space-y-1">
              <Label htmlFor="advisor-expires">Caduca el (opcional)</Label>
              <Input id="advisor-expires" onChange={(event) => setForm({ ...form, expiresAt: event.target.value })} type="date" value={form.expiresAt} />
            </div>
            {formOpen?.mode === "create" ? (
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="advisor-password">Contraseña</Label>
                <Input autoComplete="new-password" id="advisor-password" minLength={ADVISOR_PASSWORD_MIN_LENGTH} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="Déjala vacía y generaremos una segura" type="text" value={form.password} />
                <p className="text-xs text-muted-foreground">Mínimo {ADVISOR_PASSWORD_MIN_LENGTH} caracteres. Se mostrará una sola vez al crear el acceso.</p>
              </div>
            ) : null}
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Qué puede ver y descargar</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {advisorScopeOptions.map((option) => (
                <label className="flex items-start gap-2 rounded-control border p-2 text-sm hover:bg-muted/40" key={option.key}>
                  <input
                    checked={form.scopes.includes(option.key)}
                    className="mt-0.5 size-4 accent-primary"
                    onChange={(event) => setForm({ ...form, scopes: event.target.checked ? [...new Set([...form.scopes, option.key])] : form.scopes.filter((scope) => scope !== option.key) })}
                    type="checkbox"
                  />
                  <span><span className="block font-medium">{option.label}</span><span className="text-xs text-muted-foreground">{option.description}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          <DialogFooter>
            <Button onClick={() => setFormOpen(null)} type="button" variant="outline">Cancelar</Button>
            <Button disabled={busy || form.scopes.length === 0} type="submit">{busy ? "Guardando…" : formOpen?.mode === "create" ? "Crear acceso" : "Guardar"}</Button>
          </DialogFooter>
        </form>
      </Dialog>

      <Dialog
        description={pending?.action === "revoke" ? "El asesor deja de poder entrar al momento y se cierra su sesión." : pending?.action === "reset-password" ? "Se genera una contraseña nueva y se cierra la sesión actual del asesor. Tendrás que enviársela." : "El asesor podrá volver a entrar con su contraseña actual."}
        onClose={() => setPending(null)}
        open={Boolean(pending)}
        title={pending?.action === "revoke" ? "Revocar acceso" : pending?.action === "reset-password" ? "Generar contraseña nueva" : "Reactivar acceso"}
      >
        {pending ? (
          <>
            <p className="text-sm">Acceso de <strong>{pending.row.name}</strong> ({pending.row.email}).</p>
            <DialogFooter>
              <Button onClick={() => setPending(null)} type="button" variant="outline">Cancelar</Button>
              <Button disabled={busy} onClick={() => void runAction()} type="button" variant={pending.action === "revoke" ? "destructive" : "default"}>
                {pending.action === "reset-password" ? <ArrowsClockwise aria-hidden="true" /> : null}
                {busy ? "Procesando…" : pending.action === "revoke" ? "Revocar" : pending.action === "reset-password" ? "Generar contraseña" : "Reactivar"}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </Dialog>

      <Dialog description="Cópialos ahora y envíaselos a tu asesor. Por seguridad, la contraseña no se volverá a mostrar." onClose={() => setCredentials(null)} open={Boolean(credentials)} title={credentials?.action === "reset" ? "Contraseña nueva del asesor" : "Acceso del asesor creado"}>
        {credentials ? (
          <div className="space-y-3">
            <dl className="grid gap-1 rounded-control border bg-muted/40 p-2 font-mono text-sm" data-testid="advisor-credentials">
              <div><dt className="text-xs text-muted-foreground">Dirección</dt><dd className="break-all">{portalUrl}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Email</dt><dd className="break-all">{credentials.email}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Contraseña</dt><dd className="break-all text-base font-bold" data-testid="advisor-credentials-password">{credentials.password}</dd></div>
            </dl>
            <p className="text-xs text-muted-foreground">Consejo: envía la contraseña por un canal distinto al del email (por ejemplo, por teléfono o mensajería).</p>
            <DialogFooter>
              <Button onClick={() => void copy(credentials.password, "Contraseña copiada.")} type="button" variant="outline"><Copy aria-hidden="true" />Copiar contraseña</Button>
              <Button onClick={() => void copy(credentialsText(credentials, portalUrl, companyName), "Instrucciones copiadas.")} type="button"><Copy aria-hidden="true" />Copiar instrucciones</Button>
            </DialogFooter>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
