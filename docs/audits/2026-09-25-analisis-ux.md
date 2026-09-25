# Análisis UX exhaustivo — ERP Suite (2026-09-25)

Alcance: la experiencia de uso completa, después de las fases 1–3 de mejoras (commit `86e2bf2`). El análisis se hizo en cuatro áreas:

1. primer uso y orientación;
2. ciclo comercial y facturación;
3. compras, gastos, inventario y tesorería;
4. contabilidad, fiscalidad y aspectos transversales (accesibilidad, diseño visual, móvil y lenguaje).

Método:
- **Recorridos cognitivos por tareas reales.** Se contaron pantallas, clics, campos y decisiones de cada tarea.
- **Evaluación heurística de Nielsen.**
- **Comprobaciones WCAG 2.2 AA.** El contraste se calculó a partir de los tokens de `globals.css` para los 8 temas.

Todos los hallazgos se verificaron en el código. Las referencias `fichero:línea` son relativas a `src/`.

Usuario objetivo: dueños de pymes y autónomos españoles sin formación contable, su gestor o asesor, y el personal administrativo que usa el ERP a diario.

---

## 1. Resumen ejecutivo

| Área | Nota | En una frase |
|---|---|---|
| Primer uso y orientación | **5/10** | Buena base técnica, pero el usuario nuevo no tiene un camino guiado. El asistente de configuración no se enlaza desde ningún sitio y la empresa se crea como "‹Nombre› Company", sin NIF. |
| Ciclo comercial | **6,5/10** | Buen editor de líneas y un ciclo de vida de factura bien explicado, pero con riesgos de error irreversible (Enter emite) y sin envío por email. |
| Compras, gastos, stock y tesorería | **6/10** | El OCR por lotes es robusto técnicamente, pero se revisa "a ciegas" y la conciliación no cubre casos reales (comisiones, pagos múltiples). |
| Contabilidad y fiscalidad | **6/10** | Ayudas fiscales en lenguaje llano y buenos controles previos a presentar, pero los estados financieros no se filtran por ejercicio y el paquete para el gestor está incompleto. |
| Transversal (accesibilidad y visual) | **7/10** | Teclado, diálogos y foco excelentes. Fallan el contraste de las etiquetas de estado en los temas claros, los enlaces en tres temas oscuros y hay demasiado texto de 9–10 px. |

**Diagnóstico general:**
- El producto ya es sólido para un usuario experto que sabe dónde está cada cosa.
- Todavía no es "fácil y simple" para quien empieza. Los tres grandes huecos:
  1. un **primer uso sin guía**;
  2. varios **errores irreversibles demasiado fáciles de cometer** (emitir, contabilizar en bloque, activar VERI\*FACTU);
  3. **tareas del día a día que exigen conocimiento contable** (elegir entre unas 138 cuentas del PGC, conciliar manualmente, preparar el paquete para el gestor).

---

## 2. Fortalezas

**Arquitectura de interacción**
- **Navegación por teclado de primer nivel.**
  - F1 abre la ayuda y F6 cambia de zona.
  - `G`+código abre un módulo, Alt+Mayús+1–4 salta a las zonas principales y Ctrl K abre la paleta de comandos.
  - En los listados funcionan flechas, Inicio/Fin, AvPág/RePág y Espacio para seleccionar; en las líneas de documento, Alt+L y Alt+N.
  - Hay enlace de salto al contenido y el foco queda atrapado en el menú móvil y en los diálogos (`components/layout/app-shell.tsx:101-138`, `components/ui/dialog.tsx:41-108`).
- **Paleta de comandos.**
  - Busca sin acentos, recuerda los elementos recientes y ofrece acciones redactadas como tareas ("Registrar gasto", "Pagar a un proveedor").
  - Es un combobox ARIA correcto (`components/layout/global-command-palette.tsx`).
- **Primitivas de formulario coherentes.**
  - `AccessibleField` conecta automáticamente el id, `aria-invalid`, `aria-required` y `aria-describedby`.
  - `readApiError` traduce los códigos HTTP a mensajes en español.
  - `MoneyInput`, `PercentInput` y `QuantityInput` aceptan "1.234,56".
  - El guardián de cambios sin guardar es global (`components/ui/form.tsx`, `components/ui/number-input.tsx`, `components/layout/form-navigation-guard.tsx`).
- **Listados potentes y uniformes.** Todos los listados tienen:
  - paginación en servidor, orden, filtros y rango de fechas;
  - totales, cabecera fija, vistas guardadas y tarjetas en móvil;
  - exportación CSV preparada para Excel en español (`components/ui/resource-list.tsx`).

**Dominio**
- **Ciclo de vida de la factura bien explicado.**
  - Antes de emitir hay un diálogo que avisa de la irreversibilidad, con el foco en "Cancelar" (`components/invoices/invoice-lifecycle-actions.tsx:56-72`).
  - El formulario muestra el número que se asignará y avisa de que "los borradores no consumen número" (`components/create-invoice-form.tsx:360-365`).
- **Rectificativas guiadas en 3 pasos**, con vista previa y protección contra rectificar de más (`components/invoices/credit-note-form.tsx`).
- **Tratamiento de IVA automático** según el país del cliente, con vista previa de la mención legal y validación en el servidor (`server/invoices/lifecycle.ts:69-73`, `server/invoices/service.ts:308-326`).
- **OCR por lotes robusto.**
  - Sube los archivos de 3 en 3 y un error no detiene el lote.
  - Muestra un contador de estados, permite reintentar y el registro es idempotente.
  - Detecta duplicados en tres capas (archivo, número de proveedor y fecha con importe) (`components/expenses/expense-batch-upload.tsx`).
- **Fiscalidad en lenguaje llano.**
  - La tarjeta "Qué tengo que presentar este trimestre" indica el plazo, los días que quedan y por qué aplica cada modelo.
  - Hay una lista de verificaciones previas y un cuadre con las cuentas 477/472/4751/473 (`components/fiscal/fiscal-obligations-card.tsx`, `app/fiscal/[id]/page.tsx:138-184`).
- **Cierre y reapertura del ejercicio cuidadosos**: se explican las consecuencias y la reapertura pide un motivo que queda auditado.
- **Gráficos accesibles**: tabla oculta para lectores de pantalla, navegación con flechas y una región viva que anuncia los valores (`components/charts/time-series-chart.tsx`).

---

## 3. Debilidades priorizadas

### 3.1 Críticas (error irreversible, dato incorrecto o tarea imposible)

| # | Problema | Evidencia | Impacto |
|---|---|---|---|
| C1 | **Enter en el formulario de nueva factura la emite**: numera, contabiliza y es irreversible, sin la confirmación que sí existe en el detalle. Pasa lo mismo en la rectificativa. | `components/create-invoice-form.tsx:270,308`; `components/invoices/credit-note-form.tsx:166-169` | Facturas emitidas por accidente, que solo se corrigen con una rectificativa. |
| C2 | **Convertir un albarán en factura emite sin pasar por el flujo de emisión**: sin validar el tratamiento de IVA, sin registro VERI\*FACTU, sin vencimiento ni formas de pago, y sin confirmación. | `server/sales/service.ts:434-458` (`issuedAt`, `dueDate: null`); `components/sales/sales-transition-button.tsx` | Además de un problema de UX, es un **riesgo de cumplimiento**: facturas sin registro VERI\*FACTU. |
| C3 | **El asistente de configuración no se enlaza desde ningún sitio.** No hay enlace ni redirección a `/onboarding`. | búsqueda sin resultados en `src/` | El usuario nuevo nunca configura la empresa. |
| C4 | **El asistente descarta lo que se escribe**: la serie de numeración y el email de invitación se ignoran, aunque se muestra "Onboarding completado". | `app/api/onboarding/seed/route.ts:11-14` | Engaño involuntario: el usuario cree que ha invitado a su gestor y no es así. |
| C5 | **Una persona invitada que no tiene cuenta pierde la invitación** al registrarse, porque la ruta de vuelta no se conserva en el registro. | `components/auth-form.tsx:72,96`; `app/auth/register/page.tsx` | Incorporar al gestor o al equipo resulta frustrante. |
| C6 | **"Registrar preparados" del OCR contabiliza en bloque**, sin confirmar, facturas que caen por defecto en la cuenta 600 "Compras de mercaderías" con el IVA deducible al 100 %. | `server/ocr/expense-ocr.ts:206,230-231`; `components/expenses/expense-batch-upload.tsx:213,391-394` | Gasolina, alquiler o teléfono contabilizados como mercaderías: la contabilidad y el IVA quedan mal. |
| C7 | **En la revisión del OCR no se ve el documento.** | `components/expenses/expense-batch-upload.tsx:476-555` | La revisión se hace a ciegas y se cuelan errores. |
| C8 | **La cola de OCR se pierde al salir de la página**: solo vive en el estado de React, no se puede listar después, no hay aviso al salir y el sondeo se detiene sin avisar pasados unos 3,5 minutos. | `components/expenses/expense-batch-upload.tsx:131,225-228` | Una sesión de 10 facturas perdida. |
| C9 | **La conciliación solo cubre el caso "1 movimiento ↔ 1 cobro o pago existente del mismo importe".** No resuelve comisiones, cuotas de autónomos, pagos de varias facturas a la vez ni movimientos contra una factura pendiente. | `server/treasury/reconciliation.ts:30,69-92` | Esos movimientos se quedan para siempre en la cuenta 555. |
| C10 | **Los estados financieros no se filtran por ejercicio**: suman todos los apuntes de la historia de la empresa. | `server/accounting/service.ts:37-44`; `app/accounting/reports/page.tsx` | El "resultado" mezcla ejercicios, o da 0 después del cierre. |

### 3.2 Altas

**Primer uso**
- La empresa y el espacio de trabajo se crean como "‹Nombre› Company" y "‹Nombre› Tenant", en inglés. Ese nombre aparece en el asunto del email de invitación y el espacio de trabajo no se puede renombrar (`lib/tenant.ts:233,261`).
- No hay recuperación de contraseña. Un usuario sin verificar se queda en un 403 sin opción de "reenviar" (`app/api/auth/login/route.ts:77-78`).
- Tras registrarse hay que volver a iniciar sesión, aunque el servidor ya creó la sesión (`components/auth-form.tsx:96`).
- El panel no avisa de que la empresa no está lista para facturar (falta NIF o dirección). Los plazos fiscales solo aparecen cuando ya hay datos financieros (`lib/dashboard-cockpit.ts`, `app/dashboard/page.tsx:81,109`).
- No existe un rol de gestor o asesor, no hay lista de invitaciones pendientes y, si el email no está configurado, no se puede copiar el enlace de invitación (`lib/rbac.ts:2`, `app/settings/team/page.tsx`).

**Ventas**
- Los presupuestos y pedidos proponen por defecto el **IVA del 4 %**: la consulta toma el impuesto de menor tipo sin filtrar (`app/sales/new/page.tsx:18`, `app/sales/orders/new/page.tsx:26`).
- Las menciones legales de las operaciones intracomunitarias solo cubren **bienes**, no servicios B2B. No hay comprobación en VIES y el país es un campo de texto libre (`server/invoices/lifecycle.ts:47,56`).
- **Nunca se calcula el vencimiento.** Los días de pago del cliente no se aplican, así que el filtro "Solo vencidas" no encuentra nada (`components/create-invoice-form.tsx:97`, `app/invoices/page.tsx:58`).
- En la ficha del cliente, el importe "Pendiente" incluye borradores e ignora cobros parciales y rectificativas (`app/customers/[id]/page.tsx:45-46`).
- **No se puede enviar la factura por email** ni hacer recordatorios de cobro.

**Compras y tesorería**
- La previsión de tesorería no parte del saldo actual, no tiene horizonte ni saldo acumulado, y cuenta los borradores (`app/treasury/forecast/page.tsx`).
- Los días de pago del proveedor tampoco se aplican: casi ningún gasto tiene vencimiento.
- Para elegir la cuenta de gasto hay que buscar entre unas 138 cuentas del PGC sin buscador, y por defecto se propone la primera (`components/expenses/create-expense-invoice-form.tsx:499-504`).
- El importador de extractos bancarios solo acepta un CSV `fecha;importe;concepto`. Descarta filas sin decir cuántas y no admite Norma 43 ni un mapeo de columnas (`lib/bank-csv.ts`).
- La conciliación "automática" se aplica directamente, sin enseñar antes las propuestas.
- Una factura de proveedor solo puede cubrir una recepción, con los precios bloqueados y el IVA a 0 % si el artículo no tiene impuesto por defecto.

**Contabilidad y fiscalidad**
- **Al abrir el ejercicio siguiente, la app cambia a él automáticamente** y desaparece el botón para cerrar el anterior (`components/accounting/fiscal-year-lifecycle-panel.tsx:104,198`).
- **El cierre no tiene lista de comprobaciones**: 303 del 4T presentado, borradores, descuadres.
- **El paquete para el gestor está incompleto.**
  - El CSV del libro diario solo exporta la página visible.
  - No se pueden exportar los libros registro de IVA ni el balance de sumas y saldos.
- **Activar VERI\*FACTU es irreversible y no pide confirmación** (`components/fiscal/fiscal-settings-form.tsx`).
- **Presentar el 303 exige un formulario genérico**: no se puede marcar como presentado con el número de justificante ni copiar las casillas. El formulario de creación permite elegir "Presentado" como estado inicial.
- **Los importes del asiento manual y la prorrata usan `type=number`**, así que no aceptan "1.234,56" (`components/accounting/create-journal-entry-form.tsx:97-118`).

**Accesibilidad (WCAG 1.4.3 y 1.4.11)**

| Elemento | Dónde falla | Contraste medido | Mínimo |
|---|---|---|---|
| Etiquetas de estado (98 usos, texto de 9,9 px): éxito, peligro, información y aviso | Clásico, Papel y Hielo | 3,66–4,45:1 | 4,5:1 |
| Enlaces | Nocturno, CRT verde y Terminal ámbar | 2,68–2,95:1 | 4,5:1 |
| Anillo de foco | DOS papel | 1,95:1 | 3:1 |

### 3.3 Medias

**Lenguaje**
- Quedan términos técnicos o en inglés: "Onboarding", "Tenant", "seeds", "cockpit", "checkout", "Informes y BI", "KPIs", "Drill-down", "Postable", "Cobertura MVP", "Pre303" y "export JSON".
- También se muestran valores sin traducir ("recargo_equivalencia") y títulos tipo "ERP_SUITE.EXE" o "KEYBOARD.EXE".
- Hay inconsistencias: Fiscal/Fiscalidad, VeriFactu/VERI\*FACTU, Balanceado/Descuadre.

**Panel**
- Tiene tres bloques de orientación que se solapan.
- Muestra avisos que no aplican ("Sin documentos de venta" e "Inventario sin alertas" en empresas de servicios).
- Los pasos enlazan a listados en vez de a "Nuevo…".

**Navegación**
- 24 elementos de primer nivel, con API, Auditoría y Maestros al mismo nivel que Facturas.
- Códigos numéricos siempre visibles.
- "G 4 0" abre Suscripción y no la sección de administración.
- La búsqueda no encuentra "iva", "gestor", "invitar", "conciliar" ni "contraseña", y no incluye subpáginas como Conciliación o Calendario fiscal.

**Ventas**
- Solo hay un camino de presupuesto a factura (a través del albarán y con stock), lo que penaliza a las empresas de servicios.
- No se puede marcar un presupuesto como enviado, aceptado o rechazado.
- La rectificativa en borrador no se puede editar.
- En el borrador falta "Guardar y emitir".
- Al intentar borrar un cliente con facturas aparece un 500 genérico.

**Gastos, inventario y tesorería**
- El formulario de gasto viene con valores de ejemplo ("Gasto operativo", 100 €) que se registran si no se cambian.
- En modo manual no se buscan duplicados.
- El adjunto se indica con un campo de URL, no con una subida de archivo.
- **Proveedores duplicados**: los pedidos de compra crean un proveedor nuevo a partir de texto libre.
- **Recuento de inventario**: hay que calcular la diferencia a mano y el formulario no muestra el stock actual.
- **Tesorería**: los pagos quedan "Sin especificar" de cuenta bancaria, y "Registrar cobro" solo actúa sobre la última factura.

**Contabilidad y fiscalidad**
- El asiento manual propone la primera cuenta del plan y no tiene buscador.
- La página `/fiscal` está sobrecargada.
- El calendario fiscal sale vacío hasta que existen borradores.
- Seis formularios muestran un `SyntaxError` en inglés si el servidor no responde con JSON.
- Los saldos aparecen con signo, sin indicar "Deudor/Acreedor".

**Otros**
- Los atajos de una sola tecla ("/", "?", "g") no se pueden desactivar, lo que incumple WCAG 2.1.4 (nivel A).
- La OCR con OpenAI no avisa de que los datos salen del ERP.

### 3.4 Bajas
- Hay **90 tamaños de texto por debajo de 12 px**, 12 de ellos en primitivas compartidas: cabeceras de tabla de 10,4 px, etiquetas de estado de 9,9 px y botones pequeños.
- Plurales incorrectos: "Venció hace 1 días", "modelo(s)".
- Quedan 10 `rounded-md` fuera del sistema visual.
- `scroll-behavior: smooth` no respeta la preferencia de movimiento reducido.
- Encabezados anidados incorrectamente.
- El título de la sección "Facturas emitidas" incluye borradores.
- La fecha de hoy se calcula en UTC.
- No hay selector de serie de facturación ni descuento en las líneas de factura.
- Existe código muerto: `components/purchases/purchase-flow-actions.tsx`.
- No hay ayuda ni glosario dentro de la aplicación.

---

## 4. Métricas de tareas (camino mínimo, deducido del código)

| Tarea | Pantallas | Clics | Campos | Observación |
|---|---|---|---|---|
| Registrarse y llegar al panel | 3 | 3 | 5 | Hay que volver a iniciar sesión sin necesidad. |
| Dejar la empresa lista para facturar | +1 | +2 | +6 | Nada lo indica; el usuario tiene que adivinarlo. |
| Cliente nuevo más factura con 2 líneas, IVA 21 % e IRPF 15 % | 1 + diálogo | ~12 | 6 + 2×2 | El IRPF se marca línea a línea. |
| Presupuesto → pedido → albarán → factura | 7 | ~7 | — | Obliga a pasar por almacén y stock. |
| Borrador → editar → emitir | 4 | 5 | — | Falta "Guardar y emitir". |
| Localizar las facturas vencidas | 1 | 2 | — | **No encuentra nada**, porque no hay vencimientos. |
| Reclamar una factura | 2 + correo externo | ~4 por factura | — | Sin envío por email. |
| Subir 10 facturas con OCR | 1 | 3 + 10 | 8 + 7 por línea en cada factura | Sin ver el documento. |
| Importar el extracto y conciliar | 1 + diálogos | 3 + 2 por movimiento | CSV en bruto | Comisiones y pagos múltiples son imposibles. |
| ¿Cuánto dinero tendré el mes que viene? | 1 | 1 | — | **Sin respuesta**: no parte del saldo actual. |
| Preparar y presentar el 303 | ~7 clics | — | — | Se copian las casillas a mano en la AEAT. |
| Entregar al gestor lo que necesita | 4 páginas | 5+ | — | Incompleto. |
| Activar VERI\*FACTU | 1 | 2 | — | Irreversible y sin confirmación. |
| Cambiar de empresa o ejercicio | 0 | 3 (5 en móvil) | 2 | Paso "Aplicar" innecesario. |

---

## 5. Propuestas de mejora

### 5.1 Victorias rápidas (≤ 1 día cada una, gran impacto)

1. **Enter nunca emite.** En los formularios de factura y de rectificativa, Enter guarda un borrador o abre el diálogo de emisión, y "Emitir" siempre pasa por el diálogo de confirmación (C1).
2. **Albarán → factura por el flujo único de emisión** (`issueInvoiceInTransaction`), con confirmación y el número de factura en el mensaje. Alternativa: que genere un borrador (C2).
3. **Primer uso guiado.**
   - Redirigir al asistente en el primer inicio de sesión y crear la empresa con el nombre que dé el usuario.
   - Que el asistente guarde la serie de numeración y envíe la invitación, o que se eliminen esos pasos (C3, C4).
4. **Conservar el enlace de invitación** en el paso de login a registro, y entrar directamente tras registrarse (C5).
5. **Registro de OCR seguro.** "Registrar preparados" solo incluye las facturas con cuenta sugerida, pide confirmación ("Se registrarán N facturas por X €") y marca las demás como "Revisar cuenta" (C6).
6. **Aviso al salir con elementos de OCR pendientes** y reducir `aria-live` a una línea de resumen (C8).
7. **Filtrar los estados financieros por ejercicio**, con selector de periodo y "Beneficio del ejercicio" (C10).
8. **IVA por defecto correcto**: el impuesto marcado como predeterminado, de tipo IVA; si no existe, el 21 %.
9. **Vencimiento automático** = fecha de emisión + días de pago del cliente o del proveedor, y hacer esos días editables en la ficha.
10. **Confirmar la activación de VERI\*FACTU** con el diálogo de acción irreversible.
11. **Al abrir el ejercicio siguiente, no cambiar a él**, y ofrecer "Cerrar 2026 ahora".
12. **Tokens de contraste.**
    - Texto de las etiquetas de estado más oscuro, con un fondo del 8 % y tamaño ≥ 0,7rem.
    - Token `--link` para los temas oscuros.
    - Foco de "DOS papel" en `#0b5f5f`.
    - Tamaño mínimo de 12 px en las primitivas compartidas.
13. **Repaso del lenguaje.**
    - Sustituir la jerga y los términos en inglés.
    - Unificar Fiscalidad y VERI\*FACTU.
    - Añadir un helper de plurales.
    - Traducir el régimen fiscal.
14. **Palabras clave en la paleta de comandos** (IVA, gestor, invitar, conciliar, contraseña…), incluir las subpáginas y quitar "Código NN".
15. **Formato español en todos los importes**, también en los asientos y la prorrata, y usar `readApiError` en los seis formularios que muestran `SyntaxError`.
16. **Permitir desactivar los atajos de una sola tecla** (WCAG 2.1.4).
17. **Pendiente real en la ficha del cliente** (neto de cobros y rectificativas, sin borradores), y responder con un 409 comprensible al borrar un cliente con facturas.

### 5.2 Esfuerzo medio (2–5 días)

- **Lista de puesta en marcha en el panel**, que se muestra primero hasta completarla: datos fiscales → serie de numeración → cuenta bancaria → primer cliente → primera factura. Con un banner "Completa tus datos fiscales".
- **Recuperación de contraseña** y **reenvío del email de verificación**.
- **Rol de gestor/asesor**: solo lectura, con acceso a contabilidad y fiscalidad, y posibilidad de acceder a varias empresas.
- **Invitaciones pendientes**, con reenviar, cancelar y copiar enlace.
- **Envío de la factura por email**, con plantilla, CC y trazabilidad, y **recordatorios de cobro** en bloque con antigüedad de la deuda.
- **Revisión del OCR a pantalla partida**: el documento a un lado y los campos al otro.
- **Bandeja de OCR pendiente persistente.**
- **Valores por defecto del proveedor**: cuenta de gasto, IRPF, porcentaje deducible y tratamiento de IVA.
- **Selector de cuentas con buscador y alias en lenguaje llano** (alquiler → 621, gasolina/luz/agua → 628, asesoría → 623).
- **Mesa de conciliación.**
  - Casar un movimiento con facturas pendientes, creando el cobro o el pago.
  - Un movimiento contra varias facturas.
  - "Asignar a cuenta", con reglas del tipo "concepto contiene COMISION → 626".
  - Propuestas automáticas que se aceptan una a una.
- **Previsión de tesorería real**: saldo actual más cobros y pagos a 30, 60 y 90 días, con saldo acumulado.
- **Flujo de presentación del modelo.**
  - Redirigir al borrador recién creado.
  - "Marcar como presentado" con fecha y justificante.
  - Botones para copiar cada casilla y enlace a la sede de la AEAT.
  - Periodo elegido con selectores en vez de texto libre.
- **Lista de comprobaciones antes del cierre del ejercicio.**
- **Paquete para el gestor** en un único ZIP: libro diario completo, mayor, sumas y saldos, libros registro de IVA y PDF de los modelos.
- **Tratamiento de IVA intracomunitario separado en bienes y servicios**, con selector de país ISO y comprobación en VIES.
- **Menos pasos en ventas.**
  - Presupuesto o pedido directamente a factura (para servicios).
  - Estados del presupuesto: enviado, aceptado y rechazado.
  - "Guardar y emitir".
  - Poder editar la rectificativa en borrador.
- **Hoja de recuento de inventario** con el stock del sistema y cálculo automático de diferencias.

### 5.3 Mayor alcance

- **Navegación adaptada al tipo de negocio.**
  - Preguntar "¿Vendes productos o servicios?" y ocultar inventario, albaranes y recepciones a quien solo vende servicios.
  - Mover API y Auditoría a una sección "Avanzado".
  - Mostrar los códigos numéricos solo en modo teclado.
- **Facturas recurrentes** y **gastos recurrentes** (alquiler, cuotas, suscripciones).
- **Importación bancaria con asistente de columnas y Norma 43**; después, **conexión bancaria PSD2**.
- **Captura de tickets desde el móvil**, con una revisión simplificada.
- **Remesas SEPA** para pagar varias facturas de proveedor a la vez.
- **Ayuda contextual y glosario** ("¿Qué es la cuenta 555?", "¿Qué es el 303?") integrados en las páginas.
- **Cambio de empresa o ejercicio en un solo paso**, mostrando la empresa activa en la cabecera móvil.

---

## 6. Hoja de ruta sugerida

| Sprint | Objetivo | Incluye |
|---|---|---|
| 1 (urgente) | Eliminar los errores irreversibles y el riesgo de cumplimiento | Victorias rápidas 1, 2, 5, 7, 10 y 11 |
| 2 | Primer uso sin fricción | Victorias rápidas 3, 4 y 8; lista de puesta en marcha; recuperación de contraseña; rol de gestor; invitaciones |
| 3 | Cobrar mejor | Vencimientos automáticos, envío por email, recordatorios, pendiente real, presupuesto → factura |
| 4 | Gastos sin conocimientos contables | Revisión del OCR a pantalla partida, bandeja persistente, valores del proveedor, selector de cuentas con alias |
| 5 | Tesorería útil | Mesa de conciliación con reglas, previsión real, importación Norma 43 |
| 6 | Fiscalidad y gestor | Flujo de presentación, checklist de cierre, paquete para el gestor, VIES |
| 7 | Pulido transversal | Contraste, texto de 12 px mínimo, lenguaje, palabras clave de búsqueda, atajos desactivables, ayuda y glosario |
