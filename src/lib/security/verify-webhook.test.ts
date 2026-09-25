// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { hashApiToken } from "@/lib/security/api-token";
import { verifyWebhookAuth, verifyWebhookSecret } from "@/lib/security/verify-webhook";
import type { Database } from "@/lib/supabase/types";

function req(secret?: string) {
  return new Request("http://x", {
    headers: secret ? { "x-webhook-secret": secret } : {},
  });
}

function reqBearer(token: string) {
  return new Request("http://x", {
    headers: { authorization: `Bearer ${token}` },
  });
}

// Fake mínimo do client Supabase que atende as chamadas de verifyWebhookAuth:
//   api_tokens.select().eq().is().maybeSingle()  e  api_tokens.update().eq()
//
// IMPORTANTE — o fake do UPDATE é PREGUIÇOSO de propósito, igual ao supabase-js
// de verdade: `.eq()` devolve um thenable e a query só EXECUTA quando alguém
// chama `.then()` (ou dá await). Um fake ansioso (que executasse já no `.eq()`)
// esconderia o bug real: um `void builder` sem `.then()` monta a query e nunca a
// dispara. Este mock reprova esse código.
function makeSupabase(data: { id: string } | null) {
  // Só é chamado quando a query é de fato CONSUMIDA.
  const updateExecuted = vi.fn(
    async (_obj: Record<string, unknown>, _col: string, _val: string) => ({
      error: null,
    })
  );
  const selectEq = vi.fn((_col: string, _val: string) => ({
    is: (_col2: string, _val2: null) => ({
      maybeSingle: async () => ({ data }),
    }),
  }));
  const fromSpy = vi.fn((_table: string) => ({
    select: (_cols: string) => ({ eq: selectEq }),
    update: (obj: Record<string, unknown>) => ({
      eq: (col: string, val: string) => ({
        // thenable preguiçoso: nada acontece até alguém chamar .then()
        then<TResult1 = unknown, TResult2 = never>(
          onFulfilled?:
            | ((value: { error: null }) => TResult1 | PromiseLike<TResult1>)
            | null,
          onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
        ) {
          return updateExecuted(obj, col, val).then(onFulfilled, onRejected);
        },
      }),
    }),
  }));
  const client = { from: fromSpy };
  return {
    client: client as unknown as SupabaseClient<Database>,
    fromSpy,
    selectEq,
    updateExecuted,
  };
}

describe("verifyWebhookSecret", () => {
  it("500 quando o segredo esperado não está configurado (fail-closed)", async () => {
    const res = verifyWebhookSecret(req("abc"), undefined);
    expect(res?.status).toBe(500);
    expect(await res!.json()).toMatchObject({ error: "webhook_secret_missing" });
  });

  it("401 quando o header x-webhook-secret está ausente", () => {
    expect(verifyWebhookSecret(req(), "segredo")?.status).toBe(401);
  });

  it("401 quando o header não bate com o segredo", () => {
    expect(verifyWebhookSecret(req("errado"), "segredo")?.status).toBe(401);
  });

  it("null (deixa passar) quando o header bate", () => {
    expect(verifyWebhookSecret(req("segredo"), "segredo")).toBeNull();
  });
});

describe("verifyWebhookAuth", () => {
  it("retorna null quando o header x-webhook-secret bate com o envSecret, sem consultar o token", async () => {
    const { client, fromSpy } = makeSupabase(null);

    const result = await verifyWebhookAuth(req("segredo-env"), client, "segredo-env");

    expect(result).toBeNull();
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it("retorna null quando o header Authorization: Bearer bate com o envSecret", async () => {
    const { client, fromSpy } = makeSupabase(null);

    const result = await verifyWebhookAuth(reqBearer("segredo-env"), client, "segredo-env");

    expect(result).toBeNull();
    expect(fromSpy).not.toHaveBeenCalled();
  });

  // Regressão: o update de last_used_at precisa ser EXECUTADO, não só montado.
  // O builder do supabase-js é preguiçoso; um `void supabase...eq(...)` sem
  // `.then()` nunca dispara o HTTP e a coluna "último uso" fica sempre nula.
  it("EXECUTA de fato o update de last_used_at quando o token de API é válido", async () => {
    const apiToken = "crmsuporte_token-valido";
    const { client, selectEq, updateExecuted } = makeSupabase({ id: "row-1" });

    const result = await verifyWebhookAuth(reqBearer(apiToken), client, "segredo-env");

    expect(result).toBeNull();
    expect(selectEq).toHaveBeenCalledWith("token_hash", hashApiToken(apiToken));
    // Se o código só montar a query sem consumi-la, este spy NÃO é chamado.
    expect(updateExecuted).toHaveBeenCalledTimes(1);
    const [patch, col, val] = updateExecuted.mock.calls[0];
    expect(patch).toHaveProperty("last_used_at");
    expect(col).toBe("id");
    expect(val).toBe("row-1");
  });

  it("não derruba o webhook se o registro de uso falhar (token já autenticado)", async () => {
    const { client, updateExecuted } = makeSupabase({ id: "row-1" });
    updateExecuted.mockRejectedValueOnce(new Error("banco indisponível"));

    const result = await verifyWebhookAuth(
      reqBearer("crmsuporte_token-valido"),
      client,
      "segredo-env"
    );

    expect(result).toBeNull();
  });

  it("401 quando o token de API é desconhecido (não encontrado no banco)", async () => {
    const { client, updateExecuted } = makeSupabase(null);

    const result = await verifyWebhookAuth(reqBearer("crmsuporte_token-invalido"), client, "segredo-env");

    expect(result?.status).toBe(401);
    expect(updateExecuted).not.toHaveBeenCalled();
  });

  it("401 quando nenhum header de credencial é enviado", async () => {
    const { client } = makeSupabase(null);

    const result = await verifyWebhookAuth(req(), client, "segredo-env");

    expect(result?.status).toBe(401);
    expect(await result!.json()).toMatchObject({ error: "unauthorized" });
  });
});
