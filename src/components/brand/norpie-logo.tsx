import { cn } from "@/lib/utils";

/**
 * Icono de Norpie: la carpeta amarilla con la N grabada, en pixel art de 32×32 (paleta VGA).
 * Se pinta a 32 px (o múltiplos) para que cada píxel caiga entero; por debajo, la versión de 16×16
 * dibujada aparte, como hacía Windows con cada icono.
 */
export function NorpieLogo({ className, size = 32 }: { className?: string; size?: 16 | 32 | 64 }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- pixel art en SVG estático: sin optimización de imagen
    <img
      alt=""
      aria-hidden="true"
      className={cn("shrink-0 [image-rendering:pixelated]", className)}
      height={size}
      src={size === 16 ? "/icons/norpie-16.svg" : "/icons/norpie.svg"}
      width={size}
    />
  );
}
