"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { notesPatchValue, type ContactInfo } from "@/features/chat/lib/contact-info";
import { linkContactToCustomer } from "@/features/contacts/lib/link-customer";
import type { CustomerSummary } from "@/features/customers/types";

/** `message` só vem na falha: é a do servidor, pronta para o toast. */
export type LinkCustomerOutcome = { ok: boolean; message?: string };

type State = {
  /** De que conversa é esta leitura (ver `shown`). */
  conversationId: string | null;
  info: ContactInfo | null;
  loading: boolean;
  failed: boolean;
};

const INITIAL: State = { conversationId: null, info: null, loading: true, failed: false };

/**
 * Cadastro do contato da conversa aberta (o contato e a empresa dele).
 *
 * Quem lê é o `ChatView`, uma vez por conversa ABERTA: o cabeçalho mostra a
 * empresa e o painel do contato recebe o mesmo estado, então vincular uma
 * empresa no painel chega ao cabeçalho na hora. Só a conversa aberta tem a
 * leitura — nada fica na memória das outras.
 *
 * O `ChatView` NÃO remonta ao trocar de conversa: a leitura é guardada com a
 * conversa a que pertence, e a de outra conversa vira "carregando" (como o
 * `useExternalContext`). Sem isso, o cabeçalho mostraria a empresa do contato
 * anterior sob o nome do novo até a resposta chegar.
 *
 * `null` = não busca (o painel montado com o estado de quem o abriu).
 */
export function useContactInfo(conversationId: string | null) {
  const [state, setState] = useState<State>(INITIAL);
  const [savingNotes, setSavingNotes] = useState(false);
  const [linking, setLinking] = useState(false);
  /** Incrementar dispara a busca de novo — é o "tentar de novo" da tela. */
  const [attempt, setAttempt] = useState(0);
  /** Some com a resposta que chega depois do desmonte. */
  const alive = useRef(true);

  useEffect(() => {
    if (!conversationId) return;
    alive.current = true;
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch(
          `/api/chat/conversations/${conversationId}/contact`,
          { signal: controller.signal }
        );
        if (!response.ok) throw new Error(String(response.status));
        const info = (await response.json()) as ContactInfo;
        if (!alive.current) return;
        setState({ conversationId, info, loading: false, failed: false });
      } catch (err) {
        // `abort` é desmonte esperado, não falha: mostrar erro aqui piscaria a
        // mensagem enquanto a tela já está saindo.
        if (controller.signal.aborted || !alive.current) return;
        console.error("[useContactInfo]", err);
        setState({ conversationId, info: null, loading: false, failed: true });
      }
    }

    // O `setState` mora dentro do `await`, não no corpo do efeito — por isso
    // não precisa da exceção ao `react-hooks/set-state-in-effect` que os hooks
    // com busca síncrona carregam.
    void load();

    return () => {
      alive.current = false;
      controller.abort();
    };
  }, [conversationId, attempt]);

  /** Volta ao estado de carregando e busca de novo. */
  const retry = useCallback(() => {
    setState(INITIAL);
    setAttempt((current) => current + 1);
  }, []);

  // O que a tela vê: a leitura DESTA conversa; a de outra é "carregando".
  const shown = state.conversationId === conversationId ? state : INITIAL;

  /**
   * Grava as notas pela rota do contato (`PATCH /api/contacts/[id]`). Rota de
   * escrita nova aqui seria um segundo caminho para o mesmo campo — e duas
   * validações que divergem.
   */
  const saveNotes = useCallback(
    async (draft: string): Promise<boolean> => {
      const contactId = shown.info?.contact?.id;
      if (!contactId || savingNotes) return false;
      const owner = shown.conversationId;

      setSavingNotes(true);
      try {
        const response = await fetch(`/api/contacts/${contactId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes: notesPatchValue(draft) }),
        });
        const payload = (await response.json().catch(() => null)) as {
          ok?: boolean;
          message?: string;
        } | null;

        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.message ?? `HTTP ${response.status}`);
        }

        if (alive.current) {
          // Espelha localmente em vez de rebuscar: a rota devolve só `{ ok }`, e
          // uma segunda ida ao servidor faria a nota piscar entre os dois valores.
          // Só na conversa em que a nota foi escrita (pode ter trocado no meio).
          setState((current) =>
            current.conversationId === owner && current.info?.contact
              ? {
                  ...current,
                  info: {
                    ...current.info,
                    contact: { ...current.info.contact, notes: notesPatchValue(draft) },
                  },
                }
              : current
          );
        }
        return true;
      } catch (err) {
        console.error("[useContactInfo] saveNotes", err);
        return false;
      } finally {
        if (alive.current) setSavingNotes(false);
      }
    },
    [shown.info, shown.conversationId, savingNotes]
  );

  /**
   * Liga o contato à empresa escolhida, ou desliga com `null`, pelo mesmo
   * `PATCH /api/contacts/[id]` das notas (`linkContactToCustomer`).
   */
  const linkCustomer = useCallback(
    async (customer: CustomerSummary | null): Promise<LinkCustomerOutcome> => {
      const contactId = shown.info?.contact?.id;
      if (!contactId || linking) return { ok: false };
      const owner = shown.conversationId;

      setLinking(true);
      try {
        const result = await linkContactToCustomer(contactId, customer?.id ?? null);
        if (!result.ok) return { ok: false, message: result.message };

        if (alive.current) {
          // Espelha a empresa escolhida, que já traz o selo do contrato. Buscar
          // de novo voltaria o painel ao esqueleto e as notas piscariam.
          setState((current) =>
            current.conversationId === owner && current.info
              ? { ...current, info: { ...current.info, customer } }
              : current
          );
        }
        return { ok: true };
      } finally {
        if (alive.current) setLinking(false);
      }
    },
    [shown.info, shown.conversationId, linking]
  );

  return {
    info: shown.info,
    loading: shown.loading,
    failed: shown.failed,
    savingNotes,
    saveNotes,
    linking,
    linkCustomer,
    retry,
  };
}

export type UseContactInfo = ReturnType<typeof useContactInfo>;
