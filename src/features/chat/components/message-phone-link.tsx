"use client";

import { CopyIcon, MessageSquareTextIcon } from "lucide-react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useStartConversation } from "@/features/chat/hooks/use-start-conversation";
import { formatPhone } from "@/lib/formatters/phone";

export function MessagePhoneLink({ value, phone }: { value: string; phone: string }) {
  const { startConversation, checkingPhone } = useStartConversation();
  const checking = checkingPhone !== null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(phone);
      toast.success("Número copiado.");
    } catch {
      toast.error("Não foi possível copiar o número.");
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="font-medium text-[var(--wa-green-deep)] underline decoration-current/60 underline-offset-2 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onTouchStart={(event) => event.stopPropagation()}
            aria-label={`Opções para o telefone ${value}`}
          />
        }
      >
        {value}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72 p-1.5" sideOffset={6}>
        <DropdownMenuItem
          className="min-h-11 gap-3 px-3"
          disabled={checking}
          onClick={() => void startConversation(phone)}
        >
          <MessageSquareTextIcon className="size-5" />
          {checking ? "Verificando…" : `Conversar com ${formatPhone(phone)}`}
        </DropdownMenuItem>
        <DropdownMenuItem className="min-h-11 gap-3 px-3" onClick={() => void copy()}>
          <CopyIcon className="size-5" />
          Copiar número de telefone
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
