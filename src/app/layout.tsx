import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Poppins } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { ServiceWorkerRegistrar } from "@/components/pwa/service-worker-registrar";
import { siteConfig } from "@/config/site";

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Face de display da marca: a Poppins, fonte única do site da Ticbox. Vive em
// títulos, navegação e números grandes — o corpo de texto e os dados densos
// continuam em Geist, que lê melhor em tabela.
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: {
    default: `${siteConfig.brand} ${siteConfig.name}`,
    template: `%s | ${siteConfig.brand} ${siteConfig.name}`,
  },
  description: siteConfig.description,
  applicationName: `${siteConfig.brand} ${siteConfig.name}`,
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: siteConfig.name,
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: [
    // A barra do navegador continua a faixa verde-escura do app (--sidebar).
    { media: "(prefers-color-scheme: light)", color: "#15312d" },
    { media: "(prefers-color-scheme: dark)", color: "#15312d" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${geist.variable} ${geistMono.variable} ${poppins.variable}`}
      suppressHydrationWarning
    >
      <body>
        <ThemeProvider>
          <TooltipProvider>
            {children}
            <Toaster
              richColors
              closeButton
              position="top-center"
              offset={{
                top: "calc(env(safe-area-inset-top, 0px) + 0.75rem)",
                right: "0.75rem",
                left: "0.75rem",
              }}
              mobileOffset={{
                top: "calc(env(safe-area-inset-top, 0px) + 5rem)",
                left: "0.75rem",
                right: "0.75rem",
              }}
            />
          </TooltipProvider>
        </ThemeProvider>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
