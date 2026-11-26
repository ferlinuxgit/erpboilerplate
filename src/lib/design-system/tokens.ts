/**
 * Catálogo documentado de los tokens del design system. Los VALORES viven en `src/app/globals.css`
 * (uno por tema); aquí solo se nombran y se explica para qué sirve cada uno. La página pública
 * `/design-system` los pinta leyendo las variables CSS, así que nunca se desincronizan.
 */

export type ColorToken = { name: string; utility: string; role: string; pairWith?: string };
export type ColorGroup = { id: string; title: string; description: string; tokens: readonly ColorToken[] };

export const COLOR_GROUPS: readonly ColorGroup[] = [
  {
    id: "base",
    title: "Base",
    description: "Fondo de la página, texto y superficies de contenido.",
    tokens: [
      { name: "--background", utility: "bg-background", role: "Fondo de página", pairWith: "--foreground" },
      { name: "--foreground", utility: "text-foreground", role: "Texto principal" },
      { name: "--card", utility: "bg-card", role: "Tarjetas y celdas hundidas", pairWith: "--card-foreground" },
      { name: "--muted", utility: "bg-muted", role: "Zonas secundarias" },
      { name: "--muted-foreground", utility: "text-muted-foreground", role: "Texto secundario (≥ 4,5:1)" },
      { name: "--border", utility: "border-border", role: "Bordes suaves y separadores" },
      { name: "--input", utility: "border-input", role: "Borde de campos de formulario" },
    ],
  },
  {
    id: "ventana",
    title: "Ventana (cromo retro)",
    description: "Las piezas con las que se construyen ventanas, paneles, botones y relieves.",
    tokens: [
      { name: "--chrome-active", utility: "bg-chrome-active", role: "Barra de título y cabecera", pairWith: "--chrome-active-foreground" },
      { name: "--chrome-inactive", utility: "bg-chrome-inactive", role: "Barra de ventana inactiva" },
      { name: "--window-surface", utility: "bg-window-surface", role: "Cuerpo de ventana y botón secundario", pairWith: "--window-text" },
      { name: "--window-panel", utility: "bg-window-panel", role: "Bandas y paneles laterales" },
      { name: "--window-highlight", utility: "bg-window-highlight", role: "Luz del bisel y estado hover" },
      { name: "--window-shadow", utility: "border-window-shadow", role: "Sombra del bisel" },
      { name: "--window-dark-shadow", utility: "border-window-dark-shadow", role: "Contorno de todos los controles" },
      { name: "--window-muted", utility: "text-window-muted", role: "Texto secundario sobre ventana" },
    ],
  },
  {
    id: "accion",
    title: "Acción y foco",
    description: "Un único color de acción por tema; el foco siempre es visible y distinto.",
    tokens: [
      { name: "--primary", utility: "bg-primary", role: "Botón principal (uno por vista)", pairWith: "--primary-foreground" },
      { name: "--link", utility: "text-link", role: "Enlaces de texto e iconos de acento" },
      { name: "--focus-accent", utility: "outline-focus", role: "Contorno de foco de teclado" },
      { name: "--destructive", utility: "bg-destructive", role: "Acciones que borran o anulan", pairWith: "--destructive-foreground" },
    ],
  },
  {
    id: "estado",
    title: "Estado",
    description: "Cada estado tiene un color de relleno y otro de texto que cumple contraste sobre su tinte.",
    tokens: [
      { name: "--success", utility: "bg-success", role: "Correcto, cobrado, enviado" },
      { name: "--success-text", utility: "text-success-text", role: "Texto de éxito sobre tinte" },
      { name: "--warning", utility: "bg-warning", role: "Atención, vence pronto" },
      { name: "--warning-text", utility: "text-warning-text", role: "Texto de aviso sobre tinte" },
      { name: "--danger-text", utility: "text-danger-text", role: "Texto de error sobre tinte" },
      { name: "--info", utility: "bg-info", role: "Información neutra" },
      { name: "--info-text", utility: "text-info-text", role: "Texto informativo sobre tinte" },
    ],
  },
  {
    id: "graficos",
    title: "Gráficos",
    description: "Series validadas para daltonismo en cada tema. Ingresos, gastos y caja tienen rol fijo.",
    tokens: [
      { name: "--chart-1", utility: "fill-chart-1", role: "Serie 1 · ingresos" },
      { name: "--chart-2", utility: "fill-chart-2", role: "Serie 2 · caja" },
      { name: "--chart-3", utility: "fill-chart-3", role: "Serie 3 · gastos" },
      { name: "--chart-4", utility: "fill-chart-4", role: "Serie 4" },
      { name: "--chart-5", utility: "fill-chart-5", role: "Serie 5" },
    ],
  },
];

export type ShadowToken = { name: string; utility: string; role: string };

export const SHADOW_TOKENS: readonly ShadowToken[] = [
  { name: "--shadow-raised", utility: "shadow-raised", role: "Relieve hacia fuera: botones, tarjetas" },
  { name: "--shadow-pressed", utility: "shadow-pressed", role: "Botón pulsado o elemento activo" },
  { name: "--shadow-sunken", utility: "shadow-sunken", role: "Hundido: campos, cifras, listas" },
  { name: "--shadow-bevel-top", utility: "shadow-bevel-top", role: "Solo luz superior: bandas finas" },
  { name: "--shadow-drop", utility: "shadow-drop", role: "Sombra sólida de menús y popovers" },
  { name: "--shadow-window", utility: "shadow-window", role: "Ventana normal" },
  { name: "--shadow-window-lg", utility: "shadow-window-lg", role: "Ventana destacada (una por vista)" },
];

export type TypeStep = { name: string; className: string; sample: string; usage: string };

export const TYPE_SCALE: readonly TypeStep[] = [
  { name: "Display", className: "font-mono text-5xl font-bold leading-[1.1]", sample: "12 €/año", usage: "Precios y titular de la landing. Geist Mono 700, 48 px." },
  { name: "Título 1", className: "font-mono text-3xl font-bold leading-tight", sample: "Facturas de noviembre", usage: "Título de página. Geist Mono 700, 30 px." },
  { name: "Título 2", className: "font-mono text-xl font-bold", sample: "Resumen del trimestre", usage: "Sección y ventana. Geist Mono 700, 20 px." },
  { name: "Etiqueta", className: "font-mono text-xs font-bold uppercase tracking-[0.06em]", sample: "Pendiente de cobro", usage: "Rótulos, cabeceras de tabla, eyebrows. Mono 700, 12 px, mayúsculas." },
  { name: "Cuerpo", className: "text-sm leading-6", sample: "Cada factura genera su asiento y su apunte de IVA.", usage: "Texto de la app. Geist Sans 400, 14 px, interlínea 24." },
  { name: "Cuerpo grande", className: "text-base leading-7", sample: "El ERP para autónomos, pymes y hostelería.", usage: "Entradillas en páginas públicas. 16 px." },
  { name: "Cifra", className: "font-mono text-2xl font-bold tabular-nums", sample: "12.480,00 €", usage: "Importes: siempre monoespaciada y cifras tabulares." },
];

export const SPACING_STEPS: readonly { name: string; px: number; usage: string }[] = [
  { name: "1", px: 4, usage: "Entre icono y texto" },
  { name: "2", px: 8, usage: "Entre controles relacionados" },
  { name: "3", px: 12, usage: "Relleno de ventana en móvil" },
  { name: "4", px: 16, usage: "Relleno de ventana; margen lateral de página en móvil" },
  { name: "6", px: 24, usage: "Entre bloques de una sección" },
  { name: "8", px: 32, usage: "Entre título de sección y contenido" },
  { name: "14", px: 56, usage: "Entre secciones de la landing (móvil)" },
  { name: "20", px: 80, usage: "Entre secciones de la landing (escritorio)" },
];

export const PRINCIPLES: readonly { title: string; text: string }[] = [
  { title: "Retro por fuera, actual por dentro", text: "Biseles, barras de título y monoespaciada dan carácter; pero tamaños táctiles, contraste y comportamiento son los de hoy. Si la estética choca con la usabilidad, gana la usabilidad." },
  { title: "Los números mandan", text: "Es un ERP: importes, fechas y estados se leen de un vistazo. Cifras tabulares, alineadas a la derecha y con su formato es-ES (1.452,00 €)." },
  { title: "Una acción principal por vista", text: "Solo un botón primario a la vez. Lo demás es secundario (outline) o un enlace." },
  { title: "Profundidad con significado", text: "Elevado = se puede pulsar. Hundido = contiene datos o se escribe dentro. Nunca se usa el relieve como decoración." },
  { title: "Ocho temas, un solo código", text: "Ningún color se escribe a mano: todo usa tokens, así cada componente funciona en los 8 temas claros y oscuros." },
];

export const VOICE_RULES: readonly { do: string; dont: string }[] = [
  { do: "Tutea y ve al grano: «Elige tu plan para seguir trabajando».", dont: "«El usuario deberá proceder a seleccionar una modalidad de suscripción»." },
  { do: "Di qué pasa y qué hacer: «No hemos podido cobrar. Actualiza la tarjeta».", dont: "«Error 402: payment_failed»." },
  { do: "Usa las palabras del cliente: factura, cobro, gasto, modelo 303.", dont: "Jerga interna: tenant, addon, ledger, webhook." },
  { do: "Botones con verbo y objeto: «Emitir factura», «Contratar por 15 €/mes».", dont: "«Aceptar», «OK», «Enviar» sin contexto." },
];
