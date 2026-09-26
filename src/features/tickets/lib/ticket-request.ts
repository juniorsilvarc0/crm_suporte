import type { TicketTakeOverErrorBody } from "@/features/tickets/types";

/**
 * Uma requisição às rotas de ticket (`/api/tickets/**`) e a leitura do corpo.
 *
 * É o 3º uso (AGENTS §0.2.2): a lista (`tickets-table`) e o detalhe
 * (`useTicketMutation`) faziam o mesmo fetch à mão, e o chat e o Início são o
 * terceiro. Neutro (sem "use client"): só `fetch` e tipos.
 *
 * Nunca lança. Sucesso é HTTP 2xx **e** `ok: true` no corpo; o resto volta como
 * recusa, com o corpo de erro das rotas (`code`, `message`, `errors`, `allowed`,
 * `current`, `current_version`, `assigned_to_user_id`, `assigned_to_name`)
 * quando ele veio. Corpo que não é JSON dá `body: null`.
 */

export type TicketRequestMethod = "GET" | "POST" | "PATCH" | "PUT";

export type TicketRequestInit = {
  /** Padrão `GET`. */
  method?: TicketRequestMethod;
  /** Vai como JSON. Sem corpo, a requisição sai sem `Content-Type`. */
  body?: Record<string, unknown>;
  signal?: AbortSignal;
};

/**
 * Resposta recusada. `status` 0 = a requisição nem chegou (rede) ou foi
 * cancelada pelo `signal`: quem cancelou confere o próprio `signal`.
 */
export type TicketRequestFailure = {
  ok: false;
  status: number;
  body: TicketTakeOverErrorBody | null;
};

/** `data` é o corpo inteiro de sucesso (com o `ok: true`). */
export type TicketRequestResult<Data> = { ok: true; data: Data } | TicketRequestFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function ticketRequest<Data>(
  url: string,
  { method = "GET", body, signal }: TicketRequestInit = {}
): Promise<TicketRequestResult<Data>> {
  const init: RequestInit =
    body === undefined
      ? { method }
      : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  // Só quando existe: quem compara o `init` inteiro não vê `signal: undefined`.
  if (signal) init.signal = signal;

  try {
    const response = await fetch(url, init);
    const payload: unknown = await response.json().catch(() => null);
    if (response.ok && isRecord(payload) && payload.ok === true) {
      return { ok: true, data: payload as Data };
    }
    return {
      ok: false,
      status: response.status,
      body: isRecord(payload) ? ({ ...payload, ok: false } as TicketTakeOverErrorBody) : null,
    };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

/**
 * A 1ª mensagem de campo do corpo de erro (`errors`, o do zod e o do serviço),
 * ou `undefined`. É o texto do toast quando o erro é de um input.
 */
export function ticketFieldError(body: TicketTakeOverErrorBody | null): string | undefined {
  return Object.values(body?.errors ?? {}).find((messages) => messages?.[0])?.[0];
}
