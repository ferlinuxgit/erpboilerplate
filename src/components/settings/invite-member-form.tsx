"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { getCsrfHeader } from "@/lib/csrf-client";

export function InviteMemberForm({ canInviteOwner }: { canInviteOwner: boolean }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"OWNER" | "ADMIN" | "MEMBER">("MEMBER");
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)} type="button">Invitar miembro</Button>
      <Dialog description="La invitación caduca en siete días y solo puede aceptarla el email indicado." initialFocusId="invite-member-email" onClose={() => setOpen(false)} open={open} title="Invitar al equipo">
    <form className="grid gap-4" onSubmit={async (event) => {
      event.preventDefault();
      setPending(true);
      try {
        const response = await fetch("/api/invitations", { method: "POST", headers: { "Content-Type": "application/json", ...getCsrfHeader() }, body: JSON.stringify({ email, role }) });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.message ?? "No se pudo enviar la invitación.");
        setEmail("");
        setOpen(false);
        toast.success("Invitación enviada.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudo enviar la invitación.");
      } finally {
        setPending(false);
      }
    }}>
      <div className="space-y-2">
        <Label htmlFor="invite-member-email">Email</Label>
        <Input id="invite-member-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="invite-member-role">Rol</Label>
        <Select id="invite-member-role" value={role} onChange={(event) => setRole(event.target.value as typeof role)}>
          <option value="MEMBER">Miembro</option>
          <option value="ADMIN">Administrador</option>
          {canInviteOwner ? <option value="OWNER">Propietario</option> : null}
        </Select>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button onClick={() => setOpen(false)} type="button" variant="outline">Cancelar</Button><Button disabled={pending} type="submit">{pending ? "Enviando…" : "Enviar invitación"}</Button></div>
    </form>
      </Dialog>
    </>
  );
}
