"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { CopyLinkButton } from "@/components/settings/copy-link-button";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { AccessibleField, FormErrorMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { getCsrfHeader } from "@/lib/csrf-client";
import { roleDescriptions, type AppRole } from "@/lib/rbac";
import { roleLabels } from "@/lib/status-labels";

type InvitationResult = { email: string; url: string; emailSent: boolean; emailProblem: string | null };

/** Orden pensado para una pyme: primero los roles más habituales al invitar. */
const roleOrder: AppRole[] = ["ACCOUNTANT", "MEMBER", "VIEWER", "ADMIN", "OWNER"];

export function InviteMemberForm({ assignableRoles }: { assignableRoles: AppRole[] }) {
  const router = useRouter();
  const roles = roleOrder.filter((role) => assignableRoles.includes(role));
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AppRole>(roles[0] ?? "MEMBER");
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InvitationResult | null>(null);

  function close() {
    setOpen(false);
    setResult(null);
    setError(null);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/invitations", { method: "POST", headers: { "Content-Type": "application/json", ...getCsrfHeader() }, body: JSON.stringify({ email, role }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message ?? "No se pudo crear la invitación.");
      const created = payload as InvitationResult;
      setEmail("");
      setResult(created);
      toast.success(created.emailSent ? `Invitación enviada a ${created.email}.` : "Invitación creada. Copia el enlace y compártelo.");
      router.refresh();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "No se pudo crear la invitación.";
      setError(message);
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} type="button">Invitar a alguien</Button>
      <Dialog
        description="Solo podrá aceptarla quien entre con ese email. La invitación caduca en siete días y puedes reenviarla o cancelarla desde esta página."
        initialFocusId="invite-member-email"
        onClose={close}
        open={open}
        title="Invitar al equipo"
      >
        {result ? (
          <div className="grid gap-3" role="status">
            <p className="text-sm">
              {result.emailSent ? <>Hemos enviado la invitación a <strong>{result.email}</strong>.</> : <>Invitación creada para <strong>{result.email}</strong>. {result.emailProblem}</>}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="max-w-full truncate border border-window-shadow bg-window-panel px-1.5 py-0.5 font-mono text-[0.7rem]">{result.url}</code>
              <CopyLinkButton url={result.url} />
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button onClick={() => setResult(null)} type="button" variant="outline">Invitar a otra persona</Button>
              <Button onClick={close} type="button">Hecho</Button>
            </div>
          </div>
        ) : (
          <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
            <FormErrorMessage>{error}</FormErrorMessage>
            <AccessibleField id="invite-member-email" label="Email" required>
              <Input autoComplete="email" inputMode="email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
            </AccessibleField>
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium">Rol</legend>
              <div className="grid gap-1">
                {roles.map((option) => (
                  <label
                    className={`flex cursor-pointer items-start gap-2 border p-2 text-xs has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus ${role === option ? "border-primary bg-primary/10" : "border-window-dark-shadow bg-card hover:bg-window-highlight"}`}
                    key={option}
                  >
                    <input checked={role === option} className="mt-0.5" name="invite-member-role" onChange={() => setRole(option)} type="radio" value={option} />
                    <span>
                      <span className="block font-mono font-bold">{roleLabels[option]}</span>
                      <span className="block text-muted-foreground">{roleDescriptions[option]}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button onClick={close} type="button" variant="outline">Cancelar</Button>
              <Button disabled={pending} type="submit">{pending ? "Creando…" : "Crear invitación"}</Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
