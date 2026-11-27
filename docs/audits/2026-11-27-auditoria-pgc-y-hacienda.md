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

## 3. Tercera tanda (misma fecha): implementado

### Modelos de IVA
- **Criterio de caja** en el 303 y el 390: el repercutido se devenga con cada cobro y el soportado con cada pago, con el límite del 31 de diciembre del año siguiente; casillas 62-63 y 74-75. Las facturas recibidas marcadas «proveedor en criterio de caja» se deducen al pago en cualquier empresa.
- **Rectificación de deducciones** en las casillas 40-41 (abonos de proveedor).
- **Prorrata definitiva** calculada con las operaciones del año y **regularización** (casilla 44) cuando el usuario la confirma; regularización de **bienes de inversión** (casilla 43).
- **390 con numeración oficial** de las casillas que el programa calcula.
- **347:** marcas de inversión del sujeto pasivo, criterio de caja y posible arrendamiento. **349:** bases rectificada y declarada anteriormente, y aviso del umbral de 50.000 €.

### Retenciones, nóminas y Sociedades
- **Nóminas** (fichas de trabajador, nómina mensual introducida o importada, asiento, pago de nóminas y de seguros sociales).
- **111 completo** con sus casillas, **190**, **115** y **180** (con inmuebles arrendados), **123** y **193** (dividendos e intereses pagados), con cuadre entre trimestrales y anuales.
- **Impuesto sobre Sociedades:** liquidación asistida del 200 (ajustes, bases negativas, tipos vigentes por ejercicio), asiento del impuesto, pagos fraccionados del 202 y punto propio en el cierre. El 200 se presenta con Sociedades WEB: el programa prepara los importes.

### Presentación y libros
- **Ficheros para importar en la sede** de los modelos 303 (ejercicio 2026 en adelante), 111, 115, 130, 347 y 349, según sus diseños de registro.
- **Libros registro de IVA e IRPF en el formato electrónico de la AEAT** (expedidas, recibidas y bienes de inversión).
- **SII** para empresas acogidas: bandeja de salida, XML conforme a los esquemas 1.1, envío y seguimiento. Detrás de su ajuste.
- **Cuentas anuales** en modelo normal y PYMES además del abreviado, estado de cambios en el patrimonio neto, estado de ingresos y gastos reconocidos y memoria con sus cuadros.
- **Libros oficiales** (Diario, Inventarios y Cuentas Anuales, Mayor) con huellas para Legalia 2 y registro de la legalización. Exportación a A3 (SUENLACE) y ContaPlus (XDiario).
- **Ejercicio contable en hora local.**

### Facturación
- **Clase de documento** (completa, simplificada, simplificada cualificada) y **canje** de simplificada por factura completa (F3 en VERI\*FACTU).
- Rectificativas al alza, abonos en **708/709**, **menciones legales** por factura, comprobación **VIES** al emitir intracomunitarias, avisos de NIF y de plazo de pago.
- **Factura electrónica:** Facturae 3.2.2 con firma XAdES, códigos DIR3 del cliente, UBL (núcleo EN 16931) y registro de estados de la factura.

### Compras, inmovilizado y VERI\*FACTU
- **Compensación de abonos de proveedor** contra sus facturas en pagos, remesas y tesorería; cobro de devoluciones.
- **Inmovilizado:** venta enlazada a su factura, centros de coste, alta desde la factura de compra; la dotación ya no se bloquea por el 303 presentado.
- **VERI\*FACTU:** casilla de certificado de sello y datos del certificado en pantalla, aviso global de incidencias, caducidad del certificado del sistema, declaración responsable con versión del despliegue, histórico y PDF.

### Lo que no se ha podido comprobar
Como en las tandas anteriores: compila, pasa lint y tests unitarios (muchos contra Postgres en memoria) y las migraciones se han probado sobre datos antiguos. **No se ha abierto ninguna pantalla, ni se ha importado ningún fichero en la sede, ni se ha enviado nada a la AEAT, a FACe, a Legalia 2 ni a A3/ContaPlus.** Todo esto necesita una prueba real antes de usarse para presentar.

## 4. Sigue pendiente

1. **Probar en real** todo lo anterior: es lo más importante que queda.
2. **Fichero de presentación** del 390, del 303 en criterio de caja, y de 190, 180, 123 y 193.
3. **Numeración de casillas del modelo 200.**
4. **Factura electrónica:** envío a FACe por servicio web; perfil UBL de la AEAT (Orden HAC/1028/2026) y conexión con la solución pública, cuyas especificaciones técnicas no se pudieron contrastar.
5. **SII:** libros de bienes de inversión y de operaciones intracomunitarias, cobros y pagos de criterio de caja, y arranque del proceso de envío en el contenedor.
6. **Fichero de envío de Legalia 2** (no hay especificación pública de su sintaxis) y memoria en DOCX.
7. **Estado de flujos de efectivo** (obligatorio con balance normal) y renumeración de asientos por fecha.
8. **Nóminas:** otras deducciones, retribución en especie completa, claves restantes del 190; no es un programa de cálculo de nóminas.
9. Suplidos fuera de la base, descuento por pronto pago y anticipos en factura; datos registrales en el pie; corrección de una F3 errónea.
10. Listados por fecha y cierre que aún usan límites en UTC; aviso al tocar un ejercicio ya legalizado.
11. Festivos en los plazos (solo se trasladan fines de semana).
