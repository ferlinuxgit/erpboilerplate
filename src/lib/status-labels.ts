export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

export const invoiceStatusLabels: Record<string, string> = {
  DRAFT: "Borrador",
  SENT: "Emitida",
  PAID: "Pagada",
  OVERDUE: "Vencida",
  VOID: "Anulada",
};

export const invoicePaymentStatusLabels: Record<string, string> = {
  PENDING: "Pendiente",
  PARTIAL: "Parcial",
  PAID: "Pagada",
  OVERDUE: "Vencida",
  VOID: "Anulada",
};

export const purchaseOrderStatusLabels: Record<string, string> = {
  DRAFT: "Borrador",
  SENT: "Enviado",
  APPROVED: "Aprobado",
  PARTIALLY_RECEIVED: "Recepción parcial",
  RECEIVED: "Recibido",
  INVOICED: "Facturado",
  PAID: "Pagado",
  VOID: "Anulado",
  CANCELLED: "Cancelado",
};

export const salesDocumentStatusLabels: Record<string, string> = {
  DRAFT: "Borrador",
  SENT: "Enviado",
  CONFIRMED: "Confirmado",
  DELIVERED: "Entregado",
  INVOICED: "Facturado",
  PAID: "Pagado",
  VOID: "Anulado",
};

export const reconciliationStatusLabels: Record<string, string> = {
  PENDING: "Pendiente",
  RECONCILED: "Conciliado",
};

export const accountTypeLabels: Record<string, string> = {
  ASSET: "Activo",
  LIABILITY: "Pasivo",
  EQUITY: "Patrimonio neto",
  REVENUE: "Ingreso",
  EXPENSE: "Gasto",
  MIXED: "Mixta",
};

export const roleLabels: Record<string, string> = {
  OWNER: "Propietario",
  ADMIN: "Administrador",
  MEMBER: "Miembro",
};

export const stockMovementTypeLabels: Record<string, string> = {
  IN: "Entrada",
  OUT: "Salida",
  ADJUSTMENT: "Ajuste",
  TRANSFER: "Traspaso",
};

export function statusLabel(labels: Record<string, string>, status: string) {
  return labels[status] ?? status;
}

/** Etiquetas legibles de los códigos `audit_log.action` (`<entidad>.<verbo>`). */
export const auditActionLabels: Record<string, string> = {
  // Clientes y proveedores
  "customer.create": "Cliente creado",
  "customer.update": "Cliente modificado",
  "customer.delete": "Cliente eliminado",
  "supplier.create": "Proveedor creado",
  "supplier.update": "Proveedor modificado",
  "supplier.delete": "Proveedor eliminado",
  // Impuestos, formas de pago y configuración
  "tax.create": "Impuesto creado",
  "tax.update": "Impuesto modificado",
  "tax.archive": "Impuesto archivado",
  "tax.delete": "Impuesto eliminado",
  "paymentMethod.create": "Forma de pago creada",
  "paymentMethod.update": "Forma de pago modificada",
  "paymentMethod.delete": "Forma de pago eliminada",
  "payment_method.create": "Forma de pago creada",
  "payment_method.update": "Forma de pago modificada",
  "payment_method.delete": "Forma de pago eliminada",
  "companySettings.create": "Configuración fiscal y contable creada",
  "companySettings.update": "Configuración fiscal y contable modificada",
  "company.profile.update": "Perfil de empresa modificado",
  "company.pdf_settings.update": "Configuración de PDF modificada",
  "company.defaults.repair": "Configuración por defecto aplicada",
  "company.defaults.ensure": "Configuración por defecto completada",
  "onboarding.seed.apply": "Plantilla inicial aplicada",
  "security_policy.created": "Política de seguridad creada",
  "security_policy.updated": "Política de seguridad modificada",
  "documentSeries.create": "Serie de numeración creada",
  "documentSeries.update": "Serie de numeración modificada",
  "documentSeries.gap": "Salto de numeración confirmado",
  // Ventas
  "salesQuote.create": "Presupuesto creado",
  "salesQuote.update": "Presupuesto modificado",
  "salesQuote.convert": "Presupuesto convertido en pedido",
  "salesOrder.create": "Pedido de venta creado",
  "deliveryNote.create": "Albarán creado",
  "sales.delivery.create": "Albarán creado",
  "sales.delivery.invoice": "Albarán facturado",
  "invoice.create": "Factura creada (borrador)",
  "invoice.update": "Factura modificada",
  "invoice.issue": "Factura emitida",
  "invoice.void": "Factura anulada",
  "invoice.creditNote": "Factura rectificativa emitida",
  "invoice.duplicate": "Factura duplicada",
  "invoice.payment.create": "Cobro registrado",
  // Inventario
  "item.create": "Artículo creado",
  "item.update": "Artículo modificado",
  "item.archive": "Artículo archivado",
  "warehouse.create": "Almacén creado",
  "warehouse.update": "Almacén modificado",
  "warehouse.archive": "Almacén archivado",
  "stockMovement.create": "Movimiento de stock registrado",
  // Compras y gastos
  "purchase.create": "Pedido de compra creado",
  "purchase.update": "Pedido de compra modificado",
  "purchase.delete": "Pedido de compra eliminado",
  "purchase.receipt.create": "Recepción de mercancía registrada",
  "purchase.supplierInvoice.create": "Factura de proveedor registrada",
  "supplier_payment.create": "Pago a proveedor registrado",
  "expense.create": "Gasto registrado",
  "expense.delete": "Gasto eliminado",
  "expense.void": "Gasto anulado",
  "expense.ocr.attach": "Documento OCR adjuntado a gasto",
  // Contabilidad y fiscalidad
  "accounting.account.create": "Cuenta contable creada",
  "accounting.account.update": "Cuenta contable modificada",
  "accounting.account.deactivate": "Cuenta contable desactivada",
  "accounting.entry.create": "Asiento creado",
  "accounting.entry.update": "Asiento modificado",
  "accounting.entry.reverse": "Asiento anulado (contraasiento)",
  "accounting.reverse.automatic": "Contraasiento automático",
  "accounting.autopost.salesInvoice": "Asiento automático de factura emitida",
  "accounting.autopost.creditNote": "Asiento automático de factura rectificativa",
  "accounting.autopost.supplierInvoice": "Asiento automático de factura recibida",
  "accounting.autopost.customerPayment": "Asiento automático de cobro",
  "accounting.autopost.supplierPayment": "Asiento automático de pago",
  "accounting.autopost.bankTransaction": "Asiento automático de movimiento bancario",
  "accounting.autopost.fiscalYearOpening": "Asiento de apertura",
  "accounting.autopost.fiscalYearRegularization": "Asiento de regularización",
  "accounting.autopost.fiscalYearClosing": "Asiento de cierre",
  "accounting.fiscalYear.open": "Ejercicio abierto",
  "accounting.fiscalYear.close": "Ejercicio cerrado",
  "accounting.fiscalYear.reopen": "Ejercicio reabierto",
  "fiscal.create": "Modelo fiscal creado",
  "fiscal.update": "Modelo fiscal modificado",
  "fiscal.delete": "Modelo fiscal eliminado",
  "fiscal.reopen": "Modelo fiscal reabierto",
  // Tesorería
  "treasury.account.create": "Cuenta bancaria creada",
  "treasury.account.update": "Cuenta bancaria modificada",
  "treasury.account.delete": "Cuenta bancaria eliminada",
  "treasury.account.archive": "Cuenta bancaria archivada",
  "treasury.account.reactivate": "Cuenta bancaria reactivada",
  "treasury.transaction.create": "Movimiento bancario creado",
  "treasury.transaction.update": "Movimiento bancario modificado",
  "treasury.transaction.delete": "Movimiento bancario eliminado",
  "treasury.reconcile.match": "Movimiento conciliado",
  "treasury.reconcile.undo": "Conciliación deshecha",
  "treasury.reconcile.auto": "Conciliación automática",
  "treasury.reconcile.manual": "Conciliación manual",
  // Equipo, accesos y facturación de la suscripción
  "team.member.remove": "Miembro eliminado del equipo",
  "team.member.update": "Miembro del equipo modificado",
  "team.member.role.update": "Rol de miembro modificado",
  "invitation.create": "Invitación enviada",
  "invitation.accept": "Invitación aceptada",
  "apiKey.create": "Clave API creada",
  "apiKey.update": "Clave API modificada",
  "apiKey.revoke": "Clave API revocada",
  "apiKey.rotate": "Clave API rotada",
  "apiKey.delete": "Clave API eliminada",
  "billing.checkout.attempt": "Inicio de pago de suscripción",
  "billing.checkout.success": "Pago de suscripción iniciado",
  "billing.checkout.error": "Error al iniciar el pago de suscripción",
  "billing.portal.attempt": "Acceso al portal de facturación",
  "billing.portal.success": "Portal de facturación abierto",
  "billing.portal.error": "Error al abrir el portal de facturación",
};

/** Etiquetas de `audit_log.entityName` (nombre de tabla en camelCase; incluye alias históricos). */
export const auditEntityLabels: Record<string, string> = {
  accountChart: "Cuenta contable",
  apiKey: "Clave API",
  bankAccount: "Cuenta bancaria",
  bankTransaction: "Movimiento bancario",
  billingCheckout: "Pago de suscripción",
  billingPortal: "Portal de facturación",
  company: "Empresa",
  companySettings: "Configuración de empresa",
  customer: "Cliente",
  deliveryNote: "Albarán",
  delivery_note: "Albarán",
  documentSeries: "Serie de numeración",
  fiscalReport: "Modelo fiscal",
  fiscalYear: "Ejercicio",
  goodsReceipt: "Recepción de mercancía",
  goods_receipt: "Recepción de mercancía",
  invitation: "Invitación",
  invoice: "Factura",
  invoicePayment: "Cobro",
  item: "Artículo",
  journalEntry: "Asiento",
  membership: "Miembro del equipo",
  partner: "Tercero",
  payment: "Pago",
  paymentMethod: "Forma de pago",
  purchaseOrder: "Pedido de compra",
  salesOrder: "Pedido de venta",
  salesQuote: "Presupuesto",
  stockMovement: "Movimiento de stock",
  supplier: "Proveedor",
  supplierInvoice: "Factura de proveedor",
  supplierPayment: "Pago a proveedor",
  supplier_payment: "Pago a proveedor",
  tax: "Impuesto",
  tenant_security_policy: "Política de seguridad",
  tenantSecurityPolicy: "Política de seguridad",
  warehouse: "Almacén",
};

function humanizeCode(code: string) {
  const words = code
    .split(/[._]/)
    .filter(Boolean)
    .map((part) => part.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase())
    .join(" ")
    .trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : code;
}

/** Etiqueta en español de una acción auditada; si no está catalogada, devuelve el código legible. */
export function auditActionLabel(action: string) {
  return auditActionLabels[action] ?? humanizeCode(action);
}

/** Etiqueta en español de una entidad auditada; si no está catalogada, devuelve el nombre legible. */
export function auditEntityLabel(entityName: string) {
  return auditEntityLabels[entityName] ?? humanizeCode(entityName);
}

export function invoiceStatusTone(status: string): StatusTone {
  if (status === "PAID") return "success";
  if (status === "OVERDUE" || status === "VOID") return "danger";
  if (status === "SENT") return "info";
  return "neutral";
}

export function invoicePaymentStatusTone(status: string): StatusTone {
  if (status === "PAID") return "success";
  if (status === "OVERDUE" || status === "VOID") return "danger";
  if (status === "PARTIAL") return "warning";
  return "neutral";
}

export function purchaseOrderStatusTone(status: string): StatusTone {
  if (status === "RECEIVED" || status === "INVOICED" || status === "PAID") return "success";
  if (status === "PARTIALLY_RECEIVED") return "warning";
  if (status === "SENT" || status === "APPROVED") return "info";
  if (status === "VOID" || status === "CANCELLED") return "danger";
  return "neutral";
}

export function salesDocumentStatusTone(status: string): StatusTone {
  if (status === "DELIVERED" || status === "INVOICED" || status === "PAID") return "success";
  if (status === "SENT" || status === "CONFIRMED") return "info";
  if (status === "VOID") return "danger";
  return "neutral";
}
