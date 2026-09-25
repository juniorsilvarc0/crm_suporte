"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

type StartConversationResult = {
  exists?: boolean;
  message?: string;
  conversation?: { id?: string };
};

export function useStartConversation() {
  const router = useRouter();
  const [checkingPhone, setCheckingPhone] = useState<string | null>(null);
  const requestPending = useRef(false);

  const startConversation = useCallback(
    async (phone: string, name?: string) => {
      if (requestPending.current) return false;
      requestPending.current = true;
      setCheckingPhone(phone);
      try {
        const response = await fetch("/api/chat/conversations/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone, ...(name ? { name } : {}) }),
        });
        const result = (await response.json().catch(() => ({}))) as StartConversationResult;
        const conversationId = result.conversation?.id;
        if (!response.ok || !result.exists || !conversationId) {
          toast.error(result.message ?? "Não foi possível abrir esta conversa.");
          return false;
        }

        router.push(`/app/chat?conversation=${encodeURIComponent(conversationId)}`);
        return true;
      } catch {
        toast.error("Não foi possível verificar este telefone.");
        return false;
      } finally {
        requestPending.current = false;
        setCheckingPhone(null);
      }
    },
    [router]
  );

  return { startConversation, checkingPhone };
}
