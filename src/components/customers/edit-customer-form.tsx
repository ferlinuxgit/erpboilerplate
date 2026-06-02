"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getCsrfHeader } from "@/lib/csrf-client";

export function EditCustomerForm({
  defaultEmail,
  defaultName,
  defaultPhone,
  defaultStatus,
  id,
}: {
  id: string;
  defaultName: string;
  defaultEmail: string | null;
  defaultPhone: string | null;
  defaultStatus: "ACTIVE" | "INACTIVE";
}) {
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [phone, setPhone] = useState(defaultPhone ?? "");
  const [status, setStatus] = useState(defaultStatus);

  return (
    <form
      className="grid gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        await fetch(`/api/customers/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...getCsrfHeader() },
          body: JSON.stringify({ name, email, phone, status }),
        });
        router.push("/customers");
        router.refresh();
      }}
    >
      <Input value={name} onChange={(event) => setName(event.target.value)} required />
      <Input value={email} onChange={(event) => setEmail(event.target.value)} />
      <Input value={phone} onChange={(event) => setPhone(event.target.value)} />
      <select className="h-8 rounded-md border px-2 text-sm" value={status} onChange={(event) => setStatus(event.target.value as "ACTIVE" | "INACTIVE")}>
        <option value="ACTIVE">ACTIVE</option>
        <option value="INACTIVE">INACTIVE</option>
      </select>
      <Button type="submit">Guardar cambios</Button>
    </form>
  );
}
