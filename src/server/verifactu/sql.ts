/**
 * SQL de integridad VeriFactu que Drizzle no genera (triggers). Debe añadirse a la migración que
 * crea `verifactu_record` / `verifactu_event` (tras las sentencias CREATE TABLE).
 *
 * - `verifactu_record`: solo se pueden actualizar los campos de estado de envío. Cualquier cambio en
 *   un campo que intervenga en la huella o en el encadenamiento (o en el contenido del registro)
 *   se rechaza. Los borrados se rechazan salvo purga explícita de la empresa
 *   (`SET LOCAL verifactu.allow_purge = 'on'`).
 * - `verifactu_event`: registro de eventos de solo inserción.
 */

/** Columnas de `verifactu_record` que el envío a la AEAT puede actualizar. */
export const VERIFACTU_MUTABLE_COLUMNS = [
  "status",
  "sendAttempts",
  "nextAttemptAt",
  "lastAttemptAt",
  "sentAt",
  "aeatCsv",
  "aeatErrorCode",
  "aeatErrorMessage",
] as const;

export const VERIFACTU_TRIGGERS_SQL = `
CREATE OR REPLACE FUNCTION verifactu_record_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('verifactu.allow_purge', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'VeriFactu: los registros de facturación no se pueden borrar' USING ERRCODE = 'P0001';
  END IF;
  IF (to_jsonb(NEW) - ARRAY[${VERIFACTU_MUTABLE_COLUMNS.map((column) => `'${column}'`).join(", ")}])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY[${VERIFACTU_MUTABLE_COLUMNS.map((column) => `'${column}'`).join(", ")}]) THEN
    RAISE EXCEPTION 'VeriFactu: el contenido, la huella y el encadenamiento de un registro de facturación son inmutables' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS verifactu_record_immutable ON "verifactu_record";
--> statement-breakpoint
CREATE TRIGGER verifactu_record_immutable BEFORE UPDATE OR DELETE ON "verifactu_record"
  FOR EACH ROW EXECUTE FUNCTION verifactu_record_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION verifactu_event_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('verifactu.allow_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'VeriFactu: el registro de eventos es de solo inserción' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS verifactu_event_immutable ON "verifactu_event";
--> statement-breakpoint
CREATE TRIGGER verifactu_event_immutable BEFORE UPDATE OR DELETE ON "verifactu_event"
  FOR EACH ROW EXECUTE FUNCTION verifactu_event_guard();
`;

/** Sentencias individuales (para ejecutarlas una a una, p. ej. en tests con PGlite). */
export function verifactuTriggerStatements() {
  return VERIFACTU_TRIGGERS_SQL.split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean);
}
