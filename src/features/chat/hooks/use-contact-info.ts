"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { notesPatchValue, type ContactInfo } from "@/features/chat/lib/contact-info";
import { linkContactToCustomer } from "@/features/contacts/lib/link-customer";
import type { CustomerSummary } from "@/features/customers/types";

/** `message` só vem na falha: é a do servidor, pronta para o toast. */
export type LinkCustomerOutcome = { ok: boolean; message?: string };

type State = {
  info: ContactInfo | null;
  loading: boolean;
  failed: boolean;
};

const INITIAL: State = { info: null, loading: true, failed: false };

/**
 * Cadastro do contato da conversa aberta, para a tela de informações do contato.
 *
 * O dono da busca é este hook, e ele só existe enquanto a tela está montada —
 * quem chama monta o sheet condicionalmente. Isso evita segurar dado de CRM na
 * memória das 424 conversas para uma tela que quase nunca abre.
 */
export function useContactInfo(conversationId: string) {
  const [state, setState] = useState<State>(INITIAL);
  const [savingNotes, setSavingNotes] = useState(false);
  const [linking, setLinking] = useState(false);
  /** Incrementar dispara a busca de novo — é o "tentar de novo" da tela. */
  const [attempt, setAttempt] = useState(0);
  /** Some com a resposta que chega depois do desmonte. */
  const alive = useRef(true);

  useEffect(() => {
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
        setState({ info, loading: false, failed: false });
      } catch (err) {
        // `abort` é desmonte esperado, não falha: mostrar erro aqui piscaria a
        // mensagem enquanto a tela já está saindo.
        if (controller.signal.aborted || !alive.current) return;
        console.error("[useContactInfo]", err);
        setState({ info: null, loading: false, failed: true });
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

  /**
   * Grava as notas pela rota do contato (`PATCH /api/contacts/[id]`). Rota de
   * escrita nova aqui seria um segundo caminho para o mesmo campo — e duas
   * validações que divergem.
   */
  const saveNotes = useCallback(
    async (draft: string): Promise<boolean> => {
      const contactId = state.info?.contact?.id;
      if (!contactId || savingNotes) return false;

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
          setState((current) =>
            current.info?.contact
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
    [state.info, savingNotes]
  );

  /**
   * Liga o contato à empresa escolhida, ou desliga com `null`, pelo mesmo
   * `PATCH /api/contacts/[id]` das notas (`linkContactToCustomer`).
   */
  const linkCustomer = useCallback(
    async (customer: CustomerSummary | null): Promise<LinkCustomerOutcome> => {
      const contactId = state.info?.contact?.id;
      if (!contactId || linking) return { ok: false };

      setLinking(true);
      try {
        const result = await linkContactToCustomer(contactId, customer?.id ?? null);
        if (!result.ok) return { ok: false, message: result.message };

        if (alive.current) {
          // Espelha a empresa escolhida, que já traz o selo do contrato. Buscar
          // de novo voltaria o painel ao esqueleto e as notas piscariam.
          setState((current) =>
            current.info ? { ...current, info: { ...current.info, customer } } : current
          );
        }
        return { ok: true };
      } finally {
        if (alive.current) setLinking(false);
      }
    },
    [state.info, linking]
  );

  return {
    info: state.info,
    loading: state.loading,
    failed: state.failed,
    savingNotes,
    saveNotes,
    linking,
    linkCustomer,
    retry,
  };
}
