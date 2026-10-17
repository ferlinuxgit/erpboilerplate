"use client";

export type DepositPayment = { kind: "redirect"; url: string } | { kind: "form"; url: string; fields: Record<string, string> };

/** Lleva al cliente a pagar: a Stripe con un enlace, a Redsys con un formulario firmado. */
export function goToPayment(payment: DepositPayment) {
  if (payment.kind === "redirect") {
    window.location.assign(payment.url);
    return;
  }
  const form = document.createElement("form");
  form.method = "POST";
  form.action = payment.url;
  for (const [name, value] of Object.entries(payment.fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}
