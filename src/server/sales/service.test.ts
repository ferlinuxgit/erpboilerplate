import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import {
  assertDeliveryCanConvertToInvoice,
  assertOrderCanConvertToDelivery,
  assertQuoteCanConvert,
} from "@/server/sales/service";

describe("sales document service transitions", () => {
  it("allows valid sales pipeline transitions", () => {
    expect(() => assertQuoteCanConvert("SENT")).not.toThrow();
    expect(() => assertOrderCanConvertToDelivery("CONFIRMED")).not.toThrow();
    expect(() => assertDeliveryCanConvertToInvoice("DELIVERED")).not.toThrow();
  });

  it("explains why invalid sales transitions are blocked", () => {
    expect(() => assertQuoteCanConvert("VOID")).toThrow(/Presupuesto anulado/);
    expect(() => assertOrderCanConvertToDelivery("DRAFT")).toThrow(/Confirma el pedido/);
    expect(() => assertDeliveryCanConvertToInvoice("INVOICED")).toThrow(/ya fue facturado/);
  });
});
