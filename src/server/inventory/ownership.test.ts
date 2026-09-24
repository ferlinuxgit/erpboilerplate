import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { assertItemsBelongToCompany, ItemOwnershipError, rejectForeignItems } from "@/server/inventory/ownership";

function clientReturning(ownedIds: string[]) {
  const where = vi.fn(async () => ownedIds.map((id) => ({ id })));
  const client = { select: vi.fn(() => ({ from: vi.fn(() => ({ where })) })) };
  return { client: client as unknown as Parameters<typeof assertItemsBelongToCompany>[0], select: client.select };
}

describe("assertItemsBelongToCompany", () => {
  it("skips the query when no line references an item", async () => {
    const { client, select } = clientReturning([]);
    await expect(assertItemsBelongToCompany(client, "company-1", [null, undefined, "", "  "])).resolves.toBeUndefined();
    expect(select).not.toHaveBeenCalled();
  });

  it("accepts items owned by the company (deduplicated)", async () => {
    const { client, select } = clientReturning(["item-1", "item-2"]);
    await expect(assertItemsBelongToCompany(client, "company-1", ["item-1", "item-2", "item-1", null])).resolves.toBeUndefined();
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("throws a typed 422 error when an item belongs to another company", async () => {
    const { client } = clientReturning(["item-1"]);
    const error = await assertItemsBelongToCompany(client, "company-1", ["item-1", "foreign-item"]).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ItemOwnershipError);
    expect(error).toMatchObject({ status: 422, message: "Artículo no válido.", invalidItemIds: ["foreign-item"] });
  });

  it("maps the error to a 422 JSON response for route handlers", async () => {
    const { client } = clientReturning([]);
    const response = await rejectForeignItems(client, "company-1", [{ itemId: "foreign-item" }]);
    expect(response?.status).toBe(422);
    await expect(response?.json()).resolves.toEqual({ message: "Artículo no válido." });
    await expect(rejectForeignItems(client, "company-1", [{ itemId: null }])).resolves.toBeNull();
  });
});
