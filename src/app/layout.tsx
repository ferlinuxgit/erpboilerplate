import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppShell } from "@/components/layout/app-shell";
import { ThemedToaster } from "@/components/layout/themed-toaster";
import { DEFAULT_THEME, themeInitializationScript } from "@/lib/theme-config";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Norpie",
    template: "%s · Norpie",
  },
  description: "Gestión multiempresa de ventas, facturación, compras, inventario, contabilidad y tesorería.",
  applicationName: "Norpie",
  // Instalada en la pantalla de inicio (iPhone/iPad): a pantalla completa, como una aplicación.
  appleWebApp: { capable: true, title: "Norpie", statusBarStyle: "default" },
  icons: { icon: [{ url: "/favicon.ico", sizes: "16x16 32x32 64x64" }, { url: "/icons/norpie.svg", type: "image/svg+xml" }], apple: "/icons/apple-touch-icon.png" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      data-scroll-behavior="smooth"
      data-theme={DEFAULT_THEME}
      lang="es"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitializationScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <AppShell>{children}</AppShell>
        <ThemedToaster />
      </body>
    </html>
  );
}
