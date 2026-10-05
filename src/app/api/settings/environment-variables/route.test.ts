import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const { requireAdminMock, rpcMock, revalidatePathMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  rpcMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/auth/require-dashboard-session", () => ({
  requireDashboardAdmin: requireAdminMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: () => true,
  createSupabaseAdminClient: () => ({ rpc: rpcMock }),
}));

import { DELETE, POST } from "@/app/api/settings/environment-variables/route";

function request(method: "POST" | "DELETE", body: unknown) {
  return new Request("http://x/api/settings/environment-variables", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({ viewer: { id: "admin-1", role: "admin" } });
  rpcMock.mockResolvedValue({ data: true, error: null });
});

describe("POST /api/settings/environment-variables", () => {
  it("recusa não-admin antes de gravar", async () => {
    requireAdminMock.mockResolvedValue({
      error: NextResponse.json({ ok: false }, { status: 403 }),
    });

    const response = await POST(request("POST", { name: "CHAVE", value: "valor" }));

    expect(response.status).toBe(403);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("normaliza a chave e nunca devolve o segredo", async () => {
    const response = await POST(
      request("POST", { name: " openai_api_key ", value: "segredo-teste" })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("set_app_environment_variable", {
      p_name: "OPENAI_API_KEY",
      p_value: "segredo-teste",
      p_replace: false,
    });
    expect(body).toEqual({
      ok: true,
      name: "OPENAI_API_KEY",
      message: "Variável salva com segurança.",
    });
    expect(JSON.stringify(body)).not.toContain("segredo-teste");
  });

  it("recusa modelo OpenAI fora da allowlist", async () => {
    const response = await POST(
      request("POST", {
        name: "OPENAI_TRANSCRIPTION_MODEL",
        value: "modelo-inexistente",
      })
    );

    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it.each([
    ["nome bem formado que o app não lê", "OUTRA_CHAVE"],
    ["o antigo endereço do agente por variável", "N8N_WEBHOOK_URL"],
  ])("chave fora do catálogo (%s) é recusada, sem gravar", async (_label, name) => {
    const response = await POST(request("POST", { name, value: "valor-qualquer" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errors.name).toEqual([
      "O cofre só guarda as chaves que o CRM usa: OPENAI_API_KEY, OPENAI_TRANSCRIPTION_MODEL, CUSTOMER_SOURCE_URL, CUSTOMER_SOURCE_TOKEN.",
    ]);
    expect(JSON.stringify(body)).not.toContain("valor-qualquer");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it.each([
    ["valor forte", "f".repeat(64)],
    ["valor curto", "1"],
  ])("a chave de assinatura não se grava à mão (%s): quem gera é o CRM", async (_label, value) => {
    const response = await POST(
      request("POST", { name: " relay_signing_secret ", value, replace: true })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errors.name).toEqual(["A chave de assinatura é gerada pelo CRM, em Agente de IA."]);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("não substitui silenciosamente uma chave existente", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "23505" } });

    const response = await POST(
      request("POST", { name: "OPENAI_API_KEY", value: "novo", replace: false })
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.errors.name[0]).toContain("Substituir");
  });
});

describe("DELETE /api/settings/environment-variables", () => {
  it("remove somente pelo nome normalizado", async () => {
    const response = await DELETE(request("DELETE", { name: " minha_chave " }));

    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("delete_app_environment_variable", {
      p_name: "MINHA_CHAVE",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/app/conexao");
  });

  it("responde 404 quando a variável já não existe", async () => {
    rpcMock.mockResolvedValue({ data: false, error: null });

    const response = await DELETE(request("DELETE", { name: "MINHA_CHAVE" }));

    expect(response.status).toBe(404);
  });

  it("a chave de assinatura não sai por aqui, e a resposta diz por onde", async () => {
    const response = await DELETE(request("DELETE", { name: " relay_signing_secret " }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      message: "A chave de assinatura é gerada pelo CRM, em Agente de IA.",
    });
    expect(rpcMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it.each([
    ["nome mal formado", { name: "1-chave" }],
    ["sem nome", {}],
    ["nome que não é texto", { name: 42 }],
    // Corpo que não é objeto: o erro não é do campo `name`, e a mensagem ainda vem.
    ["corpo nulo", null],
    ["corpo em lista", ["OPENAI_API_KEY"]],
    ["corpo em texto", "OPENAI_API_KEY"],
  ])("%s: 400 `Variável inválida.`, sem tocar o cofre", async (_label, body) => {
    const response = await DELETE(request("DELETE", body));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, message: "Variável inválida." });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
