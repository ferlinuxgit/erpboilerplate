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

## 2. Pendiente, por orden de riesgo

### 2.1 Crítico

1. **VERI\*FACTU: pruebas y producción comparten cadena y registros.** El entorno es una variable global que por defecto vale «pruebas». Si en producción falta o está mal, las facturas reales van al entorno de pruebas de la AEAT, figuran como aceptadas y llevan QR, pero Hacienda no recibe nada. Hay que guardar el entorno en cada registro y en la cadena, y exigirlo de forma explícita. **Comprobar hoy el valor de `VERIFACTU_ENVIRONMENT` en producción.**
2. **VERI\*FACTU: facturas sin registro.** Con una «fecha de inicio» configurada, un borrador fechado antes se emite hoy sin registro, sin QR y fuera de la cadena. La decisión debe tomarse por la fecha real de emisión.
3. **Se emite sin comprobar los datos obligatorios** de emisor y destinatario (nombre, NIF y domicilio; art. 6.1 del RD 1619/2012).
4. **Factura simplificada.** No es un tipo de documento: se decide al emitir según haya NIF. El límite de 400 €/3.000 € solo se aplica al cliente genérico del TPV. No existe el canje por factura completa (F3).
5. **Recargo de equivalencia no garantizado.** Solo se propone en el formulario; no lo aplican el paso de presupuesto, pedido o albarán a factura ni el TPV.
6. **Falta la mención «régimen especial del criterio de caja»** en la factura, y el 303 de una empresa en ese régimen se calcula por fecha de factura (solo hay un aviso).
7. **Fechas en UTC y no en hora peninsular.** Un ticket emitido entre las 00:00 y las 02:00 puede caer en el periodo anterior y llevar una fecha impresa distinta de la registrada en VERI\*FACTU. Afecta a hostelería y al cambio de año.

### 2.2 Alto

8. **303 sin compensación de periodos anteriores** (casillas 110, 78 y 87): si un trimestre sale a compensar, el siguiente muestra de más. Tampoco tiene las casillas de volumen de operaciones del último periodo.
9. **303 por fecha de expedición y no de devengo.** El campo «fecha de operación» existe pero no se usa. Corregirlo exige decidir qué pasa con los periodos ya presentados y con la conciliación contable.
10. **390 sin casillas propias**: reutiliza el cálculo del 303.
11. **No existen**: nóminas, modelos 190, 180, 123 y 193; Impuesto sobre Sociedades (200 y 202); SII; libros registro en el formato de la AEAT; libro de bienes de inversión; ficheros de presentación de ningún modelo.
12. **No hay inmovilizado ni amortizaciones automáticas**, ni periodificaciones. El cierre solo lo recuerda.
13. **No se pueden registrar rectificativas ni abonos de proveedor** (se exige cantidad positiva).
14. **Certificado VERI\*FACTU**: no se controla caducidad, titular ni tipo; no se usa el punto de acceso de certificados de sello; no hay aviso general de registros sin remitir.
15. **Subsanación** con los datos actuales del cliente en vez de los congelados en la factura; las altas rechazadas por causa no corregible quedan sin salida.
16. **Modo NO VERI\*FACTU heredado**: sigue generando registros sin firma ni registro de eventos conforme. Hay que comprobar si alguna empresa lo tiene y eliminarlo.
17. **Factura electrónica**: no hay Facturae ni envío a FACe (obligatorio para facturar a Administraciones) ni formato para la obligación entre empresas del RD 238/2026.
18. **347 y 349 incompletos**: sin desglose trimestral, cobros en metálico, arrendamientos ni todas las claves; el 349 no comprueba VIES.
19. **El NIF solo se valida por formato** en altas y ediciones, no por dígito de control.

### 2.3 Medio y bajo

- Series: prefijo y formato editables con facturas emitidas; sin reinicio anual; caracteres que la AEAT rechaza.
- No se controla que la fecha de una factura no sea anterior a la última emitida de su serie.
- Los PDF emitidos no entran en la exportación del espacio ni en la purga, y se sobrescriben al cambiar formas de pago.
- QR: debe ir al principio del documento, con más margen y letra no menor que el cuerpo.
- Declaración responsable: título y literales exactos, versión ligada al despliegue, histórico y PDF.
- Control de flujo de envíos (tiempo de espera de la AEAT) solo en memoria; duplicados dados por aceptados sin leer su estado.
- Prorrata sin regularización anual; bases deducibles mostradas ya prorrateadas.
- No se guarda foto de lo presentado: la vista de un modelo presentado se recalcula.
- Sin aviso de cobros en efectivo de 1.000 € o más ni de plazos de pago superiores a 60 días.
- Abonos a clientes contabilizados en negativo sobre la 700 en lugar de la 708/709.
- Solo el modelo abreviado de cuentas anuales; faltan el normal, el de PYMES, el estado de cambios en el patrimonio neto y la memoria.
- Libros oficiales (diario, inventarios y cuentas anuales) sin legalización ni formato del Registro Mercantil.

---

## 3. Orden de trabajo propuesto

1. Entorno de VERI\*FACTU por registro y empresa, y registro obligatorio según la fecha real de emisión (puntos 1 y 2).
2. Validación previa a la emisión: datos obligatorios, simplificada con su límite, recargo de equivalencia, menciones de régimen (puntos 3 a 6).
3. Fechas en la zona horaria de la empresa (punto 7).
4. 303 completo: compensaciones, devengo, último periodo; 390 con sus casillas (puntos 8 a 10).
5. Certificado, avisos y subsanación de VERI\*FACTU (puntos 14 a 16).
6. Rectificativas de proveedor, inmovilizado y amortizaciones (puntos 12 y 13).
7. Libros registro en formato AEAT y ficheros de presentación.
8. Factura electrónica (Facturae y FACe primero).
9. Sociedades, nóminas y resúmenes anuales de retenciones, si entran en el alcance del producto.

Antes de dar VERI\*FACTU por cumplido hay que probarlo en el entorno de pruebas de la AEAT con un certificado real y validar contra el XSD todos los tipos de factura.
