"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { invalidTransitionMessage } from "@/features/tickets/lib/ticket-actions";
import {
  ticketFieldError,
  ticketRequest,
  type TicketRequestFailure,
} from "@/features/tickets/lib/ticket-request";
import type { TicketStatusKey, TicketStatusOption } from "@/features/tickets/types";

const FAILURE_MESSAGE = "Não foi possível concluir a operação.";
const NETWORK_MESSAGE = "Não foi possível concluir a operação. Confira a conexão e tente de novo.";
const CONFLICT_MESSAGE = "Este ticket mudou em outro lugar. A tela foi atualizada; confira e repita a ação.";

/** Uma escrita do detalhe: PATCH do ticket, assign, transition, take-over ou o foco. */
export type TicketRequest = {
  /** Qual ação está em voo: o botão dela mostra o spinner. */
  key: string;
  url: string;
  method: "POST" | "PATCH" | "PUT";
  body: Record<string, unknown>;
};

/** Resposta recusada. `status` 0 = a requisição nem chegou (rede). */
export type TicketFailure = TicketRequestFailure;

export type TicketRunOptions<Data> = {
  /** Texto do toast de sucesso; `null` = sem toast (ex.: `changed: false`). */
  success?: (data: Data) => string | null;
  /**
   * Roda na MESMA transição da releitura: o editor fecha quando o dado novo
   * chega, em vez de a tela piscar o valor antigo no meio.
   */
  onSuccess?: (data: Data) => void;
  /** `true` = a tela tratou o erro (campo do formulário, diálogo); o padrão não roda. */
  onFailure?: (failure: TicketFailure) => boolean;
  /** `false` = não relê a página no sucesso (ex.: a tela vai sair para o chat). */
  refresh?: boolean;
};

export type TicketMutation = {
  run: <Data>(request: TicketRequest, options?: TicketRunOptions<Data>) => Promise<boolean>;
  /** A ação em voo, ou `null`. */
  pendingKey: string | null;
  /**
   * Ação em voo OU releitura depois dela: enquanto a página nova não chega, a
   * tela ainda tem a versão de antes, e uma 2ª ação voltaria "mudou em outro lugar".
   */
  busy: boolean;
  refreshing: boolean;
  /** O último envio deu 409 `version_conflict`: a tela mostra o alerta no topo. */
  conflict: boolean;
  dismissConflict: () => void;
  refresh: () => void;
};

/**
 * As escritas do detalhe do ticket, com UM tratamento de erro para todas (sem
 * Realtime de tickets: cada sucesso faz `router.refresh()`):
 *
 * - 409 `version_conflict` → alerta "mudou em outro lugar" + toast + releitura
 *   (no celular a lateral fica abaixo da timeline, e o alerta no topo sai da tela);
 * - 409 `invalid_transition` → toast "De X só vai para A, B" + releitura;
 * - 404 e o resto dos 409 (encerrado, já atribuído) → toast + releitura;
 * - o resto → toast com o erro do campo ou a mensagem da rota.
 *
 * Uma escrita por vez: a trava é uma ref, porque o `pendingKey` só desabilita
 * os botões no próximo render. `status` e `statuses` são os do render atual
 * (o toast da transição inválida usa os rótulos do catálogo).
 */
export function useTicketMutation({
  status,
  statuses,
}: {
  status: TicketStatusKey;
  statuses: TicketStatusOption[] | null;
}): TicketMutation {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const inFlight = useRef(false);

  function refresh() {
    startRefresh(() => router.refresh());
  }

  function handleFailure(failure: TicketFailure) {
    const { status: httpStatus, body } = failure;
    if (httpStatus === 0) {
      toast.error(NETWORK_MESSAGE);
      return;
    }
    if (body?.code === "version_conflict") {
      setConflict(true);
      toast.error(CONFLICT_MESSAGE);
      refresh();
      return;
    }
    if (body?.code === "invalid_transition") {
      toast.error(
        invalidTransitionMessage(
          { message: body.message ?? FAILURE_MESSAGE, allowed: body.allowed, current: body.current },
          status,
          statuses
        )
      );
      refresh();
      return;
    }
    toast.error(ticketFieldError(body) ?? body?.message ?? FAILURE_MESSAGE);
    // A tela está velha (ticket encerrado, já atribuído, sumiu): relê.
    if (httpStatus === 404 || httpStatus === 409) refresh();
  }

  async function run<Data>(
    request: TicketRequest,
    options: TicketRunOptions<Data> = {}
  ): Promise<boolean> {
    if (inFlight.current) return false;
    inFlight.current = true;
    setPendingKey(request.key);

    let failure: TicketFailure;
    try {
      const result = await ticketRequest<Data>(request.url, {
        method: request.method,
        body: request.body,
      });

      if (result.ok) {
        const data = result.data;
        setConflict(false);
        const message = options.success?.(data) ?? null;
        if (message) toast.success(message);
        if (options.refresh === false) {
          options.onSuccess?.(data);
        } else {
          startRefresh(() => {
            options.onSuccess?.(data);
            router.refresh();
          });
        }
        return true;
      }
      failure = result;
    } finally {
      inFlight.current = false;
      setPendingKey(null);
    }

    if (!options.onFailure?.(failure)) handleFailure(failure);
    return false;
  }

  return {
    run,
    pendingKey,
    busy: pendingKey !== null || refreshing,
    refreshing,
    conflict,
    dismissConflict: () => setConflict(false),
    refresh,
  };
}
