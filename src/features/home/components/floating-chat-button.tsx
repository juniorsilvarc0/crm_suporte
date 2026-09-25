import Link from "next/link";

import { WhatsAppIcon } from "@/features/chat/components/whatsapp-icon";

/**
 * Atalho para a caixa de entrada.
 *
 * ⚠️ Leva ao **chat interno** (`/app/chat`). Nunca para `wa.me` nem para o
 * WhatsApp Web: o atendimento acontece dentro do CRM, que é onde ficam o
 * histórico, o takeover e o registro do lead.
 */
export function FloatingChatButton() {
  return (
    <Link
      href="/app/chat"
      aria-label="Abrir a caixa de entrada do WhatsApp"
      title="Abrir conversas"
      className="fixed bottom-[calc(var(--mobile-nav-height)+env(safe-area-inset-bottom)+0.75rem)] right-4 z-30 inline-flex size-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-[0_14px_30px_-10px_rgba(37,211,102,0.7)] outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:scale-100 lg:bottom-6 lg:right-6"
    >
      <WhatsAppIcon className="size-7" />
    </Link>
  );
}
