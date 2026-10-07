"use client";

import {
  useExternalContext,
  type ExternalContextState,
} from "@/features/customer-source/use-external-context";

export type UseCustomerContext = ExternalContextState;

/**
 * O contexto do cliente na fonte externa, para o painel do contato no chat (GET
 * /api/contacts/{id}/external-context). A rota resolve pela empresa (CNPJ) ou
 * pelo telefone do contato, então busca para qualquer conversa com contato.
 *
 * É um atalho fino sobre `useExternalContext`: monta o endpoint do contato e
 * herda dele a resiliência (descarte de resposta velha, `unavailable` em falha).
 */
export function useCustomerContext(contactId: string | null, enabled: boolean): UseCustomerContext {
  return useExternalContext(
    contactId ? `/api/contacts/${contactId}/external-context` : null,
    enabled
  );
}
