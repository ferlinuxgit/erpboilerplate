import { and, eq } from "drizzle-orm";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

import { expenseMailInbox, expenseOcrJob } from "@/db/schema";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { openSecret, sealSecret } from "@/lib/secret-box";
import { recordAudit } from "@/server/audit";
import { isModuleEnabled } from "@/server/modules/service";
import { createExpenseOcrJob, sanitizeFileName } from "@/server/ocr/expense-ocr";
import { isAllowedSender, mailInboxErrorMessage, parseAllowedSenders, selectInvoiceAttachments } from "@/server/ocr/mail-inbox-model";

/**
 * Buzón de facturas por correo: la empresa configura una cuenta IMAP (p. ej. facturas@miempresa.es)
 * a la que reenvía las facturas recibidas. El worker la revisa cada pocos minutos y cada PDF o imagen
 * adjunto de un remitente permitido entra en la bandeja de gastos y se lee con OpenAI.
 *
 * Solo se procesan los correos que lleguen después de activarlo (se guarda el último UID leído).
 * Los procesados se marcan como leídos y, si se indica, se mueven a otra carpeta.
 */

const SECRET_PURPOSE = "expense-mail-inbox";
const MAX_MESSAGES_PER_CHECK = 25;
const MAX_MESSAGE_BYTES = 40 * 1024 * 1024;

function encryptionSecret() {
  const secret = process.env.MAIL_INBOX_ENCRYPTION_KEY?.trim() || process.env.JWT_SECRET?.trim();
  if (!secret) throw new Error("Falta JWT_SECRET (o MAIL_INBOX_ENCRYPTION_KEY) para cifrar la contraseña del buzón.");
  return secret;
}

type InboxRow = typeof expenseMailInbox.$inferSelect;

export type MailInboxConnection = { host: string; port: number; secure: boolean; username: string; password: string; mailbox: string };

export type MailInboxSettingsView = {
  configured: boolean;
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  hasPassword: boolean;
  mailbox: string;
  processedMailbox: string;
  allowedSenders: string;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastImportedCount: number;
};

function toView(row: InboxRow | undefined): MailInboxSettingsView {
  return {
    configured: Boolean(row),
    enabled: row?.enabled ?? false,
    host: row?.host ?? "",
    port: row?.port ?? 993,
    secure: row?.secure ?? true,
    username: row?.username ?? "",
    hasPassword: Boolean(row?.passwordEncrypted),
    mailbox: row?.mailbox ?? "INBOX",
    processedMailbox: row?.processedMailbox ?? "",
    allowedSenders: row?.allowedSenders ?? "",
    lastCheckedAt: row?.lastCheckedAt?.toISOString() ?? null,
    lastSuccessAt: row?.lastSuccessAt?.toISOString() ?? null,
    lastError: row?.lastError ?? null,
    lastImportedCount: row?.lastImportedCount ?? 0,
  };
}

async function loadRow(companyId: string) {
  const [row] = await db.select().from(expenseMailInbox).where(eq(expenseMailInbox.companyId, companyId)).limit(1);
  return row;
}

export async function getMailInboxSettings(companyId: string) {
  return toView(await loadRow(companyId));
}

export type MailInboxSettingsInput = {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  /** Vacía = conservar la guardada. */
  password?: string;
  mailbox: string;
  processedMailbox?: string;
  allowedSenders: string;
};

function validate(input: MailInboxSettingsInput, hasStoredPassword: boolean) {
  if (!input.host.trim()) throw new HttpError(400, "Indica el servidor IMAP (p. ej. imap.gmail.com).");
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) throw new HttpError(400, "El puerto IMAP no es válido (normalmente 993).");
  if (!input.username.trim()) throw new HttpError(400, "Indica el usuario del buzón (normalmente la dirección de correo).");
  if (!input.password && !hasStoredPassword) throw new HttpError(400, "Indica la contraseña del buzón (o una contraseña de aplicación).");
  if (parseAllowedSenders(input.allowedSenders).length === 0) {
    throw new HttpError(400, "Indica al menos un remitente permitido (tu correo o el dominio de tus proveedores): así nadie más puede meter documentos en tu bandeja.");
  }
}

export async function saveMailInboxSettings(actor: { tenantId: string; companyId: string; actorUserId: string }, input: MailInboxSettingsInput) {
  const existing = await loadRow(actor.companyId);
  validate(input, Boolean(existing?.passwordEncrypted));
  const connectionChanged = !existing
    || existing.host !== input.host.trim()
    || existing.username !== input.username.trim()
    || existing.mailbox !== (input.mailbox.trim() || "INBOX");
  const values = {
    enabled: input.enabled,
    host: input.host.trim(),
    port: input.port,
    secure: input.secure,
    username: input.username.trim(),
    passwordEncrypted: input.password ? sealSecret(input.password, SECRET_PURPOSE, encryptionSecret()) : existing!.passwordEncrypted,
    mailbox: input.mailbox.trim() || "INBOX",
    processedMailbox: input.processedMailbox?.trim() || null,
    allowedSenders: parseAllowedSenders(input.allowedSenders).join(", "),
    configuredByUserId: actor.actorUserId,
    // Otra cuenta o carpeta: se vuelve a empezar desde los correos nuevos.
    ...(connectionChanged ? { uidValidity: null, lastUid: null } : {}),
    lastError: null,
    updatedAt: new Date(),
  };
  await db
    .insert(expenseMailInbox)
    .values({ ...values, tenantId: actor.tenantId, companyId: actor.companyId })
    .onConflictDoUpdate({ target: expenseMailInbox.companyId, set: values });
  await recordAudit({
    tenantId: actor.tenantId,
    companyId: actor.companyId,
    actorUserId: actor.actorUserId,
    action: "expense.mailInbox.update",
    entityName: "expenseMailInbox",
    entityId: actor.companyId,
    payload: { enabled: input.enabled, host: values.host, username: values.username, mailbox: values.mailbox, passwordChanged: Boolean(input.password) },
  });
  return getMailInboxSettings(actor.companyId);
}

export async function deleteMailInboxSettings(actor: { tenantId: string; companyId: string; actorUserId: string }) {
  await db.delete(expenseMailInbox).where(eq(expenseMailInbox.companyId, actor.companyId));
  await recordAudit({ tenantId: actor.tenantId, companyId: actor.companyId, actorUserId: actor.actorUserId, action: "expense.mailInbox.delete", entityName: "expenseMailInbox", entityId: actor.companyId, payload: {} });
}

function imapClient(connection: MailInboxConnection) {
  return new ImapFlow({
    host: connection.host,
    port: connection.port,
    secure: connection.secure,
    auth: { user: connection.username, pass: connection.password },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
}

/** Prueba la conexión (con la contraseña indicada o la guardada). Devuelve cuántos correos hay en la carpeta. */
export async function testMailInboxConnection(companyId: string, input: Omit<MailInboxSettingsInput, "enabled" | "allowedSenders"> & { allowedSenders?: string }) {
  const stored = await loadRow(companyId);
  const password = input.password || (stored?.passwordEncrypted ? openSecret(stored.passwordEncrypted, SECRET_PURPOSE, encryptionSecret()) : "");
  if (!password) throw new HttpError(400, "Indica la contraseña del buzón para probar la conexión.");
  const client = imapClient({ host: input.host.trim(), port: input.port, secure: input.secure, username: input.username.trim(), password, mailbox: input.mailbox.trim() || "INBOX" });
  try {
    await client.connect();
    const lock = await client.getMailboxLock(input.mailbox.trim() || "INBOX");
    try {
      const mailbox = client.mailbox;
      return { messages: mailbox ? mailbox.exists : 0 };
    } finally {
      lock.release();
    }
  } catch (error) {
    throw new HttpError(400, mailInboxErrorMessage(error));
  } finally {
    await client.logout().catch(() => undefined);
  }
}

type CheckResult = { imported: number; ignoredSenders: number; skippedAttachments: number; messages: number };

async function importMessage(row: InboxRow, raw: Buffer): Promise<{ imported: number; ignoredSender: boolean; skipped: number }> {
  const parsed = await simpleParser(raw);
  const fromAddress = parsed.from?.value?.[0]?.address ?? null;
  if (!isAllowedSender(fromAddress, parseAllowedSenders(row.allowedSenders))) {
    logger.info({ companyId: row.companyId, from: fromAddress }, "expense_mail_inbox.sender_ignored");
    return { imported: 0, ignoredSender: true, skipped: 0 };
  }
  const messageId = parsed.messageId ?? null;
  const { accepted, skipped } = selectInvoiceAttachments(parsed.attachments.map((attachment) => ({
    filename: attachment.filename,
    contentType: attachment.contentType,
    size: attachment.size,
    content: attachment.content,
  })));
  let imported = 0;
  for (const attachment of accepted) {
    // Reintento tras un corte: el mismo adjunto del mismo correo no se importa dos veces.
    if (messageId) {
      const [already] = await db
        .select({ id: expenseOcrJob.id })
        .from(expenseOcrJob)
        .where(and(eq(expenseOcrJob.companyId, row.companyId), eq(expenseOcrJob.sourceMessageId, messageId), eq(expenseOcrJob.fileName, sanitizeFileName(attachment.fileName))))
        .limit(1);
      if (already) continue;
    }
    try {
      await createExpenseOcrJob({
        tenantId: row.tenantId,
        companyId: row.companyId,
        actorUserId: row.configuredByUserId,
        fileName: attachment.fileName,
        contentType: attachment.contentType,
        buffer: attachment.content,
        extractionProvider: "openai",
        source: { type: "email", from: fromAddress, subject: parsed.subject ?? null, messageId },
      });
      imported += 1;
    } catch (error) {
      // Archivo dañado o que no es lo que dice ser: se registra y se sigue con el resto.
      logger.warn({ companyId: row.companyId, fileName: attachment.fileName, error: error instanceof Error ? error.message : String(error) }, "expense_mail_inbox.attachment_rejected");
    }
  }
  return { imported, ignoredSender: false, skipped: skipped.length };
}

/** Revisa el buzón de una empresa e importa los adjuntos de los correos nuevos. */
export async function checkMailInbox(row: InboxRow): Promise<CheckResult> {
  const startedAt = new Date();
  const result: CheckResult = { imported: 0, ignoredSenders: 0, skippedAttachments: 0, messages: 0 };
  const password = openSecret(row.passwordEncrypted, SECRET_PURPOSE, encryptionSecret());
  const client = imapClient({ host: row.host, port: row.port, secure: row.secure, username: row.username, password, mailbox: row.mailbox });
  try {
    await client.connect();
    const lock = await client.getMailboxLock(row.mailbox);
    try {
      const mailbox = client.mailbox;
      if (!mailbox) throw new Error("No se pudo abrir la carpeta del buzón.");
      const uidValidity = mailbox.uidValidity.toString();
      // Primera revisión (o la carpeta cambió de UIDVALIDITY): se empieza desde los correos que lleguen ahora.
      if (row.lastUid === null || row.uidValidity !== uidValidity) {
        const startUid = Math.max(mailbox.uidNext - 1, 0);
        await db.update(expenseMailInbox).set({ uidValidity, lastUid: startUid, lastCheckedAt: startedAt, lastSuccessAt: startedAt, lastError: null, lastImportedCount: 0 }).where(eq(expenseMailInbox.id, row.id));
        return result;
      }
      const lastUid = row.lastUid;
      const pending: Array<{ uid: number; source: Buffer }> = [];
      if (mailbox.exists > 0 && mailbox.uidNext - 1 > lastUid) {
        // Se descargan primero (no se pueden lanzar otros comandos durante un FETCH) y luego se procesan.
        for await (const message of client.fetch(`${lastUid + 1}:*`, { uid: true, size: true, source: true }, { uid: true })) {
          if (message.uid <= lastUid || !message.source) continue;
          if ((message.size ?? message.source.byteLength) > MAX_MESSAGE_BYTES) continue;
          pending.push({ uid: message.uid, source: message.source });
          if (pending.length >= MAX_MESSAGES_PER_CHECK) break;
        }
      }
      let processedUpTo = lastUid;
      const processedUids: number[] = [];
      for (const message of pending.sort((left, right) => left.uid - right.uid)) {
        const imported = await importMessage(row, message.source);
        result.messages += 1;
        result.imported += imported.imported;
        result.skippedAttachments += imported.skipped;
        if (imported.ignoredSender) result.ignoredSenders += 1;
        else processedUids.push(message.uid);
        processedUpTo = message.uid;
        // Se avanza el punto de lectura mensaje a mensaje: si algo falla después, no se repite lo hecho.
        await db.update(expenseMailInbox).set({ lastUid: processedUpTo }).where(eq(expenseMailInbox.id, row.id));
      }
      if (processedUids.length > 0) {
        await client.messageFlagsAdd(processedUids, ["\\Seen"], { uid: true }).catch(() => undefined);
        if (row.processedMailbox) await client.messageMove(processedUids, row.processedMailbox, { uid: true }).catch(() => undefined);
      }
      await db
        .update(expenseMailInbox)
        .set({ lastCheckedAt: startedAt, lastSuccessAt: new Date(), lastError: null, lastImportedCount: result.imported })
        .where(eq(expenseMailInbox.id, row.id));
      if (result.messages > 0) logger.info({ companyId: row.companyId, ...result }, "expense_mail_inbox.checked");
      return result;
    } finally {
      lock.release();
    }
  } catch (error) {
    const message = mailInboxErrorMessage(error);
    await db.update(expenseMailInbox).set({ lastCheckedAt: startedAt, lastError: message }).where(eq(expenseMailInbox.id, row.id));
    logger.warn({ companyId: row.companyId, error: error instanceof Error ? error.message : String(error) }, "expense_mail_inbox.check_failed");
    throw new HttpError(502, message);
  } finally {
    await client.logout().catch(() => undefined);
  }
}

/** «Comprobar ahora» desde la configuración. */
export async function checkCompanyMailInbox(companyId: string) {
  const row = await loadRow(companyId);
  if (!row) throw new HttpError(404, "Configura primero el buzón de facturas.");
  if (!row.enabled) throw new HttpError(409, "Activa el buzón para poder revisarlo.");
  return checkMailInbox(row);
}

/** Worker: revisa todos los buzones activos (uno detrás de otro; un fallo no detiene al resto). */
export async function checkAllMailInboxes() {
  const rows = await db.select().from(expenseMailInbox).where(eq(expenseMailInbox.enabled, true));
  let imported = 0;
  for (const row of rows) {
    // Con el módulo de lectura desactivado el buzón no se revisa (se conserva su configuración).
    if (!(await isModuleEnabled(row.companyId, "invoice-reading"))) continue;
    try {
      imported += (await checkMailInbox(row)).imported;
    } catch {
      // Ya registrado en lastError y en el log.
    }
  }
  return { inboxes: rows.length, imported };
}
