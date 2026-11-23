import { NextResponse } from "next/server";

import { requireContext } from "@/lib/current-context";
import { handleRouteError } from "@/lib/http";
import { deleteCompanyCertificate, MAX_CERTIFICATE_BYTES, saveCompanyCertificate } from "@/server/verifactu/certificates";

/** Sube (o sustituye) el certificado electrónico .p12/.pfx con el que la empresa remite a la AEAT. */
export async function PUT(request: Request) {
  try {
    const ctx = await requireContext("fiscal.write");
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    const passphrase = form?.get("passphrase");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ message: "Selecciona el fichero del certificado (.p12 o .pfx)." }, { status: 400 });
    }
    if (file.size > MAX_CERTIFICATE_BYTES) {
      return NextResponse.json({ message: "El fichero del certificado es demasiado grande." }, { status: 413 });
    }
    await saveCompanyCertificate(
      { tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: ctx.user.id },
      { pfx: Buffer.from(await file.arrayBuffer()), passphrase: typeof passphrase === "string" ? passphrase : "", fileName: file.name || null },
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "verifactu.certificate.put", "No se pudo guardar el certificado.");
  }
}

/** Quita el certificado propio (se usará el del sistema, si lo hay). */
export async function DELETE() {
  try {
    const ctx = await requireContext("fiscal.write");
    await deleteCompanyCertificate({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: ctx.user.id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "verifactu.certificate.delete", "No se pudo quitar el certificado.");
  }
}
