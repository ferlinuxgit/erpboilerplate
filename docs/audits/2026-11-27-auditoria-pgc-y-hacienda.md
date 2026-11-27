# Auditoría: Plan General de Contabilidad y cumplimiento con Hacienda (2026-11-27)

**Pregunta.** ¿Cumple el programa al 100 % el plan contable español y los requisitos de la Agencia Tributaria?

**Respuesta corta.** No al 100 %, y ningún programa puede garantizarlo solo: parte del cumplimiento depende de cómo se use y de datos que el programa no conoce. Lo que sí se puede decir:

- El **cuadro de cuentas** queda ya idéntico al del BOE.
- La **contabilidad de base** (partida doble, asientos automáticos, cierre, libros diario y mayor) es correcta.
- El **núcleo de VERI\*FACTU** (huella, encadenamiento, inalterabilidad, XML, QR) está bien hecho.
- Los **modelos 303, 111, 115, 130, 347 y 349** sirven como borrador fiable para un autónomo o una pyme en régimen general sin casos especiales. No generan fichero de presentación.
- Quedan **carencias serias** que se listan abajo, ordenadas por riesgo.

**Método.** Cuatro revisiones independientes del código (plan contable y asientos, VERI\*FACTU, modelos tributarios, facturación), contrastadas con las fuentes oficiales descargadas ese día:

| Fuente | Uso |
|---|---|
| BOE-A-2007-19884, texto consolidado (RD 1514/2007 con RD 602/2016 y RD 1/2021) | Cuadro de cuentas y modelos abreviados de cuentas anuales |
| Instrucciones del modelo 303 de 2025 y 2026 (AEAT) | Casillas y plazos |
| Instrucciones del modelo 130 (AEAT) | Casillas 07, 12 y 15 |
| RD 1007/2023 y Orden HAC/1177/2024 consolidados; validaciones VERI\*FACTU v1.2.2, WSDL y especificación del QR (AEAT) | VERI\*FACTU |
| RD 1619/2012 consolidado y RD 238/2026 | Facturación |

Lo relativo a los modelos 347, 349, 111/115, 390 e Impuesto sobre Sociedades, y a la LIVA, Ley 7/2012 y Ley 3/2004, sale del conocimiento de la norma, no de una consulta de ese día. Nada se ha probado contra los servicios de la AEAT.

---

## 1. Corregido en esta revisión

### Plan contable

| Qué | Detalle |
|---|---|
| Cuentas que faltaban | 502, 1141, 2935, 2936, 5935, 5936, 6634 y 7634 (las seis últimas, del RD 1/2021). La plantilla pasa de 895 a 903 cuentas y coincide código a código con el BOE. |
| Nombres erróneos | La 500 llevaba dos nombres pegados y la 501 tenía el nombre de la 502 (errata de la última versión consolidada del BOE, que la plantilla había copiado). Corregidas también seis erratas tipográficas. La migración `0066` renombra las cuentas de las empresas existentes que conservaban el nombre erróneo. |
| Grupos 8 y 9 | El cierre los trataba como cuentas de balance y los arrastraba al ejercicio siguiente. Ahora el cierre se detiene y pide traspasarlos al subgrupo 13, y el balance los muestra en el patrimonio neto. |
| Cuentas anuales oficiales | Nuevo balance y cuenta de pérdidas y ganancias en el **modelo abreviado del PGC**, con los epígrafes y el reparto de cuentas del BOE y columna del ejercicio anterior (Contabilidad › Estados financieros). Un test comprueba que todas las cuentas del plan tienen epígrafe. |

### Modelos tributarios

| Qué | Antes | Ahora |
|---|---|---|
| 303, recargo del 0,5 % | Casillas 16-18 | Casillas 168-170 (diseño de 2025 en adelante; los periodos de 2024 conservan el suyo) |
| 303, tipo del 5 % | Casillas 153-155 | Sin casilla desde 2025: se marca para revisar |
| 130, casilla 12 | Podía ser negativa y el negativo se descontaba otra vez con la 15 (se ingresaba de menos) | Nunca negativa, como piden las instrucciones |
| 130, gastos | Repartidos por fecha de factura tras filtrarlos por fecha de registro (una factura de diciembre registrada en enero no contaba hasta el 4T) | Por fecha de registro |
| 347 | Agrupaba por NIF y nombre; incluía el cliente genérico del TPV; umbral «≥» y sin valor absoluto; compras por fecha de factura | Agrupa por NIF normalizado; excluye el cliente genérico; «superior a 3.005,06 €» en valor absoluto; compras por fecha de registro |
| 349 y retenciones | Compras por fecha de factura | Por fecha de registro, igual que el 303 |
| Plazo del 303 mensual | Día 20 | Día 30 del mes siguiente (enero: fin de febrero) |
| Plazos en fin de semana | No se trasladaban | Pasan al lunes (los festivos no se contemplan) |

### VERI\*FACTU y facturación

| Qué | Detalle |
|---|---|
| IPSI (Ceuta y Melilla) | Los registros iban sin `ClaveRegimen`: la AEAT los acepta con errores hasta el 31-12-2026 y **los rechaza desde el 01-01-2027**. Ahora llevan la clave. |
| Reintentos | El tope de espera entre reintentos baja de 6 horas a 1 (art. 16.4 de la Orden: al menos uno cada hora). |
| Fecha futura | Ya no se puede emitir una factura con fecha de expedición posterior a hoy (la AEAT rechaza el registro y no es subsanable). |
| Aviso de obligatoriedad | Decía «a partir de 2027». El Real Decreto-ley 43/2026 (BOE del 25-11-2026) liga la fecha al calendario de la factura electrónica del RD 238/2026. Texto actualizado. Pendiente de convalidación en el Congreso. |

---

## 2. Segunda tanda (misma fecha): implementado

Los números entre paréntesis son los de la lista original de pendientes, que se conserva en el historial de este archivo.

### Facturación
- **Al emitir (3, 4, 5):** se comprueban los datos obligatorios del emisor, el domicilio del destinatario cuando es una entidad, el límite de la factura simplificada (400 € o 3.000 €, configurable en Configuración › Fiscalidad; cada caja del TPV conserva el suyo), el recargo de equivalencia en las líneas de bienes y el orden cronológico dentro de la serie.
- **Recargo de equivalencia (5):** presupuesto, pedido y albarán → factura ya lo añaden a los bienes.
- **Criterio de caja (6):** mención «Régimen especial del criterio de caja» en el PDF. El cálculo del 303 por cobros y pagos sigue pendiente.
- **Recurrentes atrasadas:** se expiden hoy con el periodo como fecha de operación.
- **Series:** prefijo y formato fijos tras la primera emisión; formato con `{NUMBER}` y solo caracteres que admite la AEAT.
- **PDF:** título «Factura simplificada» sin NIF; fecha en día civil peninsular (7).
- **Cobros en efectivo:** bloqueo desde 1.000 € (10.000 € particulares no residentes).
- **Exportación y purga del espacio:** incluyen los PDF de las facturas emitidas.

### VERI\*FACTU
- **Entorno (1):** cada registro, evento y cadena guarda su entorno; punto de acceso y QR salen del registro; rótulo «ENTORNO DE PRUEBAS» en pantalla, factura, PDF y ticket. Con el envío activado, `VERIFACTU_ENVIRONMENT` es obligatoria y el contenedor no arranca sin ella.
- **Registro según la fecha real de emisión (2).**
- **Certificado (14):** lectura de titular y caducidad, rechazo de caducados, avisos, punto de acceso de certificados de sello.
- **Avisos (14):** `getVerifactuHealth` reúne pendientes sin remitir, rechazados, certificado y entorno; se muestran en Fiscalidad › VERI\*FACTU.
- **Subsanación (15)** con los datos congelados de la factura; si el error es del destinatario, pide rectificativa.
- **Modo heredado (16):** ya no genera registros; la migración pasa esas empresas a «pendiente».
- **Validación previa a la emisión:** número de serie, exenciones incoherentes, fecha de operación.
- **QR** al principio del documento, con zona en blanco y letra del cuerpo; **control de flujo** persistido; **duplicados** según su estado en la AEAT; **declaración responsable** con título y literales del art. 15.

### Modelos
- **303 (8, 9):** cuotas a compensar (casillas 110, 78, 87) con saldo inicial por ejercicio; devengo por fecha de operación cuando es anterior a la de expedición; bases deducibles sin prorratear; rectificativas en 14-15 y 25-26; volumen de operaciones en el último periodo.
- **Periodos en hora local (7):** los límites de periodo son la medianoche peninsular (o canaria).
- **Foto de lo presentado:** al marcar un modelo como presentado se guardan sus importes y se avisa si el cálculo cambia después.
- **390 (10):** resumen anual propio, sin numeración oficial (no se pudo contrastar).
- **347 (18):** desglose trimestral, cobros en metálico de más de 6.000 € y pantalla con los terceros. **349:** entrega sin artículo = clave E.
- **Plazo de domiciliación** junto al de presentación.

### Compras y contabilidad
- **Rectificativas y abonos de proveedor (13)**, con fecha de operación, recargo soportado, marca de bien de inversión, DUA y ticket sin NIF; libro registro de recibidas con una fila por factura y tipo.
- **Inmovilizado (12):** fichas de bienes, tabla de coeficientes fiscales, cuadro de amortización, dotaciones automáticas, baja o venta y libro de bienes de inversión. El cierre comprueba que no queden amortizaciones sin contabilizar.

### Lo que no se ha podido comprobar
Todo lo anterior compila, pasa el lint y los tests unitarios, y la migración `0067` se ha probado sobre una base con datos antiguos. **No se ha abierto ninguna pantalla ni ejecutado contra la base de datos real ni contra la AEAT.** Antes de confiar en ello: probar cada flujo en la aplicación y VERI\*FACTU en el entorno de pruebas de la AEAT con un certificado real.

## 3. Sigue pendiente

1. **Criterio de caja en el 303** (devengo al cobro y deducción al pago).
2. **Rectificación de deducciones en las casillas 40-41** del 303 (los abonos de proveedor restan hoy en 28-39) y regularización de prorrata y de bienes de inversión.
3. **Compensación de un abono de proveedor** contra su factura en pagos y tesorería (hoy queda como saldo a favor en la 400/410).
4. **Numeración oficial del 390**; claves restantes del 347 y 349; comprobación VIES al emitir.
5. **Factura simplificada como tipo de documento propio** y canje por factura completa (F3).
6. **Ejercicio contable en hora local** (un ticket de las 00:30 del 1 de enero se contabiliza en el ejercicio anterior).
7. **No existen:** nóminas y modelos 190, 180, 123 y 193; Impuesto sobre Sociedades (200 y 202); SII; libros registro en el formato de la AEAT; ficheros de presentación; factura electrónica (Facturae, FACe y la obligación del RD 238/2026).
8. **VERI\*FACTU:** casilla de «certificado de sello» y datos del certificado en la pantalla de configuración; versión de la declaración ligada al despliegue, histórico y PDF; caducidad del certificado del sistema.
9. **Inmovilizado:** IVA en la venta de un bien, centros de coste, botón «crear bien» desde la factura de compra.
10. **Cuentas anuales:** solo el modelo abreviado; faltan el normal, el de PYMES, el estado de cambios en el patrimonio neto, la memoria y la legalización de libros.
11. **Validación del NIF por dígito de control** en altas: se decidió en su día no bloquear (commit 91a893d) y se ha respetado.
12. Abonos a clientes en la 700 en negativo en lugar de 708/709; aviso de plazos de pago de más de 60 días; menciones de bienes usados y agencias de viajes.
