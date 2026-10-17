import type { MetadataRoute } from "next";

/**
 * Aplicación instalable («Añadir a pantalla de inicio»): abre el ERP a pantalla completa y ofrece un
 * acceso directo al TPV (mantener pulsado el icono en Android). En la tablet del mostrador se puede
 * instalar directamente desde /pos.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ERP Suite",
    short_name: "ERP",
    description: "Facturación, gastos, contabilidad y TPV.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#c0c0c0",
    theme_color: "#000080",
    lang: "es",
    icons: [{ src: "/icons/erp.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
    shortcuts: [
      { name: "TPV", short_name: "TPV", description: "Vender en mostrador", url: "/pos", icons: [{ src: "/icons/pos.svg", sizes: "any", type: "image/svg+xml" }] },
      { name: "Nueva factura", short_name: "Factura", url: "/invoices/new" },
    ],
  };
}
