import { desc, eq } from "drizzle-orm";

import { verifactuDeclaration } from "@/db/schema";
import { db, type DbClient } from "@/lib/db";
import { getVerifactuDeclaration } from "@/server/verifactu/config";

/*
 * Declaración responsable del productor del sistema informático de facturación (art. 13 del
 * RD 1007/2023 y art. 15 de la Orden HAC/1177/2024).
 *
 * El título y el texto que precede a cada dato son los literales del art. 15.1 de la Orden («cada
 * dato aportado deberá precederse del texto que lo describe, de acuerdo con lo redactado en la
 * letra con la cual se corresponde»), en su mismo orden: no los resumas ni los reordenes. De aquí
 * salen la pantalla, el PDF y el histórico: cada versión del sistema guarda la declaración que se
 * emitió para ella.
 */

export const DECLARATION_TITLE = "DECLARACIÓN RESPONSABLE DEL SISTEMA INFORMÁTICO DE FACTURACIÓN";

export type DeclarationData = ReturnType<typeof getVerifactuDeclaration>;

export type DeclarationRow = { label: string; value: string };

export type DeclarationDocument = {
  title: string;
  version: string;
  rows: DeclarationRow[];
  /** Faltan datos del productor: no es válida ni se guarda en el histórico. */
  complete: boolean;
  missing: string[];
};

/** Texto de un dato que el productor aún no ha aportado. */
export const DECLARATION_PENDING = "Pendiente de completar";

const longDate = (iso: string) => new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

/** Apartados a) … l) de la declaración con los datos del productor (función pura). */
export function buildDeclarationDocument(declaration: DeclarationData): DeclarationDocument {
  const date = declaration.date && /^\d{4}-\d{2}-\d{2}$/.test(declaration.date) ? longDate(declaration.date) : null;
  const rows: DeclarationRow[] = [
    { label: "a) Nombre del sistema informático a que se refiere la declaración responsable.", value: declaration.systemName },
    {
      label: "b) Código identificador del sistema informático a que se refiere el apartado 1.a), de acuerdo con las especificaciones dadas en el apartado 2.6 del anexo.",
      value: declaration.systemId,
    },
    { label: "c) Identificador completo de la versión concreta del sistema informático a que se refiere la declaración responsable.", value: declaration.version },
    {
      label: "d) Componentes, hardware y software, de que consta el sistema informático a que se refiere la declaración responsable, junto con una breve descripción de lo que hace dicho sistema informático y de sus principales funcionalidades.",
      value: "Aplicación web de gestión (ERP) que se usa desde el navegador, sin hardware propio: servidor de aplicación y base de datos PostgreSQL "
        + "alojados por el productor. Funciones: emisión de facturas completas, simplificadas y rectificativas, punto de venta, contabilidad e "
        + "impuestos. Cada factura emitida genera su registro de facturación con huella SHA-256 encadenada, lo conserva de forma inalterable, "
        + "lo remite a la Agencia Tributaria e incorpora el código QR a la factura.",
    },
    {
      label: "e) Indicación de si el sistema informático a que se refiere la declaración responsable se ha producido de tal manera que, a los efectos de cumplir con el Reglamento, solo pueda funcionar exclusivamente como «VERI*FACTU», de acuerdo con las especificaciones dadas en el apartado 2.6 del anexo.",
      value: declaration.onlyVerifactu ? "Sí. El sistema funciona exclusivamente en la modalidad VERI*FACTU (remisión de todos los registros a la AEAT)." : "No.",
    },
    {
      label: "f) Indicación de si el sistema informático a que se refiere la declaración responsable permite ser usado por varios obligados tributarios o por un mismo usuario para dar soporte a la facturación de varios obligados tributarios, de acuerdo con las especificaciones dadas en el apartado 2.6 del anexo.",
      value: declaration.multiTaxpayer ? "Sí. Cada empresa tiene su propia cadena de registros, separada de las demás." : "No.",
    },
    {
      label: "g) Tipos de firma utilizados para firmar los registros de facturación y de evento en el caso de que el sistema informático a que se refiere la declaración responsable no sea utilizado como «VERI*FACTU».",
      value: "Al funcionar exclusivamente como VERI*FACTU, los registros de facturación no se firman electrónicamente: su autenticidad se garantiza con la "
        + "remisión a la AEAT mediante certificado electrónico cualificado. No se genera registro de eventos firmado.",
    },
    {
      label: "h) Nombre y apellidos de la persona o razón social de la entidad productora del sistema informático a que se refiere la declaración responsable.",
      value: declaration.producerName || DECLARATION_PENDING,
    },
    {
      label: "i) Número de identificación fiscal (NIF) español de la persona o entidad productora del sistema informático a que se refiere la declaración responsable.",
      value: declaration.producerNif || DECLARATION_PENDING,
    },
    {
      label: "j) Dirección postal completa de contacto de la persona o entidad productora del sistema informático a que se refiere la declaración responsable.",
      value: declaration.producerAddress ?? DECLARATION_PENDING,
    },
    {
      label: "k) La persona o entidad productora del sistema informático a que se refiere la declaración responsable hace constar lo siguiente.",
      value: "Que dicho sistema informático, en la versión indicada en esta declaración, cumple con lo dispuesto en el artículo 29.2.j) de la "
        + "Ley 58/2003, de 17 de diciembre, General Tributaria, en el Reglamento que establece los requisitos que deben adoptar los sistemas y "
        + "programas informáticos o electrónicos que soporten los procesos de facturación de empresarios y profesionales, y la estandarización "
        + "de formatos de los registros de facturación, aprobado por el Real Decreto 1007/2023, de 5 de diciembre, en la Orden HAC/1177/2024, "
        + "de 17 de octubre, y en la sede electrónica de la Agencia Estatal de Administración Tributaria para todo aquello que complete las "
        + "especificaciones de dicha orden.",
    },
    {
      label: "l) Fecha y lugar en los que la persona o entidad productora del sistema informático suscribe la declaración responsable del mismo.",
      value: date && declaration.place ? `${date}, en ${declaration.place}` : DECLARATION_PENDING,
    },
  ];
  return { title: DECLARATION_TITLE, version: declaration.version, rows, complete: declaration.complete, missing: declaration.missing };
}

export type StoredDeclaration = { id: string; version: string; title: string; rows: DeclarationRow[]; createdAt: Date };

/**
 * Guarda la declaración de la versión actual la primera vez que se muestra (idempotente por
 * versión) y devuelve la guardada: una vez emitida, la de esa versión no cambia aunque cambien
 * después los datos de configuración. Una declaración incompleta no se guarda.
 */
export async function recordDeclaration(document: DeclarationDocument, client: DbClient = db): Promise<StoredDeclaration | null> {
  if (!document.complete) return null;
  await client
    .insert(verifactuDeclaration)
    .values({ version: document.version, title: document.title, rows: document.rows })
    .onConflictDoNothing({ target: verifactuDeclaration.version });
  const [stored] = await client.select().from(verifactuDeclaration).where(eq(verifactuDeclaration.version, document.version)).limit(1);
  return stored ?? null;
}

/** Histórico de declaraciones, de la más reciente a la más antigua. */
export async function listDeclarations(client: DbClient = db): Promise<StoredDeclaration[]> {
  return client.select().from(verifactuDeclaration).orderBy(desc(verifactuDeclaration.createdAt));
}

export async function getStoredDeclaration(id: string, client: DbClient = db): Promise<StoredDeclaration | null> {
  const [stored] = await client.select().from(verifactuDeclaration).where(eq(verifactuDeclaration.id, id)).limit(1);
  return stored ?? null;
}

/**
 * Declaración vigente (la de la versión desplegada), ya anotada en el histórico si está completa.
 * `issuedAt` es la fecha en que se emitió por primera vez para esta versión.
 */
export async function getCurrentDeclaration(env: Record<string, string | undefined> = process.env, client: DbClient = db) {
  const document = buildDeclarationDocument(getVerifactuDeclaration(env));
  const stored = await recordDeclaration(document, client);
  // La guardada manda: es la que se emitió para esta versión.
  return stored
    ? { ...document, title: stored.title, rows: stored.rows, id: stored.id, issuedAt: stored.createdAt }
    : { ...document, id: null, issuedAt: null };
}
