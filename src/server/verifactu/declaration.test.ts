import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Declaración responsable: versión ligada al despliegue, histórico por versión (PGlite en memoria)
 * y PDF.
 */

const state = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: null as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: null as any,
}));

vi.mock("@/lib/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const schema = await import("@/db/schema");
  state.client = new PGlite();
  state.db = drizzle(state.client, { schema });
  return { db: state.db };
});

import * as schema from "@/db/schema";
import { getDeploymentVersion, getVerifactuDeclaration, getVerifactuSystemInfo } from "@/server/verifactu/config";
import { buildDeclarationDocument, DECLARATION_PENDING, DECLARATION_TITLE, getCurrentDeclaration, listDeclarations } from "@/server/verifactu/declaration";
import { renderDeclarationPdf } from "@/server/verifactu/declaration-pdf";

const producer = {
  VERIFACTU_PRODUCER_NAME: "Norpie Software SL",
  VERIFACTU_PRODUCER_NIF: "B12345678",
  VERIFACTU_PRODUCER_ADDRESS: "Calle Mayor 1, 28001 Madrid",
  VERIFACTU_DECLARATION_DATE: "2026-11-27",
  VERIFACTU_DECLARATION_PLACE: "Madrid",
};

beforeAll(async () => {
  const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema as unknown as Record<string, unknown>));
  for (const statement of statements) await state.client.exec(statement);
}, 60_000);

afterAll(async () => {
  await state.client?.close();
});

describe("versión del sistema ligada al despliegue", () => {
  it("es la de package.json más el commit corto cuando el entorno lo expone", () => {
    expect(getDeploymentVersion({}, "1.4.0")).toBe("1.4.0");
    expect(getDeploymentVersion({ SOURCE_COMMIT: "5122131abcdef0123456789abcdef0123456789a" }, "1.4.0")).toBe("1.4.0+5122131");
    expect(getDeploymentVersion({ GIT_COMMIT: "ABCDEF1" }, "1.4.0")).toBe("1.4.0+abcdef1");
  });

  it("ignora un commit que no es un hash (p. ej. «HEAD») y respeta la versión fijada a mano", () => {
    expect(getDeploymentVersion({ SOURCE_COMMIT: "HEAD" }, "1.4.0")).toBe("1.4.0");
    expect(getDeploymentVersion({ SOURCE_COMMIT: "" }, "1.4.0")).toBe("1.4.0");
    expect(getDeploymentVersion({ VERIFACTU_SYSTEM_VERSION: "2.0-lts", SOURCE_COMMIT: "5122131abc" }, "1.4.0")).toBe("2.0-lts");
  });

  it("es la que viaja en el bloque SistemaInformatico y en la letra c) de la declaración", () => {
    const env = { ...producer, SOURCE_COMMIT: "5122131abc" };
    const version = getDeploymentVersion(env);
    expect(version).toMatch(/^\d+\.\d+\.\d+\+5122131$/);
    expect(getVerifactuSystemInfo("empresa", env).Version).toBe(version);
    expect(getVerifactuDeclaration(env).version).toBe(version);
  });
});

describe("texto de la declaración", () => {
  it("lleva los doce apartados del art. 15.1, en orden, con los datos del productor", () => {
    const document = buildDeclarationDocument(getVerifactuDeclaration({ ...producer, VERIFACTU_SYSTEM_VERSION: "1.0.0" }));
    expect(document.title).toBe(DECLARATION_TITLE);
    expect(document.rows.map((row) => row.label.slice(0, 2))).toEqual(["a)", "b)", "c)", "d)", "e)", "f)", "g)", "h)", "i)", "j)", "k)", "l)"]);
    expect(document.rows[2].value).toBe("1.0.0");
    expect(document.rows[7].value).toBe("Norpie Software SL");
    expect(document.rows[8].value).toBe("B12345678");
    expect(document.rows[11].value).toBe("27 de noviembre de 2026, en Madrid");
    expect(document.complete).toBe(true);
  });

  it("marca lo que falta y no se da por completa", () => {
    const document = buildDeclarationDocument(getVerifactuDeclaration({ VERIFACTU_SYSTEM_VERSION: "1.0.0" }));
    expect(document.complete).toBe(false);
    expect(document.rows[9].value).toBe(DECLARATION_PENDING);
    expect(document.rows[11].value).toBe(DECLARATION_PENDING);
  });
});

describe("histórico de declaraciones por versión", () => {
  it("una declaración incompleta no se guarda", async () => {
    const current = await getCurrentDeclaration({ VERIFACTU_SYSTEM_VERSION: "0.9.0" });
    expect(current).toMatchObject({ complete: false, id: null, issuedAt: null });
    expect(await listDeclarations()).toEqual([]);
  });

  it("guarda cada versión la primera vez que se muestra y no la duplica", async () => {
    const first = await getCurrentDeclaration({ ...producer, VERIFACTU_SYSTEM_VERSION: "1.0.0" });
    expect(first.id).toBeTruthy();
    expect(first.issuedAt).toBeInstanceOf(Date);
    const again = await getCurrentDeclaration({ ...producer, VERIFACTU_SYSTEM_VERSION: "1.0.0" });
    expect(again.id).toBe(first.id);
    expect(await listDeclarations()).toHaveLength(1);
  });

  it("lo emitido para una versión no cambia aunque cambie después la configuración", async () => {
    const changed = await getCurrentDeclaration({ ...producer, VERIFACTU_PRODUCER_ADDRESS: "Otra dirección 9, 08001 Barcelona", VERIFACTU_SYSTEM_VERSION: "1.0.0" });
    expect(changed.rows[9].value).toBe("Calle Mayor 1, 28001 Madrid");
  });

  it("una versión nueva se añade al histórico con su propio texto", async () => {
    const next = await getCurrentDeclaration({ ...producer, VERIFACTU_PRODUCER_ADDRESS: "Otra dirección 9, 08001 Barcelona", VERIFACTU_SYSTEM_VERSION: "1.1.0" });
    expect(next.rows[2].value).toBe("1.1.0");
    expect(next.rows[9].value).toBe("Otra dirección 9, 08001 Barcelona");
    const history = await listDeclarations();
    expect(history.map((entry) => entry.version).sort()).toEqual(["1.0.0", "1.1.0"]);
  });
});

describe("PDF de la declaración", () => {
  it("genera un PDF con los apartados de la declaración", async () => {
    const document = buildDeclarationDocument(getVerifactuDeclaration({ ...producer, VERIFACTU_SYSTEM_VERSION: "1.0.0" }));
    const pdf = await renderDeclarationPdf({ title: document.title, version: document.version, rows: document.rows, issuedAt: new Date("2026-11-27T10:00:00Z") });
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(2_000);
  }, 30_000);
});
