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
 * /api/contacts/{id}/external-context). A rota resolve pela empresa (CNPJ) ou
 * pelo telefone do contato, então busca para qualquer conversa com contato. Uma
 * leitura por contato; a resposta de um contato antigo é descartada se outro foi
 * aberto no meio. Falha de rede vira `unavailable` — nunca "sem dados".
 *
 * `result`/`loading` são DERIVADOS do que chegou (guardado com o id do contato),
 * não sincronizados por efeito: trocar de contato já mostra "carregando" sem um
 * `setState` dentro do `useEffect` (que renderiza em cascata).
 */
export function useCustomerContext(contactId: string | null, enabled: boolean): UseCustomerContext {
  const [entry, setEntry] = useState<{ id: string; result: CustomerContextResult } | null>(null);
  const tokenRef = useRef(0);

  const load = useCallback(() => {
    if (!enabled || !contactId) return;
    const id = contactId;
    const token = ++tokenRef.current;
    const settle = (result: CustomerContextResult) => {
      if (token === tokenRef.current) setEntry({ id, result });
    };
    fetch(`/api/contacts/${id}/external-context`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((body: { ok?: boolean; result?: CustomerContextResult }) =>
        settle(body?.ok && body.result ? body.result : { state: "unavailable" })
      )
      .catch(() => settle({ state: "unavailable" }));
  }, [contactId, enabled]);

  useEffect(() => {
    load();
  }, [load]);

  // O resultado só vale se for DESTE contato; enquanto não chega, é "carregando".
  const result = entry && entry.id === contactId ? entry.result : null;
  const loading = Boolean(enabled && contactId) && result === null;

  return { loading, result, retry: load };
}
