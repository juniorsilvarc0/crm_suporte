"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import type { QuickReply } from "@/features/quick-replies/types";

/** Mesma ordem do servidor, para a lista não saltar depois de criar/editar. */
function byTitle(a: QuickReply, b: QuickReply) {
  return a.title.localeCompare(b.title, "pt-BR");
}

export type QuickRepliesStore = ReturnType<typeof useQuickReplies>;

/**
 * Dono único da lista de respostas rápidas do compositor.
 *
 * Duas superfícies consomem a mesma lista: o seletor (o ícone ao lado do campo)
 * e o menu que abre ao digitar `/`. Se cada uma buscasse por conta, criar uma
 * resposta no seletor não apareceria no `/` até recarregar a página — duas
 * fontes da verdade para o mesmo dado. O `ChatFooter` chama este hook **uma
 * vez** e entrega o resultado para as duas.
 *
 * A busca é preguiçosa: quem nunca abre o seletor nem digita `/` não paga
 * requisição nenhuma ao entrar na conversa.
 */
export function useQuickReplies() {
  const [items, setItems] = useState<QuickReply[] | null>(null);
  const [loading, setLoading] = useState(false);
  // Ref e não estado: `ensureLoaded` pode ser chamado a cada tecla enquanto a
  // primeira busca ainda está no ar, e o valor precisa ser o de agora.
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      // `scope=all` porque o seletor também gerencia: não dá para reativar uma
      // resposta que não aparece na lista.
      const response = await fetch("/api/quick-replies?scope=all");
      const result = (await response.json()) as {
        ok?: boolean;
        items?: QuickReply[];
        message?: string;
      };
      if (!response.ok || !result.ok) {
        toast.error(result.message ?? "Não foi possível carregar as respostas rápidas.");
        setItems([]);
        return;
      }
      setItems([...(result.items ?? [])].sort(byTitle));
    } catch {
      toast.error("Não foi possível carregar as respostas rápidas.");
      setItems([]);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  /** Busca na primeira necessidade. Chamar de novo depois não custa nada. */
  const ensureLoaded = useCallback(() => {
    if (items === null) void load();
  }, [items, load]);

  const applySaved = useCallback((saved: QuickReply) => {
    setItems((prev) => {
      const rest = (prev ?? []).filter((item) => item.id !== saved.id);
      return [...rest, saved].sort(byTitle);
    });
  }, []);

  const applyDeleted = useCallback((id: string) => {
    setItems((prev) => (prev ?? []).filter((item) => item.id !== id));
  }, []);

  return { items, loading, ensureLoaded, applySaved, applyDeleted };
}
