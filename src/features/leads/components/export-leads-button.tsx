import { DownloadIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Link direto para a rota de exportação. O Content-Disposition da resposta faz
// o browser baixar o arquivo sem sair da página; os cookies vão junto na
// navegação same-origin, então a guarda de sessão continua valendo.
export function ExportLeadsButton() {
  return (
    // Rota de API que devolve um arquivo (download), não uma página — o <Link>
    // do Next faz navegação client-side e não dispara o download; por isso o <a>.
    // eslint-disable-next-line @next/next/no-html-link-for-pages
    <a href="/api/leads/export" className={cn(buttonVariants({ variant: "outline" }))}>
      <DownloadIcon data-icon="inline-start" />
      Exportar CSV
    </a>
  );
}
