"use client";

import { useCallback, useEffect, useState } from "react";

import { ticketRequest } from "@/features/tickets/lib/ticket-request";
import type { TicketCatalog } from "@/features/tickets/types";

type Snapshot = { attempt: number; catalog: TicketCatalog | null; failed: boolean };

export type TicketCatalogState = {
  /**
   * `null` enquanto carrega ou quando a leitura inteira falhou. Cada parte pode
   * vir `null` sozinha (a leitura dela falhou): quem usa trata a parte.
   */
  catalog: TicketCatalog | null;
  loading: boolean;
  /** A rota respondeu erro (nenhuma parte veio) ou a rede caiu. */
  failed: boolean;
  /** "Tentar de novo": volta a carregar. */
  retry: () => void;
};

/**
 * O catálogo dos tickets no cliente (GET /api/tickets/catalog): status, a
 * matriz de transições, as prioridades, as filas e as categorias ativas.
 *
 * Uma leitura por montagem, sem cache: o painel do contato só monta ao abrir, e
 * uma fila arquivada pelo admin some na abertura seguinte.
 */
export function useTicketCatalog(): TicketCatalogState {
  /** Incrementar relê: é o "Tentar de novo". */
  const [attempt, setAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      const result = await ticketRequest<{ ok: true } & Partial<TicketCatalog>>(
        "/api/tickets/catalog",
        { signal: controller.signal }
      );
      if (controller.signal.aborted) return;
      if (!result.ok) {
        setSnapshot({ attempt, catalog: null, failed: true });
        return;
      }
      const { statuses, transitions, priorities, products, categories } = result.data;
      setSnapshot({
        attempt,
        catalog: {
          statuses: statuses ?? null,
          transitions: transitions ?? null,
          priorities: priorities ?? null,
          products: products ?? null,
          categories: categories ?? null,
        },
        failed: false,
      });
    }

    // O `setState` mora depois do `await`, não no corpo do efeito (molde de
    // `useContactInfo`).
    void load();
    return () => controller.abort();
  }, [attempt]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  // Resposta de outra tentativa = ainda carregando esta.
  const current = snapshot?.attempt === attempt ? snapshot : null;
  return {
    catalog: current?.catalog ?? null,
    loading: current === null,
    failed: current?.failed ?? false,
    retry,
  };
}
