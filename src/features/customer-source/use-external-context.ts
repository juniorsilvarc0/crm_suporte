"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { CustomerContextResult } from "@/features/customer-source/types";

export type ExternalContextState = {
  /** A 1ª leitura deste endpoint está a caminho (sem resultado ainda). */
  loading: boolean;
  /** O último resultado, ou `null` enquanto a 1ª não chegou / consulta desligada. */
  result: CustomerContextResult | null;
  /** Relê agora (o "Tentar de novo"). */
  retry: () => void;
};

/**
 * O contexto do cliente na fonte externa (TCBX), buscado sob demanda de uma rota
 * que devolve `{ ok, result }` com um `CustomerContextResult`. Genérico pelo
 * endpoint: o painel do chat consulta por contato, a ficha da empresa por
 * empresa — a mesma máquina de estados serve os dois. Uma leitura por endpoint;
 * a resposta de um endpoint antigo é descartada se outro foi aberto no meio.
 * Falha de rede vira `unavailable` — nunca "sem dados".
 *
 * `result`/`loading` são DERIVADOS do que chegou (guardado com o endpoint), não
 * sincronizados por efeito: trocar de alvo já mostra "carregando" sem um
 * `setState` dentro do `useEffect` (que renderiza em cascata).
 */
export function useExternalContext(endpoint: string | null, enabled: boolean): ExternalContextState {
  const [entry, setEntry] = useState<{ endpoint: string; result: CustomerContextResult } | null>(null);
  const tokenRef = useRef(0);

  const load = useCallback(() => {
    if (!enabled || !endpoint) return;
    const current = endpoint;
    const token = ++tokenRef.current;
    const settle = (result: CustomerContextResult) => {
      if (token === tokenRef.current) setEntry({ endpoint: current, result });
    };
    fetch(current)
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error(String(response.status)))
      )
      .then((body: { ok?: boolean; result?: CustomerContextResult }) =>
        settle(body?.ok && body.result ? body.result : { state: "unavailable" })
      )
      .catch(() => settle({ state: "unavailable" }));
  }, [endpoint, enabled]);

  useEffect(() => {
    load();
  }, [load]);

  // O resultado só vale se for DESTE endpoint; enquanto não chega, é "carregando".
  const result = entry && entry.endpoint === endpoint ? entry.result : null;
  const loading = Boolean(enabled && endpoint) && result === null;

  return { loading, result, retry: load };
}
