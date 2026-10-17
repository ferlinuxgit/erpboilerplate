import { describe, expect, it } from "vitest";

import { customerBookingEmail, restaurantBookingEmail } from "./booking-emails";

const data = { restaurant: "Bar <Pepe>", address: "Calle Mayor 1", phone: "910 000 000", code: "ABC234", name: "Ana & Luis", partySize: 4, when: "sábado, 17 de octubre, 21:00", notes: "Trona", manageUrl: "https://erp.test/reservar/gestion/tok", welcomeMessage: "Mantenemos la mesa 15 min" };

describe("correos de reservas", () => {
  it("escapa los datos del cliente y del local", () => {
    const email = customerBookingEmail("CONFIRMED", data);
    expect(email.subject).toBe("Reserva confirmada en Bar <Pepe> · sábado, 17 de octubre, 21:00");
    expect(email.html).toContain("Bar &lt;Pepe&gt;");
    expect(email.html).toContain("Ana &amp; Luis");
    expect(email.html).not.toContain("<Pepe>");
    expect(email.html).toContain("https://erp.test/reservar/gestion/tok");
  });

  it("cambia el texto según el estado y quita el enlace al cancelar", () => {
    expect(customerBookingEmail("PENDING", data).html).toContain("revisará");
    expect(customerBookingEmail("REMINDER", data).subject).toMatch(/^Recordatorio/);
    expect(customerBookingEmail("CANCELLED", { ...data, manageUrl: null }).html).not.toContain("gestion/tok");
  });

  it("avisa al restaurante con mesa y contacto", () => {
    const email = restaurantBookingEmail("NEW", { ...data, tables: "Mesa 2 + Mesa 3", bookingsUrl: "https://erp.test/pos/bookings?date=2026-10-17", email: "ana@example.com", customerPhone: "600 000 000" });
    expect(email.subject).toContain("Nueva reserva: 4 pers.");
    expect(email.html).toContain("Mesa 2 + Mesa 3");
    expect(email.html).toContain("600 000 000 · ana@example.com");
  });
});
