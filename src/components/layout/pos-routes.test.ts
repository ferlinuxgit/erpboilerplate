import { describe, expect, it } from "vitest";

import { isPosKioskRoute } from "./pos-routes";

describe("POS kiosk routes", () => {
  it("shows the register screens without the ERP menu, and the rest of the POS inside it", () => {
    expect(isPosKioskRoute("/pos/reg-1")).toBe(true);
    expect(isPosKioskRoute("/pos/reg-1/close")).toBe(true);
    expect(isPosKioskRoute("/pos/reg-1/orders/ord-1")).toBe(true);
    expect(isPosKioskRoute("/pos/kitchen")).toBe(true);
    for (const path of ["/pos", "/pos/sessions", "/pos/sessions/abc", "/pos/settings", "/pos/tickets/inv-1", "/pos/menu", "/pos/menu/qr", "/posx/a", "/pos/reg-1/other"]) {
      expect(isPosKioskRoute(path), path).toBe(false);
    }
  });
});
