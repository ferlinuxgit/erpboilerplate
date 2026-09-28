# Plan contable: análisis UX/UI y propuesta de rediseño (2026-09-28)

**Motivo.** «La vista del plan contable es muy básica y es difícil ver bien el plan contable; otros ERP lo muestran esquematizado y mucho más visual.»

**Base de partida.** El análisis se hizo sobre el código actual, que ya incluye la fase 1 de contabilidad: subcuentas de 8 dígitos por tercero y saldos agregados por prefijo.

## 1. Qué se ve hoy y por qué cuesta leerlo

`/accounting/accounts` muestra una **lista plana** en `src/components/accounting/accounts-list.tsx`.

- **Paginación:** 16 cuentas por página. Con el PGC y las subcuentas de 8 dígitos son unas **1.600 filas, unas 100 páginas**, sin contar las subcuentas de terceros.
- **Sin jerarquía:** no hay sangría, no se puede desplegar ni se ven los niveles superiores. El nivel solo aparece como texto dentro de una insignia («Grupo (nivel 3)»).
- **Nombres repetidos:** cuenta y subcuenta se llaman igual (430 «Clientes» y 43000000 «Clientes»), y sin sangría no se distinguen.
- **Estado «Inactiva» engañoso:** casi todas las filas lo llevan, porque solo 9 cuentas de la plantilla se consideran activas. Es ruido y no es cierto.
- **Saldos:**
  - Suman **todo el histórico**; no hay selector de ejercicio ni de periodo.
  - Se calculan debe, haber y número de apuntes, pero **solo se muestra el saldo**.
  - Un saldo a cero se ve igual que uno con importe y no hay fila de totales.
- **Búsqueda sin contexto:** no resalta lo encontrado, no muestra a qué grupo pertenece y no admite el atajo del punto (43.1).
- **Sin filtros:** no se puede pedir «con movimientos», «solo grupos», «terceros» ni «bloqueadas».
- **Faltan acciones:** no hay ficha de cuenta, «Crear subcuenta aquí» ni «Bloquear», aunque el campo `isBlocked` ya existe.
- **Formulario de alta desfasado:** propone el código de ejemplo «4300» y no permite elegir la cuenta padre. Al guardar vuelve a `/accounting` en lugar de al plan contable.
- **«Cuentas recientes» mal nombrado:** el bloque del resumen de contabilidad muestra en realidad las 8 primeras cuentas activas.
- **Móvil:** una tarjeta por cuenta (unas 1.600) y sin jerarquía.
- **Accesibilidad:** la tabla no sigue el patrón *treegrid* (faltan `aria-level` y `aria-expanded`).

## 2. Cómo lo hacen otros

- **Sage 50:** mantenimientos separados de «Cuentas» y de «Niveles». Crea automáticamente los niveles que faltan.
- **ContaSol:** «separadores de nivel» y saldos consultables a 3, 4, 5 u 8 dígitos. Es el patrón del **selector de nivel**.
- **Holded:** organizado en los 9 grupos del PGC, con **color por cuenta**. Oculta por defecto las cuentas sin saldo y tiene un «Mostrar todas».
- **Odoo:** grupos de cuentas por prefijo. La vista jerárquica («Hierarchy and Subtotals») está en el balance de sumas y saldos.
- **Xero:** pestañas por tipo de cuenta y columna **YTD** (saldo del año en curso) que lleva a los movimientos al pulsarla.
- **QuickBooks Online:** subcuentas **sangradas**, filtro «Solo cuentas madre», acción «Ver registro» y cuentas madre bloqueadas.
- **Zoho Books:** vistas **plegada y desplegada**.
- **Oportunidad:** ninguno documenta una **vista gráfica o de esquema** del plan contable. Ahí podemos diferenciarnos.

## 3. Propuesta

### Barra común de la pantalla

- `[Árbol | Lista | Esquema]`
- Ejercicio y periodo.
- **Nivel `1 2 3 4 Sub`**.
- Búsqueda (`/`) con atajo del punto.
- Filtros: «Con movimientos», «Ocultar saldo 0», «Terceros (400/410/430)», «Bloqueadas».
- «Exportar» y «Nueva cuenta».

### Vista Árbol (por defecto): árbol con panel de ficha

```
+- Plan contable ------------------------------------------------------------------+
| [Árbol][Lista][Esquema]  Ejercicio [2026 v] Periodo [Ene-Sep v]  Nivel [1][2][3][4][Sub] |
| [/ Buscar código, nombre, NIF...   ] [x] Con movimientos [ ] Saldo 0 [ ] Terceros  [Exportar] |
+----------------------------------------------------------+-----------------------+
| Código     Cuenta                    Debe    Haber  Saldo| 43000001 · ACME SL    |
| v 4        Acreedores y deudores  120.400  98.100 22.300D| 4 > 43 > 430 > 43000001 |
| : v 43     Clientes                 88.000  61.000 27.000D| Deudora · Tercero     |
| : : v 430  Clientes                 88.000  61.000 27.000D| Saldo inicial      0,00|
| : : : 4300|0001 ACME SL [T]        12.000   8.000  4.000D| Debe          12.000,00|
| : : : 4300|0002 Beta SA [T]            ·       ·      ·   | Haber          8.000,00|
| : : > 431  Clientes, efectos com.      ·       ·      ·   | Saldo    4.000,00 Deudor|
| : > 40     Proveedores             10.400  37.100 26.700A| ▁▃▅▂▇▆▃▅▆ (2026 vs 2025)|
| > 5        Cuentas financieras ...                        | Últimos apuntes (5)    |
| > 6        Compras y gastos    ...                        | [Ver mayor][Nueva subcta]|
+----------------------------------------------------------+-----------------------+
```

**Columnas:**
- **Código:** segmentado; la parte del padre atenuada y la propia en negrita (`4300`**`0001`**).
- **Sangría:** con guías por nivel.
- **Cuenta:** nombre, distintivo `[T]` para terceros (con el NIF) y candado si está bloqueada.
- **Debe, Haber y Saldo:** alineados a la derecha, en cifras tabulares. El saldo lleva una insignia **D** (deudor) o **A** (acreedor), y se avisa si va en contra de la naturaleza de la cuenta.
- **Ceros:** se muestran como «·», atenuados.
- **Grupos:** en negrita, con una barra de color por grupo del PGC. El color **nunca es la única pista**, porque los temas monocromo son grises.
- **Insignia «Inactiva»:** desaparece.

**Interacciones:**
- **Nivel N:** despliega todo hasta ese nivel.
- **Búsqueda:** despliega las ramas donde hay coincidencias y las resalta.
- **Teclado** (patrón *treegrid* de WAI-ARIA):
  - `↑↓` para moverse; `→` despliega; `←` pliega o sube al padre.
  - `Enter` abre la ficha y `Ctrl+Enter` abre el mayor.
  - `/` va a la búsqueda y `n` crea una subcuenta.
- **Menú por fila:** Ver mayor, Crear subcuenta aquí (con el siguiente código libre), Editar, Bloquear y Copiar código.
- **Estado en la URL**, para que el botón Atrás del navegador vuelva a la misma vista.

### Vista Esquema: tarjetas por grupo del PGC

```
+-1 Financiación básica--+ +-2 Activo no corriente--+ +-3 Existencias---------+
| Saldo 150.000,00 A      | | Saldo 84.200,00 D       | | Saldo 12.000,00 D      |
| 10 Capital     ███████  | | 21 Inm. mat.  ██████    | | 30 Comerciales ████    |
| 12 Resultados  ██       | | 28 Amort.     ██ (A)    | |                        |
| [Abrir en árbol]        | | [Abrir en árbol]        | | [Abrir en árbol]       |
+-------------------------+ +-------------------------+ +------------------------+
 ... 4 · 5 · 6 · 7 (con «Resultado = 7 − 6») · 8 · 9
```

- Barras proporcionales al saldo de cada subgrupo.
- Al pulsar un subgrupo se abre el árbol ya filtrado.
- Se eligen tarjetas con barras en lugar de treemap o sunburst porque se leen mejor, son accesibles y funcionan en los 8 temas.

### Vista Lista

Es la lista actual mejorada:
- filtros y columnas de debe y haber;
- «Ver mayor» pasa a las acciones de la fila.

Sirve para ordenar por saldo y para exportar.

### Móvil

```
+ Plan contable ---------+
| [Buscar /] [Filtros ▾] |
| 2026 · Nivel [2 ▾]     |
| < 4 > 43 Clientes      |
| 430 Clientes   27.000 D >|
| 4300|0001 ACME   4.000 D >|
+------------------------+
```

- Se navega un nivel cada vez, como un explorador de carpetas, con migas de pan.
- La ficha se abre a pantalla completa.

### Estados de la pantalla

- **Vacío:** «Cargar plantilla PGC».
- **Sin resultados:** botón «Quitar filtros».
- **Cargando:** filas esqueleto con sangría.
- **Error al desplegar:** reintento dentro de la propia fila.

## 4. Plan técnico

**Servidor:**
- `getChartTree(companyId, { from, to, parentCode, depth, q, filtros })`:
  - Reutiliza la agregación por prefijo, pero filtrando por fecha del asiento y con saldo inicial.
  - Por cada nodo devuelve debe, haber, saldo, número de apuntes, número de hijos y tercero.
  - **Carga perezosa:** la primera petición trae los niveles 1 y 2 (87 nodos) y cada despliegue pide solo los hijos directos.
  - Con muchos terceros (más de 5.000), agrupar en SQL por prefijo (`GROUP BY left(code, n)`).
- `GET /api/accounts/tree` para los despliegues.
- `getAccountSummary(id, ejercicio)` para la ficha: totales mensuales del ejercicio y del anterior, y últimos apuntes.
- «Bloquear» en la interfaz y endpoint de la siguiente subcuenta libre.

**Componentes (cliente):**
- `ChartOfAccountsView`: barra, cambio de vista y estado en la URL.
- `AccountTree`: `role="treegrid"`, virtualizado sobre los nodos visibles con filas de alto fijo de 28 px.
- `AccountTreeRow` con `AccountCode` (código segmentado) y `BalanceCell` (insignia D/A).
- `AccountDetailPanel` (la ficha): reutiliza `MetricCard`, `TimeSeriesChart` y `StatusBadge`; en móvil se abre como diálogo a pantalla completa.
- `ChartSchemeView`.

## 5. Fases

1. **Arreglos rápidos (1–2 días):**
   - Periodo en los saldos.
   - Columnas de debe y haber, ceros atenuados, quitar «Inactiva» y el enlace dentro de la celda.
   - Filtros.
   - Bloquear.
   - Redirecciones y formulario de alta con cuenta padre.
2. **Árbol mínimo viable:** carga perezosa, *treegrid* con teclado, selector de nivel, búsqueda con despliegue automático y atajo del punto, ficha y móvil por niveles.
3. **Árbol completo:**
   - Gráfico mensual frente al año anterior y últimos apuntes en la ficha.
   - «Crear subcuenta aquí».
   - Virtualización probada con unas 10.000 subcuentas.
   - Saldo del año anterior.
   - Exportación por nivel.
4. **Esquema:** tarjetas por grupo con barras y resultado 7 − 6.
5. **Pulido:**
   - Menú contextual y densidad de filas.
   - Pruebas e2e de teclado y ARIA.
   - Contraste comprobado en los 8 temas.
