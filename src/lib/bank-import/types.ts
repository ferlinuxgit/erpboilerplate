/** Movimiento leído de un extracto (CSV, Excel o Norma 43), antes de guardarlo. */
export type ImportedMovement = {
  /** Número de línea/fila del fichero (base 1), para explicar los errores. */
  line: number;
  postedAt: Date;
  valueDate: Date | null;
  /** Con signo: positivo entra dinero, negativo sale. */
  amount: number;
  description: string;
  reference: string | null;
  /** Saldo de la cuenta después del movimiento, si el extracto lo trae. */
  balanceAfter: number | null;
};

export type SkippedRow = { line: number; reason: string };

export type ParsedStatement = {
  movements: ImportedMovement[];
  skipped: SkippedRow[];
};
