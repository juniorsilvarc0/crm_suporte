"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  BriefcaseIcon,
  CopyIcon,
  Loader2Icon,
  MessageSquareTextIcon,
  UserRoundPlusIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  FALLBACK_CONTACT_NAME,
  parseContactMessage,
} from "@/features/chat/lib/contact-card";
import { formatPhone } from "@/lib/formatters/phone";
import { useStartConversation } from "@/features/chat/hooks/use-start-conversation";
import { cn } from "@/lib/utils";

/**
 * Cartão de contato compartilhado na conversa.
 *
 * Antes disto, as mensagens `type="contact"` caíam no ramo "desconhecido" da
 * bolha e viravam `[contact]` em itálico — 14 delas em produção.
 *
 * A ação principal consulta o Number Check e abre a conversa. Copiar e criar
 * lead continuam disponíveis como ações secundárias do CRM.
 */
export function ContactCard({
  content,
  isOutbound,
}: {
  content: string | null;
  isOutbound: boolean;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState<string | null>(null);
  const { startConversation, checkingPhone } = useStartConversation();
  const cards = parseContactMessage(content);

  // Sem nada aproveitável, devolve o texto cru — melhor que um card vazio.
  if (cards.length === 0) {
    return (
      <p className="whitespace-pre-wrap [overflow-wrap:anywhere] px-1 text-sm">{content ?? "Contato"}</p>
    );
  }

  async function copy(number: string) {
    try {
      await navigator.clipboard.writeText(number);
      toast.success("Telefone copiado.");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  }

  async function createLead(name: string, phone: string) {
    setCreating(phone);
    try {
      // "Contato" é o rótulo de vCard sem nome — mandar isso criaria um lead
      // chamado "Contato". O campo é opcional na rota; melhor deixar vazio.
      const realName = name === FALLBACK_CONTACT_NAME ? undefined : name;
      const res = await fetch("/api/leads/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Contato compartilhado numa conversa é indicação, por definição.
        body: JSON.stringify({ ...(realName ? { name: realName } : {}), phone, source: "indicacao" }),
      });
      const result = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!res.ok || !result.ok) {
        toast.error(result.message ?? "Não foi possível criar o lead.");
        return;
      }
      toast.success(`${realName ?? formatPhone(phone)} entrou no funil.`);
      router.refresh();
    } catch {
      toast.error("Não foi possível criar o lead.");
    } finally {
      setCreating(null);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {cards.map((card, index) => (
        <div
          key={`${card.name}-${index}`}
          className={cn(
            "min-w-0 rounded-md px-2.5 py-2",
            isOutbound ? "bg-black/[0.06] dark:bg-white/[0.08]" : "bg-black/[0.04] dark:bg-white/[0.08]"
          )}
        >
          <div className="flex min-w-0 items-center gap-3 pb-1.5">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-black/10 text-base font-medium uppercase dark:bg-white/10">
              {(card.name === FALLBACK_CONTACT_NAME ? "C" : card.name.charAt(0)) || "C"}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-semibold">{card.name}</p>
              {card.businessName && card.businessName !== card.name ? (
                <p className="mt-0.5 flex items-center gap-1 truncate text-[11.5px] opacity-70">
                  <BriefcaseIcon className="size-3 shrink-0" aria-hidden />
                  {card.businessName}
                </p>
              ) : null}
            </div>
          </div>

          <ul className="mt-1 flex flex-col gap-1">
            {card.phones.map((phone) => (
              <li key={phone.number} className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] tabular-nums">
                  {formatPhone(phone.number)}
                  {phone.label ? (
                    <span className="ms-1 font-sans opacity-60">({phone.label})</span>
                  ) : null}
                </span>

                <button
                  type="button"
                  onClick={() => copy(phone.number)}
                  aria-label={`Copiar ${phone.number}`}
                  title="Copiar telefone"
                  className="flex size-11 shrink-0 items-center justify-center rounded-md opacity-70 transition-opacity hover:bg-black/5 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/10 sm:size-7"
                >
                  <CopyIcon className="size-3.5" />
                </button>

                <button
                  type="button"
                  onClick={() => createLead(card.name, phone.number)}
                  disabled={creating !== null}
                  aria-label={`Criar lead para ${card.name}`}
                  title="Criar lead"
                  className="flex size-11 shrink-0 items-center justify-center rounded-md opacity-70 transition-opacity hover:bg-black/5 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 dark:hover:bg-white/10 sm:size-7"
                >
                  {creating === phone.number ? (
                    <Loader2Icon className="size-3.5 animate-spin" />
                  ) : (
                    <UserRoundPlusIcon className="size-3.5" />
                  )}
                </button>
              </li>
            ))}
          </ul>

          {card.phones.length > 0 ? (
            <div className="mt-2 border-t border-black/10 pt-1 dark:border-white/10">
              {card.phones.map((phone) => {
                const checking = checkingPhone === phone.number;
                return (
                  <button
                    key={`chat-${phone.number}`}
                    type="button"
                    disabled={checkingPhone !== null}
                    onClick={() =>
                      void startConversation(
                        phone.number,
                        card.name === FALLBACK_CONTACT_NAME ? undefined : card.name
                      )
                    }
                    className="flex min-h-10 w-full items-center justify-center gap-2 rounded-md px-2 text-[13px] font-semibold text-[var(--wa-green-deep)] transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 dark:hover:bg-white/10"
                  >
                    {checking ? (
                      <Loader2Icon className="size-4 animate-spin" />
                    ) : (
                      <MessageSquareTextIcon className="size-4" />
                    )}
                    {checking
                      ? "Verificando…"
                      : card.phones.length > 1
                        ? `Conversar com ${formatPhone(phone.number)}`
                        : "Conversar"}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
