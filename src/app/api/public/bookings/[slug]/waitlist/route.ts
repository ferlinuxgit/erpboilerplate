import { after, NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { joinWaitlist } from "@/server/pos/waitlist";

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida."),
  partySize: z.number().int().min(1).max(100),
  preferredTime: z.union([z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora no válida."), z.literal("")]).nullable().optional().transform((value) => value || null),
  name: z.string().trim().min(2, "Escribe tu nombre.").max(80),
  phone: z.string().trim().min(6, "Escribe un teléfono de contacto.").max(30),
  email: z.string().trim().max(200).email("Email no válido."),
  notes: z.string().trim().max(300).nullable().optional().transform((value) => value || null),
  consent: z.literal(true, { error: "Debes aceptar el tratamiento de tus datos." }),
  website: z.string().max(0, "No se pudo enviar.").optional(),
});

/** Apuntarse a la lista de espera de un día completo (sin sesión). */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Datos inválidos.");
    const { notify, token } = await joinWaitlist((await params).slug, parsed.data);
    after(notify);
    return NextResponse.json({ token }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "public.waitlist.join");
  }
}
