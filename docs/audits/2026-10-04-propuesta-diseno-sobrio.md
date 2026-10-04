# Propuesta de diseño sobrio (escritorio y móvil)

Fecha: 2026-10-04
Base: auditoría completa de `src/app` y `src/components`, cruzada con las skills
[`better-ui`](https://www.skills.sh/jakubkrehel/skills/better-ui) (Jakub Krehel) y
[`emil-design-eng`](https://www.skills.sh/emilkowalski/skills/emil-design-eng) (Emil Kowalski).

## 1. Diagnóstico

La UI actual es coherente y accesible en lo básico (skip link, focus trap, `aria-current`,
navegación por teclado, `AccessibleField`, `tabular-nums` global, tarjetas en móvil en
`ResourceList`). El problema no es la calidad, es el **lenguaje visual**: un "Windows 95 /
terminal" con biseles, `font-mono` en 490 sitios, radio de 3 px y texto de 10–12 px. Es
denso y con personalidad, pero no es sobrio, y en móvil se nota pequeño y apretado.

Problemas de fondo:

1. **Los tokens existen pero no se usan.** `rounded-[2px]` ×131, `rounded-[1px]` ×25,
   ~20 `shadow-[…]` copiados a mano (el bisel ×18), 11 tamaños `text-[…]` distintos.
   Cambiar el estilo hoy obliga a tocar cientos de líneas.
2. **Biseles con `rgba` fijo** (`button.tsx:11,19`, `app-shell.tsx:53,251`,
   `status-badge.tsx`, `page.tsx:286`): asumen fondo claro en los 8 temas.
3. **Tres lenguajes visuales**: app (mono/bisel), landing+auth (sans, blur, `shadow-2xl`,
   pill) y las rejillas de "áreas" (tres estilos distintos en dashboard, tesorería,
   contabilidad y reporting).
4. **Móvil**: objetivos táctiles de 28–32 px (nav `h-8`, botones `sm`, items de dropdown),
   tablas crudas sin alternativa en tarjetas (~17 páginas), selección masiva imposible en
   tarjetas, popover de impuestos `min-w-72` que desborda, drawer sin animación.
5. **Movimiento**: casi inexistente (bien para teclado), pero diálogo, drawer y dropdown
   aparecen de golpe y algunos `transition-*` no respetan `prefers-reduced-motion`.

## 2. Dirección: "sobrio" = denso, plano, tipográfico

- **Sans para la interfaz, mono solo para datos** (importes, códigos de cuenta, NIF, nº
  de factura). La jerarquía la dan tamaño y peso, no la tipografía.
- **Superficies planas**: sombra-como-borde para elevación, bordes solo para estructura
  (divisores de tabla, inputs, estados). Sin biseles, sin `brightness` en hover.
- **Un acento**. Neutros casi acromáticos; el color se reserva para estado (éxito, aviso,
  error) y para la acción primaria.
- **Densidad de herramienta profesional en escritorio, holgura táctil en móvil**: mismos
  componentes, altura de control distinta por breakpoint.
- **Movimiento casi invisible**: solo donde aporta orientación (diálogos, drawer, toasts);
  nada en acciones de teclado ni en interacciones de alta frecuencia.

Los temas retro **no se eliminan**: pasan a ser temas opcionales. Para eso, los biseles se
convierten en tokens (§3.3) y cada tema decide si su "superficie elevada" es un bisel o una
sombra suave. El tema por defecto pasa a ser "Sobrio claro" / "Sobrio oscuro".

## 3. Sistema de diseño

### 3.1 Color (tema "Sobrio")

| Token | Claro | Oscuro | Uso |
| --- | --- | --- | --- |
| `--background` | `oklch(0.985 0 0)` | `oklch(0.16 0 0)` | Lienzo |
| `--card` / `--popover` | `oklch(1 0 0)` | `oklch(0.205 0 0)` | Superficies |
| `--muted` | `oklch(0.967 0 0)` | `oklch(0.25 0 0)` | Hover de fila, zonas secundarias |
| `--foreground` | `oklch(0.21 0.006 285.9)` | `oklch(0.97 0 0)` | Texto |
| `--muted-foreground` | `oklch(0.47 0.01 285.9)` | `oklch(0.72 0.01 285.9)` | Texto secundario (≥4.5:1) |
| `--border` | `oklch(0 0 0 / 0.09)` | `oklch(1 0 0 / 0.09)` | Divisores, tablas |
| `--input` | `oklch(0 0 0 / 0.16)` | `oklch(1 0 0 / 0.16)` | Borde de campos (≥3:1 con foco) |
| `--primary` | `oklch(0.21 0.006 285.9)` | `oklch(0.97 0 0)` | Botón primario (tinta) |
| `--accent-brand` | `oklch(0.55 0.17 259.8)` | `oklch(0.70 0.14 259.8)` | Enlaces, foco, selección |
| `--ring` / `--focus-accent` | `= --accent-brand` | `= --accent-brand` | Anillo de foco |
| `--success-text` / `--warning-text` / `--danger-text` | se mantienen y se validan a ≥4.5:1 sobre `--card` | | Estados |

Reglas: nada de `text-primary` para texto informativo (fallaba contraste en temas
oscuros); usar `text-foreground` o `text-link`. Los enlaces usan **solo** `text-link`
(eliminar `.link` y `text-primary` en `<a>`).

### 3.2 Radios concéntricos (`better-ui`: radio exterior = interior + padding)

| Token | Valor | Uso |
| --- | --- | --- |
| `--radius-sm` | 4px | Badges, checkboxes, chips |
| `--radius-md` | 6px | Botones, inputs, items de menú |
| `--radius-lg` | 10px | Cards, tablas, popovers (`p-1` + item 6px → 10px ✓) |
| `--radius-xl` | 14px | Diálogos, sheets (`p-2` + card interna 6px → 14px ✓) |

Prohibido `rounded-[Npx]`. Lint con una regla de `eslint-plugin-tailwindcss` o un
`grep` en CI.

### 3.3 Elevación como tokens

```css
:root[data-theme="sobrio-light"] {
  --shadow-border:
    0px 0px 0px 1px oklch(0 0 0 / 0.06),
    0px 1px 2px -1px oklch(0 0 0 / 0.06),
    0px 2px 4px 0px oklch(0 0 0 / 0.04);
  --shadow-border-hover:
    0px 0px 0px 1px oklch(0 0 0 / 0.08),
    0px 1px 2px -1px oklch(0 0 0 / 0.08),
    0px 2px 4px 0px oklch(0 0 0 / 0.06);
  --shadow-overlay: var(--shadow-border), 0 12px 32px -8px oklch(0 0 0 / 0.16);
}
:root[data-theme="sobrio-dark"] {
  --shadow-border: 0 0 0 1px oklch(1 0 0 / 0.08);
  --shadow-border-hover: 0 0 0 1px oklch(1 0 0 / 0.13);
  --shadow-overlay: 0 0 0 1px oklch(1 0 0 / 0.1), 0 16px 40px -8px oklch(0 0 0 / 0.6);
}
/* Los temas retro definen estos mismos tokens con su bisel actual */
```

Se exponen como utilidades `shadow-border`, `shadow-border-hover`, `shadow-overlay` en
`@theme inline` y sustituyen a los ~20 `shadow-[…]` arbitrarios y a `.win-bevel`/`.win-inset`.

| Elemento | Tratamiento |
| --- | --- |
| Card, contenedor de tabla, MetricCard | `shadow-border`, sin `border` |
| Popover, dropdown, diálogo, sheet | `shadow-overlay` |
| Filas y celdas de tabla, separadores | `border-b border-border` (estructura) |
| Inputs, selects, textarea | `border border-input` (accesibilidad) |
| Imágenes (logos, adjuntos, previsualización OCR) | `outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10` |

### 3.4 Tipografía

- UI: **Geist Sans** 400/500/600. Datos: **Geist Mono** solo en importes, códigos,
  NIF/IBAN y números de documento (componente `<Num>`/clase `font-num`).
- Escala semántica (sustituye los 11 `text-[…]`):

| Token | Tamaño / interlineado | Uso |
| --- | --- | --- |
| `text-caption` | 12px / 1.4, +0.01em | Etiquetas de tabla en mayúsculas, ayuda |
| `text-body-sm` | 13px / 1.45 | Celdas de tabla, controles en escritorio |
| `text-body` | 14px / 1.5 | Texto base, formularios |
| `text-title-sm` | 16px / 1.3, 600 | `h2` de sección (hoy 12.5px, menor que el cuerpo) |
| `text-title` | 20px / 1.2, 600, -0.01em | `h1` de página |
| `text-display` | 28px / 1.1, 600, -0.02em | KPI del dashboard |

- Nada por debajo de 12px (hoy hay 9.9px en `invoice-form-controls.tsx:281`,
  `document-lines-editor.tsx:388`, `onboarding-wizard.tsx:339`).
- `text-balance` en `h1`/`h2`, títulos de empty state y alertas; `text-pretty` en
  descripciones. Nunca `truncate` en descripciones de cabecera (`page.tsx:175,220`): usar
  `line-clamp-2` con `title`.
- Importes: alineados a la derecha, `tabular-nums`, formato `es-ES` (`84.320 €`, no
  `€ 84.320` como en `app/page.tsx:27`).

### 3.5 Iconos (Phosphor)

- Peso `regular` junto a texto 400, `bold` junto a 600 (equivalente al grosor de trazo
  1.5/2 px de `better-ui`). Tamaño 16px en texto de 13–14px, 20px en la barra móvil.
- `fill` **solo** para el estado activo (item de navegación actual, pestaña activa).
- Limpiar `iconLibrary: "lucide"` de `components.json`: no está instalado.

### 3.6 Tamaños de control y áreas táctiles

| Control | Escritorio (`pointer: fine`) | Móvil |
| --- | --- | --- |
| Botón / input / select | 32px | 40px + área táctil 44px (pseudo-elemento) |
| Botón `sm` | 28px | 40px (no existe `sm` en móvil) |
| Botón icono | 32px | 44px |
| Item de navegación | 32px | 44px |
| Item de menú | 32px | 44px |
| Checkbox | 16px visual, 24px de área | 20px visual, 44px de área |

Hoy hay objetivos de 16px (`help/help-term.tsx:79`), 20px
(`chart-of-accounts-view.tsx:633`) y checkboxes nativos de ~13px.

## 4. Movimiento

Tokens (curvas de `emil-design-eng`):

```css
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
```

| Elemento | Frecuencia | Decisión |
| --- | --- | --- |
| Paleta de comandos (Ctrl+K), atajos `G x` | 100+/día | **Sin animación** |
| Hover de fila / nav / botón | decenas/día | Solo `background-color` 100ms `ease`, dentro de `@media (hover: hover) and (pointer: fine)` |
| Pulsar botón | decenas/día | `active:scale-[0.96]`, `transition-[scale] 150ms ease-out`, prop `static` para desactivarlo en botones de tabla/barra |
| Dropdown / popover / tooltip | ocasional | `opacity` + `scale(0.97→1)` 150ms `--ease-out`, `transform-origin: var(--transform-origin)` (desde el disparador) |
| Diálogo (escritorio) | ocasional | `opacity` + `scale(0.96→1)` 200ms `--ease-out`, origen centrado; salida 150ms |
| Drawer de navegación (móvil) | ocasional | `translateX(-100%)` 250ms `--ease-drawer`; salida 200ms; transición CSS (interrumpible) |
| Bottom sheet (móvil) | ocasional | `translateY(100%)` 250ms `--ease-drawer`, cierre por gesto con umbral de velocidad 0.11 |
| Toast (sonner) | ocasional | Defaults de sonner; sin `richColors`, colores desde tokens del tema |
| Cambio de icono contextual (copiar → copiado, guardar → guardado) | ocasional | `scale 0.25→1`, `opacity 0→1`, `blur 4px→0`, `cubic-bezier(0.2, 0, 0, 1)` con ambos iconos en el DOM |
| Cambio de tema | raro | Suprimir transiciones durante el cambio (`*{transition:none!important}` + reflow + quitar en el siguiente frame) |
| Primera carga de página | — | Sin animación de entrada; skeletons con la misma geometría que la página |

Reglas: nunca `transition-all`, nunca `ease-in`, nada por encima de 300ms en UI, salidas
más rápidas que entradas, y `prefers-reduced-motion: reduce` conserva solo opacidad y color.
Todo cambio animado tiene también una señal estática (color, icono o texto).

Implementación: migrar `dialog.tsx`, `dropdown-menu.tsx`, tooltips y el popover de
impuestos a primitivas de `@base-ui/react` (ya es dependencia). Aportan `data-starting-style`,
`data-ending-style`, `--transform-origin`, foco, cierre por clic fuera y Escape, y eliminan
el focus trap casero y el `<button>` de fondo duplicado (`dialog.tsx:97`,
`app-shell.tsx:247`). No hace falta Motion: todo es CSS.

## 5. Layout

### 5.1 Escritorio (≥1024px)

```
┌──────────────┬──────────────────────────────────────────────────────┐
│ ▣ Empresa  ▾ │ Facturas / F-2026-0142          ⌘K   Tema   Usuario │ 48px
│ ⌘K Buscar    ├──────────────────────────────────────────────────────┤
│              │ Emitidas  Rectificativas  Recurrentes  Cobros        │ 40px pestañas
│ Inicio       ├──────────────────────────────────────────────────────┤
│ Ventas       │                                                      │
│ ▸Facturas    │  Facturas                         [Exportar] [Nueva] │
│ Gastos       │  Emitidas este ejercicio                             │
│ Compras      │                                                      │
│ Tesorería    │  ┌────────┐┌────────┐┌────────┐┌────────┐            │
│ Contabilidad │  │Pendient││Vencido ││Cobrado ││ IVA    │  MetricCard│
│ Impuestos    │  └────────┘└────────┘└────────┘└────────┘            │
│ Inventario   │  ┌──────────────────────────────────────────────┐    │
│              │  │ Buscar…   Estado ▾  Fecha ▾                  │    │
│ ───────────  │  │ Nº        Cliente        Fecha     Total   ● │    │
│ Ajustes      │  │ F-0142    Acme SL        04/10   1.210,00 €  │    │
│ ◯ Fernando   │  └──────────────────────────────────────────────┘    │
└──────────────┴──────────────────────────────────────────────────────┘
  240px            contenido: px-6, tablas a ancho completo,
                   formularios max-w-[960px], texto max 70ch
```

- Sidebar 240px fija, fondo `--background`, item activo con `--muted` + icono `fill`, sin
  bloque azul relleno. Grupos separados por espacio (16px entre grupos, 2px entre items),
  no por líneas.
- Topbar de 48px con migas, Ctrl+K y menú de usuario; el selector de tema sale del topbar
  y pasa a Ajustes → Apariencia y al menú de usuario.
- `PageHeader`: título + descripción a la izquierda, acciones a la derecha
  (primaria siempre la última). 24px entre bloques de página, 8px dentro de un grupo.
- Rejillas de "áreas" de módulo: un solo componente `AreaLink` para dashboard, tesorería,
  contabilidad y reporting.

### 5.2 Móvil (<768px; tablet 768–1023 usa el layout móvil con 2 columnas)

```
┌─────────────────────────────┐
│ ☰  Facturas           ⌕  ◯ │ 56px + safe-area-top
├─────────────────────────────┤
│ Emitidas Rectif. Recurr. →  │ pestañas con desvanecido en el borde
├─────────────────────────────┤
│ Pendiente        12.430,00 €│
│ Vencido           1.210,00 €│ métricas en lista, no en 4 tarjetas
├─────────────────────────────┤
│ ┌─────────────────────────┐ │
│ │ F-0142        1.210,00 €│ │ tarjeta: identidad + importe
│ │ Acme SL · 04/10  ● Pend.│ │
│ └─────────────────────────┘ │
│ ┌─────────────────────────┐ │
│ │ F-0141          860,00 €│ │
│ └─────────────────────────┘ │
│                     ( + )   │ FAB "Nueva" 56px, inset 16px
├─────────────────────────────┤
│ Inicio Ventas Gastos Banco ⋯│ 64px + safe-area-bottom
└─────────────────────────────┘
```

- **Barra inferior** con 4 destinos frecuentes + "Más" (abre el drawer completo). El
  hamburguesa se mantiene como acceso secundario.
- **Listados**: todas las tablas usan `ResourceList` o un `<ResponsiveTable>` con
  tarjeta en móvil. Las páginas con `<Table>` crudo (`treasury/direct-debits`,
  `treasury/remittances`, `treasury/forecast`, `accounting/reports`, `ledger`, detalle de
  factura/gasto/modelo fiscal) pasan a tarjetas o, si son tablas contables que deben
  verse como tabla, a scroll horizontal con `min-w`, columna primera fija y sombra de
  desbordamiento como pista.
- **Selección masiva en móvil**: checkbox de 44px en la tarjeta (o pulsación larga) y
  barra de acciones fija abajo.
- **Formularios**: una columna, etiquetas encima, botones de acción en barra fija inferior
  con `env(safe-area-inset-bottom)`, botón primario a ancho completo con 16px de margen
  lateral. Inputs a 16px de texto (evita el zoom de iOS; ya está).
- **Editor de líneas de factura**: en móvil cada línea es una tarjeta resumen
  (concepto, cantidad × precio, total); al tocarla se edita en un bottom sheet. El selector
  de impuestos deja de ser un `<details>` `min-w-72` y pasa a un sheet.
- **Diálogos → bottom sheets** en móvil (mismo componente, `data-variant` por breakpoint).

## 6. Hallazgos priorizados

### Accesibilidad y objetivos táctiles

| Severidad | Ubicación | Antes | Después | Por qué |
| --- | --- | --- | --- | --- |
| HIGH | `layout/app-shell.tsx:176` | Skip link `bg-focus text-black` | `bg-foreground text-background` (o `--accent-brand` + `--accent-foreground`) | En classic-light `--focus-accent` es `#000`: texto negro sobre negro, invisible |
| HIGH | `help/help-term.tsx:79`, `chart-of-accounts-view.tsx:633`, checkboxes nativos en `resource-list.tsx:1178,1259`, `business-type-form.tsx:54`, `invite-member-form.tsx:97` | 13–20px | Mín. 24px; 44px en móvil con pseudo-elemento | WCAG 2.5.8; imposible de tocar con el dedo |
| HIGH | `ui/resource-list.tsx:1121-1130,1299-1358` | Barra de acciones masivas sin forma de seleccionar en móvil | Checkbox en tarjeta + barra fija abajo | La acción existe pero es inalcanzable en móvil |
| MEDIUM | `app-shell.tsx:51`, `button.tsx` (`sm`, `icon-sm`), `dropdown-menu.tsx:174`, `theme-switcher.tsx:68` | 28–32px en móvil | 44px en móvil (tabla §3.6) | Objetivos táctiles cómodos |
| MEDIUM | `dashboard/today-panel.tsx:49,77`, `treasury/page.tsx:204`, `create-expense-invoice-form.tsx:400`, `sepa-creditor-form.tsx:58`, `app-shell.tsx:191,258` | `text-primary` en texto | `text-foreground` / `text-link` | ~2.9:1 en midnight |
| MEDIUM | `ui/dialog.tsx:97`, `app-shell.tsx:247` | Fondo como `<button aria-label="Cerrar">` | Backdrop no interactivo de base-ui | El lector de pantalla anuncia dos botones de cierre |
| MEDIUM | `invoice-form-controls.tsx:257-263` | `<details>` `min-w-72` | Popover base-ui (escritorio) / sheet (móvil) | Desborda en 320–360px y no se cierra al pulsar fuera |
| LOW | `invoice-form-controls.tsx:193-203`, `resource-list.tsx:935-939` | `<label>` + `aria-label` distinto | Solo uno | El `aria-label` pisa la etiqueta visible |
| LOW | `treasury/page.tsx:200` | `h2` dentro de sección con `h2` | `h3` | Jerarquía de encabezados |

### Superficies y tokens

| Severidad | Ubicación | Antes | Después | Por qué |
| --- | --- | --- | --- | --- |
| MEDIUM | 131 × `rounded-[2px]`, 25 × `rounded-[1px]`, `auth-page-shell.tsx:22`, `api-key-manager.tsx:219`, `app/page.tsx:25` | Radios arbitrarios | `rounded-md` / `rounded-lg` / `rounded-xl` concéntricos | Radios descuadrados entre capas anidadas; imposible re-tematizar |
| MEDIUM | ~20 `shadow-[…]`; `button.tsx:11,19`, `app-shell.tsx:53,251`, `status-badge.tsx`, `page.tsx:286` | Biseles copiados con `rgba` fijo | `shadow-border` / `shadow-overlay` por tema | Sombras para elevación, bordes para estructura; funcionan en cualquier fondo |
| MEDIUM | `button.tsx:7` y Input/Select/Textarea | `font-mono text-[0.78rem] font-bold` | `font-sans text-body-sm font-medium` | Sobriedad y legibilidad; mono solo para datos |
| MEDIUM | `invoices/[id]/page.tsx:381`, `expenses/[id]/page.tsx:154`, `fiscal/[id]/page.tsx:117`, `accounting/reports/page.tsx:161`, `treasury/direct-debits/page.tsx:31`, `treasury/forecast/page.tsx:99` | Cuatro envoltorios de tabla distintos | Un `<TableContainer>` con `rounded-lg shadow-border` | Consistencia |
| MEDIUM | `dashboard/page.tsx:212-220`, `treasury/page.tsx:193-207`, `accounting/page.tsx:140-144`, `reporting/page.tsx:119` | Tres estilos de "áreas" | `AreaLink` único | Consistencia |
| MEDIUM | `app/page.tsx`, `components/auth-page-shell.tsx` | Lenguaje propio (blur, `shadow-2xl`, pill) | Mismos tokens que la app | La entrada al producto debe anticipar el producto |
| LOW | `layout/themed-toaster.tsx:15` | `richColors` | Toast con `--card`, `shadow-overlay` e icono de estado con `--success-text`/`--danger-text` | Los toasts ignoran los 8 temas |
| LOW | `invoice-form-controls.tsx:106,265` vs. resto | Checkboxes con y sin `accent-primary` | Componente `Checkbox` (base-ui) | Consistencia |
| LOW | `invoice-form-controls.tsx:123`, `document-lines-editor.tsx:117`, `sales-document-lines.tsx` | Tres editores de líneas | Un `DocumentLinesEditor` | Un solo sitio que pulir (cabeceras numéricas a la derecha, `aria-hidden`) |
| LOW | `create-invoice-form.tsx:647-668`, `edit-invoice-form.tsx:505-520` | Buscador de clientes duplicado | Componente compartido | Mantenimiento |

### Tipografía

| Severidad | Ubicación | Antes | Después | Por qué |
| --- | --- | --- | --- | --- |
| MEDIUM | `ui/page.tsx:216` | `h2` a `text-[0.78rem]` | `text-title-sm` (16px/600) | El título de sección era más pequeño que el cuerpo |
| MEDIUM | `invoice-form-controls.tsx:281,340`, `document-lines-editor.tsx:388`, `onboarding-wizard.tsx:339`, `dashboard/page.tsx:216`, `receive-purchase-button.tsx:173` | 9.9–10.4px | Mín. `text-caption` 12px | Ilegible, sobre todo en móvil |
| LOW | `ui/page.tsx:175,220` | `truncate` en descripciones | `line-clamp-2` + `text-pretty` | Contenido oculto sin forma de leerlo |
| LOW | `app/page.tsx:27` | `€ 84.320` | `84.320 €` | Formato es-ES |
| LOW | Títulos y empty states | Sin `text-balance` | `text-balance` | Evita viudas en titulares |

### Movimiento

| Severidad | Ubicación | Antes | Después | Por qué |
| --- | --- | --- | --- | --- |
| MEDIUM | `app-shell.tsx:245-291`, `ui/dialog.tsx`, `ui/dropdown-menu.tsx` | Aparecen de golpe | Recetas de §4 (CSS, interrumpibles) | Evita cambios bruscos; orienta de dónde viene cada capa |
| MEDIUM | `button.tsx:7` | `active:translate-x-px translate-y-px` + cambio de bisel | `active:scale-[0.96]` `transition-[scale] duration-150 ease-out`, prop `static` | Feedback táctil sin bisel |
| LOW | `app-shell.tsx:106`, `invoice-form-controls.tsx:101,260`, `dashboard/page.tsx:219`, `accounting/page.tsx:140`, `customers/[id]/page.tsx:101`, `api-key-manager.tsx:229`, `expense-batch-upload.tsx:544` | `transition-*` sin `motion-safe` | `motion-safe:` y propiedades explícitas | Respeta `prefers-reduced-motion` |
| LOW | `layout/theme-switcher.tsx` | El cambio de tema anima colores | Suprimir transiciones durante el cambio | El tema debe cambiar de golpe, no "mancharse" |
| LOW | `route-state.tsx:18`, `expenses/loading.tsx` | Skeleton con `p-3`, distinto de `PageShell` | Skeleton con la geometría real de la página | Sin saltos de layout al cargar |

**Veredicto (formato `better-ui`): Block.** Quedan 3 HIGH (skip link invisible,
objetivos táctiles de 13–20px y selección masiva inalcanzable en móvil).

No verificado: no se ha abierto un navegador. No se han reproducido animaciones al 10%,
ni probado 200% de zoom ni dispositivos reales. Los contrastes de temas oscuros están
calculados a partir de los tokens, no medidos en pantalla.

## 7. Plan de implementación

1. **Tokens (1 PR, sin cambio visual)**: añadir escala tipográfica, radios,
   `shadow-border`/`shadow-overlay`, curvas de easing y alturas de control a `globals.css`;
   definir esos tokens en los 8 temas con sus valores actuales (bisel incluido). Codemod de
   `rounded-[…]`, `shadow-[…]` y `text-[…]` a tokens. Regla de lint que prohíba
   arbitrarios.
2. **Arreglos HIGH** de §6 (skip link, áreas táctiles, selección en móvil).
3. **Tema "Sobrio" claro y oscuro** como nuevo default; temas retro se mantienen en
   Ajustes → Apariencia. Migración de primitivas (`Button`, `Input`, `Select`, `Checkbox`,
   `Card`, `Table`, `Badge`) a sans + tokens.
4. **Overlays en base-ui** (Dialog/Sheet, Menu, Popover, Tooltip) con las recetas de §4.
5. **Shell**: sidebar sobria, topbar de 48px, barra inferior móvil, drawer animado.
6. **Listados y formularios**: `ResponsiveTable`/`TableContainer`, migración de las
   ~17 tablas crudas, editor de líneas unificado con sheet en móvil, `FormActions` fija
   en móvil.
7. **Landing y auth** con los mismos tokens.
8. **Verificación**: capturas de Playwright a 360, 768, 1280 y 1920px en temas claro y
   oscuro; pruebas e2e y de accesibilidad existentes; revisión de animaciones al 10% en
   DevTools.
