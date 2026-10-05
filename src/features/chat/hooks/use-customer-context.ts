"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { CustomerContextResult } from "@/features/customer-source/types";

export type UseCustomerContext = {
  /** A 1ª leitura desta empresa está a caminho (sem resultado ainda). */
  loading: boolean;
  /** O último resultado, ou `null` enquanto a 1ª não chegou / integração desligada. */
  result: CustomerContextResult | null;
  /** Relê agora (o "Tentar de novo"). */
  retry: () => void;
};

/**
 * O contexto do cliente na fonte externa, para o painel do contato (GET
 * /api/customers/{id}/external-context). Só busca quando `enabled` (a empresa
 * tem CNPJ): sem chave, não há o que consultar. Uma leitura por empresa; a
 * resposta de uma empresa antiga é descartada se outra foi aberta no meio.
 * Falha de rede vira `unavailable` — nunca "sem dados".
 *
 * `result`/`loading` são DERIVADOS do que chegou (guardado com o id da empresa),
 * não sincronizados por efeito: trocar de empresa já mostra "carregando" sem um
 * `setState` dentro do `useEffect` (que renderiza em cascata).
 */
export function useCustomerContext(customerId: string | null, enabled: boolean): UseCustomerContext {
  const [entry, setEntry] = useState<{ id: string; result: CustomerContextResult } | null>(null);
  const tokenRef = useRef(0);

  const load = useCallback(() => {
    if (!enabled || !customerId) return;
    const id = customerId;
    const token = ++tokenRef.current;
    const settle = (result: CustomerContextResult) => {
      if (token === tokenRef.current) setEntry({ id, result });
    };
    fetch(`/api/customers/${id}/external-context`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((body: { ok?: boolean; result?: CustomerContextResult }) =>
        settle(body?.ok && body.result ? body.result : { state: "unavailable" })
      )
      .catch(() => settle({ state: "unavailable" }));
  }, [customerId, enabled]);

  useEffect(() => {
    load();
  }, [load]);

  // O resultado só vale se for DESTA empresa; enquanto não chega, é "carregando".
  const result = entry && entry.id === customerId ? entry.result : null;
  const loading = Boolean(enabled && customerId) && result === null;

  return { loading, result, retry: load };
}
