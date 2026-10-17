import { escapeEmailHtml, sendEmail } from "@/server/email/send";

/** Correos de reservas: al cliente (recibida, confirmada, cancelada, recordatorio) y al restaurante. */

export type BookingEmailData = {
  restaurant: string;
  address: string | null;
  phone: string | null;
  code: string;
  name: string;
  partySize: number;
  when: string;
  notes: string | null;
  manageUrl: string | null;
  welcomeMessage: string | null;
};

function details(data: BookingEmailData) {
  const rows = [
    ["Localizador", data.code],
    ["Cuándo", data.when],
    ["Personas", String(data.partySize)],
    ["A nombre de", data.name],
    ...(data.notes ? [["Comentarios", data.notes]] : []),
    ...(data.address ? [["Dirección", data.address]] : []),
    ...(data.phone ? [["Teléfono del local", data.phone]] : []),
  ];
  return `<table style="border-collapse:collapse">${rows.map(([label, value]) => `<tr><td style="padding:4px 12px 4px 0;color:#555">${escapeEmailHtml(label)}</td><td style="padding:4px 0"><strong>${escapeEmailHtml(value)}</strong></td></tr>`).join("")}</table>`;
}

function manageLink(data: BookingEmailData, label: string) {
  if (!data.manageUrl) return "";
  const url = escapeEmailHtml(data.manageUrl);
  return `<p><a href="${url}"><strong>${escapeEmailHtml(label)}</strong></a></p><p style="color:#555;font-size:12px">Si el enlace no funciona, cópialo en el navegador:<br>${url}</p>`;
}

export function customerBookingEmail(kind: "CONFIRMED" | "PENDING" | "CANCELLED" | "REMINDER", data: BookingEmailData) {
  const restaurant = escapeEmailHtml(data.restaurant);
  const hello = `<p>Hola ${escapeEmailHtml(data.name)},</p>`;
  const welcome = data.welcomeMessage ? `<p style="color:#555">${escapeEmailHtml(data.welcomeMessage).replace(/\n/g, "<br>")}</p>` : "";
  switch (kind) {
    case "CONFIRMED":
      return {
        subject: `Reserva confirmada en ${data.restaurant} · ${data.when}`,
        html: `${hello}<p>Tu reserva en <strong>${restaurant}</strong> está confirmada.</p>${details(data)}${welcome}${manageLink(data, "Ver, añadir al calendario o cancelar mi reserva")}`,
      };
    case "PENDING":
      return {
        subject: `Hemos recibido tu reserva en ${data.restaurant}`,
        html: `${hello}<p>Hemos recibido tu solicitud de reserva en <strong>${restaurant}</strong>. El restaurante la revisará y te escribiremos en cuanto la confirme.</p>${details(data)}${welcome}${manageLink(data, "Ver o cancelar mi solicitud")}`,
      };
    case "CANCELLED":
      return {
        subject: `Reserva cancelada en ${data.restaurant}`,
        html: `${hello}<p>Tu reserva en <strong>${restaurant}</strong> ha quedado cancelada.</p>${details(data)}<p>Si quieres volver a reservar, puedes hacerlo cuando quieras.</p>`,
      };
    case "REMINDER":
      return {
        subject: `Recordatorio: tu reserva en ${data.restaurant} · ${data.when}`,
        html: `${hello}<p>Te esperamos en <strong>${restaurant}</strong>.</p>${details(data)}${welcome}${manageLink(data, "¿No puedes venir? Cancela aquí")}`,
      };
  }
}

export function restaurantBookingEmail(kind: "NEW" | "CANCELLED", data: BookingEmailData & { tables: string; bookingsUrl: string; email: string | null; customerPhone: string | null }) {
  const contact = [data.customerPhone, data.email].filter(Boolean).join(" · ");
  const title = kind === "NEW" ? `Nueva reserva: ${data.partySize} pers. · ${data.when}` : `Reserva cancelada por el cliente: ${data.when}`;
  return {
    subject: `${title} · ${data.name}`,
    html: `<p>${escapeEmailHtml(title)}</p>${details({ ...data, address: null, phone: null })}<p>Mesa: <strong>${escapeEmailHtml(data.tables || "sin asignar")}</strong>${contact ? `<br>Contacto: ${escapeEmailHtml(contact)}` : ""}</p><p><a href="${escapeEmailHtml(data.bookingsUrl)}">Abrir las reservas del día</a></p>`,
  };
}

/** Enviar sin romper nunca la reserva si el correo falla. */
export async function sendBookingEmail(to: string | null | undefined, message: { subject: string; html: string }) {
  if (!to) return false;
  try {
    await sendEmail({ to, ...message });
    return true;
  } catch (error) {
    console.error("Booking email failed", error instanceof Error ? error.message : error);
    return false;
  }
}
