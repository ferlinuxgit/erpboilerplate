export const defaultAccountingAccounts = [
  { code: "430000", name: "Clientes", type: "ASSET", role: "Cuenta de clientes para facturas emitidas y cobros." },
  { code: "410000", name: "Acreedores por prestaciones de servicios", type: "LIABILITY", role: "Cuenta de proveedores y acreedores para compras y pagos." },
  { code: "572000", name: "Bancos e instituciones de credito c/c vista", type: "ASSET", role: "Cuenta bancaria para cobros, pagos y conciliación." },
  { code: "700000", name: "Ventas de mercaderias", type: "REVENUE", role: "Ingresos por ventas en facturas de cliente." },
  { code: "600000", name: "Compras de mercaderias", type: "EXPENSE", role: "Gastos por compras en facturas de proveedor." },
  { code: "472000", name: "Hacienda Publica, IVA soportado", type: "ASSET", role: "IVA deducible de compras y facturas recibidas." },
  { code: "477000", name: "Hacienda Publica, IVA repercutido", type: "LIABILITY", role: "IVA devengado en facturas emitidas." },
  { code: "475100", name: "Hacienda Publica, acreedora por retenciones practicadas", type: "LIABILITY", role: "Retenciones fiscales pendientes de liquidar." },
  { code: "129000", name: "Resultado del ejercicio", type: "EQUITY", role: "Cuenta de cierre para resultado anual." },
] as const;

export const defaultAccountingJournals = [
  { code: "VEN", name: "Diario de ventas", role: "Asientos generados por facturas emitidas." },
  { code: "COM", name: "Diario de compras", role: "Asientos de compras y facturas recibidas." },
  { code: "BAN", name: "Diario de bancos", role: "Cobros, pagos y movimientos bancarios." },
  { code: "GEN", name: "Diario general", role: "Asientos manuales y operaciones generales." },
  { code: "CIE", name: "Diario de cierre", role: "Regularización y cierre fiscal." },
] as const;

export type AccountingAccountType = (typeof defaultAccountingAccounts)[number]["type"];
export type AccountingMasterAccount = { code: string; name: string; type: AccountingAccountType; role?: string };
export type AccountingMasterJournal = { code: string; name: string; role?: string };
