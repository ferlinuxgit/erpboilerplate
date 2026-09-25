# Análisis completo del módulo de contabilidad (2026-09-26)

**Motivo.** El contable externo de la empresa dice que «cómo se ven las cuentas es muy pobre y falta información».

**Método.**
1. Auditoría del código del módulo, hecha desde el punto de vista de un contable español.
2. Consultas de solo lectura sobre los datos reales de la base de datos de producción.
3. Estudio de cómo resuelven lo mismo los programas de referencia en España (a3ECO/a3innuva, Sage 50/Despachos Connected, ContaSol, Holded, Odoo con la localización española) y en el ámbito internacional (Xero, QuickBooks).

**Conclusión.** El contable tiene razón. La contabilidad actual cuadra y cumple lo mínimo (partida doble garantizada, cierre y apertura, bloqueo de periodos), pero **no sirve para trabajar como trabaja un contable**:
- no hay subcuentas por cliente ni por proveedor;
- los apuntes no dicen qué son ni de quién son;
- el mayor es pobre;
- no hay informes oficiales del PGC.

El origen no está en la pantalla, sino en el **modelo de datos**. Por eso la mejora tiene que empezar por ahí.

---

## 1. Diagnóstico con datos reales

Consultas de solo lectura sobre la base de producción (2 empresas):

| Qué se ve | Dato real | Por qué molesta a un contable |
|---|---|---|
| Todos los clientes en una sola cuenta | Las facturas van a `430000` o a `4300`; no existe ninguna `430xxxxx` por cliente | No puede ver el saldo de un cliente, sacar su extracto, puntear sus cobros ni cuadrar la cartera |
| Cuentas de distinto nivel mezcladas | Apuntes en `477` y en `477000`, en `700` y en `700000`, en `572` y en `572000`, en `4300` y en `430000` | El mismo concepto repartido en varias cuentas: sumas y saldos incoherentes |
| Plan contable sin longitud fija | Cuentas de 1, 2, 3, 4 y 6 dígitos; ninguna subcuenta de 8 o más | En España se trabaja con subcuentas de longitud fija (8–12 dígitos) |
| Apuntes sin información | `journal_line` solo guarda cuenta, debe y haber; no hay concepto, tercero, documento ni vencimiento | El mayor no dice de quién es cada apunte ni qué documento lo origina |
| Conceptos pobres | «Factura FA000049», «Cobro factura …»; en los pagos a cuenta aparece un identificador interno del proveedor | Sin nombre del cliente o proveedor, el extracto es ilegible |
| Numeración de asientos | Global (AS000001…), no se reinicia por ejercicio y no sigue el orden de fechas (AS000014 es posterior a AS000054) | El Libro Diario oficial debe ir numerado por ejercicio y en orden cronológico |
| Compras | Todas a `410` (acreedores por servicios), también las mercaderías; la `400` no se usa | Clasificación incorrecta en el balance |
| Ventas | Todas a `700`; la cuenta de ventas del artículo existe pero no se usa | No se separan ventas de mercaderías (700) y prestación de servicios (705) |

## 2. Diagnóstico del código

### Críticos

1. **No hay subcuentas por tercero.**
   - `auto-post.ts:70-71` fija una cuenta única de clientes y otra de proveedores.
   - El campo «cuenta del proveedor» existe en la ficha (`partner.defaultAccountId`), pero el código que genera los asientos **nunca lo lee**.
2. **Los apuntes no tienen concepto ni tercero** (`schema.ts:965-975`).
3. **Los saldos no suben por la jerarquía.**
   - Las cuentas de grupo (4, 43, 430…) muestran siempre 0 (`service.ts:24-58`).
   - Los saldos del plan contable no se filtran por ejercicio.
4. **El balance y la PyG no son los modelos del PGC.**
   - Son listas de cuentas agrupadas por tipo o por el signo del saldo.
   - No hay epígrafes (A.I.1, B.III…), separación corriente/no corriente ni márgenes de la PyG.
   - No hay columna del ejercicio anterior ni exportación.
5. **Compras siempre a 410 y ventas siempre a 700** (`auto-post.ts:71`, `:410-422`).

### Altos

6. **Mayor limitado.**
   - Una sola cuenta; no admite un rango ni un grupo.
   - Sin filtro de fechas en pantalla y ordenado del más reciente al más antiguo (al revés de lo habitual).
   - Sin contrapartida, concepto de línea, punteo ni exportación.
7. **Diario solo con cabeceras.**
   - No se pueden ver los apuntes ni buscar por cuenta.
   - Existen 5 diarios (ventas, compras, bancos, general, cierre), pero todo se registra en uno indeterminado.
8. **La ficha del asiento no enlaza con cobros, pagos ni cierres.**
9. **No hay inmovilizado, amortizaciones, periodificaciones ni provisiones.** La lista de cierre solo recuerda que hay que registrar la amortización a mano.
10. **Plan contable sin control.**
    - Se puede cambiar el código de una cuenta que ya tiene movimientos.
    - Al crear una cuenta no se enlaza con su cuenta padre.
    - Lista plana de 16 filas por página, sin árbol ni columnas de debe y haber.

### Medios y bajos

11. **Sumas y saldos solo a nivel de subcuenta**: sin elegir nivel, sin subtotales por grupo y sin comparativa.
12. **Contraasiento siempre con fecha de hoy**; no se puede duplicar un asiento.
13. **Entrada de asientos lenta.**
    - Cada línea es una tarjeta.
    - No hay concepto por línea ni plantillas.
    - No existe el atajo del punto (43.1 → 43000001).
14. **Sin analítica ni centros de coste, sin presupuestos y sin multidivisa.**
15. **Sin exportación a formatos de despacho** (A3 SUENLACE, Sage/ContaPlus XDiario) **ni legalización de libros.**

### Lo que ya está bien y se conserva

- Partida doble garantizada en la base de datos.
- Contraasientos en lugar de borrados.
- Bloqueo de periodos.
- Cierre en tres pasos (regularización, cierre y apertura) con lista de comprobaciones.
- Reapertura auditada.
- Cuadre entre las cuentas de IVA y retenciones y los modelos 303/111/115.
- Paquete para el gestor en XLSX.
- Conciliación bancaria con la cuenta 555 y la Norma 43.

---

## 3. Cómo lo hacen los mejores programas

### 3.1 Comparativa

| Función | a3ECO / a3innuva | Sage 50 / Despachos | ContaSol | Holded | Odoo (l10n_es) | **Nuestro ERP hoy** |
|---|---|---|---|---|---|---|
| Longitud de subcuenta configurable | Sí | 8, ampliable | Sí | 8–12 | Código libre | **No** (mezcla de 1–6 dígitos) |
| Atajo del punto (43.1 → 43000001) | Sí | Sí (herencia ContaPlus) | Sí | No | No | **No** |
| Subcuenta automática por cliente o proveedor | Sí | Sí | Sí | Sí (4300…/4000…) | Por tercero | **No** |
| Extracto con saldo anterior, contrapartida y saldo acumulado | Sí | Sí | Sí | Básico | Sí | **Parcial** |
| Punteo y casación | Sí | Punteo (sin punteo masivo) | Punteo automático, hasta fecha y casación | No | Partidas abiertas | **No** (solo bancos) |
| Asientos predefinidos | Sí, con IVA | Sí | Sí, encadenables y con IVA automático | Limitado | Modelos | **No** |
| Apertura, regularización y cierre | Sí | Sí | Sí | Sí | Sí (OCA) | **Sí** |
| Balance y PyG oficiales (normal, abreviado, PYMES) con año anterior | Sí | Sí | Sí | Sí | Sí (plantillas MIS de la OCA) | **No** |
| Sumas y saldos por niveles | Sí | Sí | Sí | 4–12 dígitos | Sí | **No** |
| Legalización de libros | Legalia2 | Sí | Sí | ZIP de libros | No | **No** |
| Inmovilizado y amortización automática | Sí | Sí | Sí | Sí | Sí | **No** |
| Analítica y presupuestos | Sí | Sí | Sí | Básica | Sí | **No** |
| Exportación a despachos | — | XDiario / CSV | Enlace | Exportación | — | **Solo XLSX** |

Fuentes: documentación oficial y centros de ayuda de cada programa (a3Responde, Sage KB y Community, ayuda de TeamSystem para ContaSol, help.holded.com, documentación de Odoo y repositorio OCA l10n-spain, Xero Central, Intuit). Las URL concretas están en la investigación de origen.

### 3.2 Patrones de referencia que conviene copiar

1. **Extracto de subcuenta (patrón a3, Sage y ContaSol).**
   - Primera fila: saldo anterior.
   - Columnas: Fecha · Asiento · Concepto · Documento · Contrapartida (código **y nombre**) · Debe · Haber · Saldo · P (punteo).
   - Pie: saldo anterior, total del periodo y saldo acumulado.
   - Botones para ir a la subcuenta anterior o siguiente, abrir el asiento y el documento con un clic, y exportar a PDF o Excel.
2. **Punteo como en ContaSol.**
   - Marcar línea a línea con la barra espaciadora.
   - Punteo automático por importe y «puntear hasta fecha».
   - **Casación**: ligar cargos y abonos de una misma factura para obtener el saldo vivo.
   - Informe de partidas pendientes.
3. **Entrada de asientos al estilo ContaPlus y Sage 50.**
   - Todo con teclado: Intro avanza al campo siguiente.
   - La fecha y el concepto se copian de la línea anterior y se propone el importe que cuadra el asiento.
   - Atajo del punto y asientos predefinidos con base, IVA y retención.
   - Al usar cuentas de los grupos 6 o 7 junto a una cuenta 4xx, se propone el registro de IVA.
4. **Informes como en Odoo.**
   - Cada línea se despliega: grupo → cuenta → apuntes → documento.
   - Columna del año anterior y exportación a PDF y XLSX.
   - Balance y PyG según los modelos del Registro Mercantil (normal, abreviado, PYMES).
5. **Ficha de cuenta (Holded y a3innuva).**
   - Cabecera con código, nombre, NIF si es de un tercero y cuenta padre.
   - Saldo, debe y haber del ejercicio.
   - Gráfico de saldo mensual comparado con el año anterior.
   - Extracto integrado debajo.
6. **Legalización (Holded y a3).** Asistente que genera los libros del ejercicio (diario, mayor, sumas y saldos, balance y PyG) en ZIP para Legalia2, con estados borrador y presentado.
7. **Intercambio con despachos.** Exportación en **SUENLACE.DAT** (A3) y **XDiario** (Sage 50, ContaPlus, Aplifisa), además de Excel.

### 3.3 Qué espera como mínimo un contable español

1. PGC con **longitud de subcuenta fija** y **atajo del punto**.
2. **Subcuenta automática por tercero** (430/400/410 + número) con NIF.
3. **Extracto** completo con contrapartida y saldo acumulado, navegable.
4. **Punteo y casación.**
5. **Entrada rápida** con teclado y asientos predefinidos.
6. **Diario** con apuntes, búsqueda y renumeración por fecha.
7. Cierre y apertura automáticos *(ya lo tenemos)*.
8. **Sumas y saldos por niveles** y **balance y PyG oficiales con el año anterior**, pudiendo bajar de cada cifra a sus apuntes.
9. Todo **exportable a PDF y Excel**, y **legalización** de libros.
10. **Inmovilizado** con amortización automática.
11. Conciliación bancaria con Norma 43 *(ya la tenemos)*.
12. Libros de IVA y modelos cuadrados con la contabilidad *(ya lo tenemos)*.
13. **Acceso para el asesor** *(ya lo tenemos)* y **exportación en formatos de despacho**.
14. **Pantallas densas**, importes alineados a la derecha en formato español y negativos bien señalados.

---

## 4. Rediseño propuesto

### 4.1 Modelo de datos (la base de todo)

| Cambio | Detalle |
|---|---|
| **Longitud de subcuenta** | Ajuste por empresa (8 por defecto, admite de 8 a 12). Todas las cuentas donde se apunta son subcuentas de esa longitud. Las cuentas de 1 a 4 dígitos del PGC quedan como cuentas de agrupación (sin apuntes). |
| **Subcuentas por tercero** | Al dar de alta un cliente se crea `430` + número (p. ej. `43000001`); al dar de alta un proveedor, `400` (mercaderías) o `410` (servicios), a elegir en su ficha. El campo `partner.defaultAccountId` pasa a ser el que manda. |
| **Apuntes completos** | `journal_line` añade concepto, tercero (`partnerId`), documento (tipo y número), vencimiento, **punteo** (`reconciledAt` y marca), **casación** (`matchingId`), centro de coste y orden de línea. |
| **Asientos** | Diario según el origen (ventas, compras, bancos, general, cierre), **numeración por ejercicio** y posibilidad de renumerar por fecha antes del cierre. |
| **Plan contable** | Enlace con la cuenta padre (`parentCode`) siempre, naturaleza del saldo (deudora o acreedora), bloqueo de cuenta y prohibición de cambiar el código si tiene movimientos. |
| **Epígrafes del PGC** | Tabla de correspondencias cuenta → epígrafe para los modelos normal, abreviado y PYMES del balance y la PyG (p. ej. «A.II.2 ← 213, 214, (2813)»). |
| **Ventas** | Usar la cuenta de ventas de cada artículo (700/705…) y una cuenta por defecto según el tipo de negocio. |

**Migración de los datos existentes**:
- Crear la subcuenta de cada tercero.
- **Reclasificar** los apuntes de `4300`/`430000`/`410` a la subcuenta de su tercero, usando el documento de origen de cada asiento.
- Unificar los apuntes hechos en cuentas de 3–4 dígitos (`477`, `700`, `572`…) en su subcuenta (`47700000`…).
- Rellenar concepto, tercero y documento de los apuntes antiguos a partir de su factura o cobro.
- Renumerar por ejercicio.

Todo ello con copia de seguridad previa y ensayo en una transacción, como en las migraciones anteriores.

### 4.2 Pantallas

1. **Plan contable en árbol.**
   - Grupos desplegables con saldo agregado del ejercicio, debe, haber y saldo.
   - Búsqueda por código, nombre, NIF o alias, con el atajo del punto.
   - Filtros por cuentas con movimiento, por terceros y por cuentas bloqueadas.
2. **Ficha de cuenta.**
   - Datos de la cuenta y, si es de un tercero, su ficha.
   - Saldo inicial, debe, haber y saldo del ejercicio.
   - Gráfico mensual comparado con el año anterior.
   - Extracto integrado.
3. **Extracto / mayor.**
   - Por cuenta, rango o grupo, y por fechas.
   - Columnas de la sección 3.2 más columnas configurables.
   - Punteo con barra espaciadora, automático y hasta fecha; casación; informe de pendientes.
   - Exportación a PDF y Excel.
   - Botones para ir a la subcuenta anterior o siguiente.
4. **Diario.**
   - Asientos con sus apuntes desplegados.
   - Búsqueda por cuenta, importe, concepto y documento; filtros por diario y origen.
   - Duplicar un asiento y hacer un contraasiento con la fecha que se elija.
   - Adjuntos.
5. **Entrada rápida de asientos.**
   - Tabla densa manejada con teclado (Intro para avanzar y atajo del punto).
   - Concepto por línea, que se copia a la siguiente.
   - Cuadre propuesto y bloqueo si el asiento no cuadra.
   - **Asientos predefinidos** con variables (base, IVA, retención) y conceptos tipo.
6. **Sumas y saldos** por nivel (1, 2, 3, 4 o subcuenta) y periodo, con columna del año anterior y exportación.
7. **Balance y PyG oficiales** (normal, abreviado, PYMES).
   - Epígrafes con el año anterior; cada cifra se despliega hasta sus apuntes.
   - Márgenes de la PyG: resultado de explotación, financiero, antes de impuestos y del ejercicio.
   - Estado de cambios en el patrimonio neto y ratios básicos (liquidez, endeudamiento, rentabilidad).
   - Exportación a PDF y Excel.
8. **Inmovilizado.**
   - Fichas de bienes con cuenta, fecha, valor y método (lineal según las tablas fiscales).
   - Cuadro de amortización.
   - **Asiento automático mensual o anual** (68x contra 281x).
   - Baja del bien con su resultado.
9. **Periodificaciones y provisiones.** Asistentes para gastos e ingresos anticipados (480/485) y provisiones.
10. **Analítica.** Centros de coste o proyectos en los apuntes e informe de resultados por centro; presupuestos con desviaciones.
11. **Libros oficiales y legalización.** Libro Diario y libro de Inventarios y Cuentas Anuales, más ZIP para Legalia2, con estados borrador y presentado.
12. **Exportación a despachos** en SUENLACE (A3), XDiario (Sage/ContaPlus) y Excel, en el paquete para el gestor.

### 4.3 Automatismos

- **Conceptos automáticos informativos**, por ejemplo:
  - «Fra. FA-2026/000049 · Cliente Pérez S.L.»
  - «Cobro fra. FA-2026/000049 · Pérez S.L.»
  - «Pago a cuenta · Proveedor X»
- **Cada apunte con su tercero, su documento y su vencimiento**, lo que permite cuadrar la cartera de cobros y pagos con las cuentas 430 y 400.
- **Punteo automático**: el cobro de una factura puntea sus dos apuntes en la subcuenta del cliente, así el saldo vivo sale solo.

---

## 5. Plan por fases

| Fase | Contenido | Resultado visible para el contable |
|---|---|---|
| **1. Datos** (base) | Longitud de subcuenta, subcuentas por tercero, apuntes con concepto, tercero, documento y vencimiento, diarios por origen, numeración por ejercicio, uso de la cuenta del proveedor y del artículo, **migración y reclasificación de lo existente** | Cada cliente y proveedor tiene su cuenta; los apuntes dicen de quién son y qué son |
| **2. Consultas** | Plan contable en árbol con saldos agregados, ficha de cuenta, extracto completo con contrapartida y exportación, diario con apuntes y búsqueda | «Las cuentas se ven como en A3 o Sage» |
| **3. Punteo y entrada** | Punteo y casación, informe de pendientes, entrada rápida con teclado, atajo del punto, asientos predefinidos, duplicar y contraasiento con fecha | Trabajo diario ágil |
| **4. Informes oficiales** | Mapeo a epígrafes del PGC, balance y PyG normal/abreviado/PYMES con año anterior y detalle por cifra, sumas y saldos por niveles, estado de cambios en el patrimonio neto, ratios, PDF y Excel | Cuentas anuales listas para revisar |
| **5. Cierre avanzado** | Inmovilizado y amortizaciones automáticas, periodificaciones, provisiones | Cierre sin asientos manuales repetitivos |
| **6. Despacho y legalización** | Libros oficiales, ZIP de legalización, exportación SUENLACE y XDiario, analítica y presupuestos | Integración directa con el despacho del contable |

**Orden recomendado:** 1 → 2 → 3 → 4, que es lo que pide el contable; después 5 y 6. La fase 1 es imprescindible: sin subcuentas por tercero ni apuntes completos, ninguna pantalla puede mostrar la información que falta.

## 6. Decisiones que conviene confirmar con el contable

1. **Longitud de subcuenta:** 8 dígitos (lo habitual en pymes) o más.
2. **Proveedores:** 400 para mercaderías y 410 para servicios, según la ficha de cada proveedor (recomendado), o todos a 400.
3. **Histórico:** reclasificar los asientos existentes a las subcuentas por tercero (recomendado, reversible con la copia de seguridad) o aplicar las subcuentas solo a partir de ahora.
4. **Renumerar los asientos** del ejercicio abierto por orden de fecha.
5. **Modelo de cuentas anuales** de la empresa: PYMES, abreviado o normal.
6. **Formato de exportación** que usa su despacho: A3 (SUENLACE), Sage/ContaPlus (XDiario) u otro.
