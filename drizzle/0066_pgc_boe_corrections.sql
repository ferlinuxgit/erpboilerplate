-- Plan General de Contabilidad: nombres corregidos contra el cuadro de cuentas del BOE
-- (BOE-A-2007-19884). La plantilla llevaba la errata de la última versión consolidada del grupo 5:
-- la 500 con dos nombres pegados y la 501 con el nombre de la 502. Solo se tocan las cuentas (y sus
-- subcuentas) que conservan exactamente el nombre erróneo de la plantilla; las renombradas por la
-- empresa no cambian. Las cuentas nuevas (502, 1141, 2935, 2936, 5935, 5936, 6634 y 7634) llegan
-- con «Cargar plantilla» o al usarse por primera vez.
UPDATE "account_chart" SET "name" = 'Obligaciones y bonos a corto plazo'
WHERE "code" LIKE '500%' AND "name" = 'Obligaciones y bonos a corto plazo Obligaciones y bonos convertibles a corto plazo';
--> statement-breakpoint
UPDATE "account_chart" SET "name" = 'Obligaciones y bonos convertibles a corto plazo'
WHERE "code" LIKE '501%' AND "name" = 'Acciones o participaciones a corto plazo consideradas como pasivos financieros';
--> statement-breakpoint
UPDATE "account_chart" SET "name" = 'EMPRÉSTITOS, DEUDAS CON CARACTERÍSTICAS ESPECIALES Y OTRAS EMISIONES ANÁLOGAS A CORTO PLAZO'
WHERE "code" = '50' AND "name" = 'EMPRÉSTITOS, DEUDAS CON CARÁCTERÍSTICAS ESPECIALES Y OTRAS EMISIONES ANÁLOGAS A CORTO PLAZO';
--> statement-breakpoint
UPDATE "account_chart" SET "name" = 'PÉRDIDAS POR DETERIORO Y OTRAS DOTACIONES'
WHERE "code" = '69' AND "name" = 'PÉRDIDAS POR DETERIOROY OTRAS DOTACIONES';
--> statement-breakpoint
UPDATE "account_chart" SET "name" = 'SUBVENCIONES, DONACIONES Y LEGADOS'
WHERE "code" = '74' AND "name" = 'SUBVENCIONES, DONACIONESY LEGADOS';
--> statement-breakpoint
UPDATE "account_chart" SET "name" = 'TRANSFERENCIAS DE SUBVENCIONES, DONACIONES Y LEGADOS'
WHERE "code" = '84' AND "name" = 'TRANSFERENCIAS DE SUBVENCIONES, DONACIONESY LEGADOS';
--> statement-breakpoint
UPDATE "account_chart" SET "name" = 'INGRESOS FINANCIEROS POR VALORACIÓN DE ACTIVOS Y PASIVOS'
WHERE "code" = '90' AND "name" = 'INGRESOS FINANCIEROS POR VALORACIÓN DE ACTIVOSY PASIVOS';
--> statement-breakpoint
UPDATE "account_chart" SET "name" = 'Acreedores por arrendamiento financiero a largo plazo, empresas del grupo'
WHERE "code" LIKE '1623%' AND "name" = 'Acreedores por arrendamiento financiero a largo plazo, empresas de grupo';
--> statement-breakpoint
UPDATE "account_chart" SET "name" = 'Retribuciones al personal liquidadas con instrumentos de patrimonio'
WHERE "code" LIKE '6450%' AND "name" = 'Retribuciones al personal liquidados con instrumentos de patrimonio';
--> statement-breakpoint
UPDATE "account_chart" SET "name" = 'Retribuciones al personal liquidadas en efectivo basado en instrumentos de patrimonio'
WHERE "code" LIKE '6457%' AND "name" = 'Retribuciones al personal liquidados en efectivo basado en instrumentos de patrimonio';
