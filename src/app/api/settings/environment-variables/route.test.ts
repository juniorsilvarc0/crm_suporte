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
    ["curta", "1"],
    ["31 caracteres", "a".repeat(31)],
    ["com espaço no meio", `${"a".repeat(20)} ${"b".repeat(20)}`],
    ["com quebra de linha colada no fim", `${"a".repeat(40)}\n`],
    ["só espaços", " ".repeat(40)],
  ])("chave de assinatura do relay %s é recusada, sem gravar", async (_label, value) => {
    const response = await POST(request("POST", { name: " relay_signing_secret ", value }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errors.value[0]).toContain("32 caracteres ou mais, sem espaços");
    expect(JSON.stringify(body)).not.toContain(value.trim() || "a".repeat(40));
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("chave de assinatura do relay com 32 caracteres sem espaço é gravada", async () => {
    const value = "f".repeat(32);

    const response = await POST(request("POST", { name: "RELAY_SIGNING_SECRET", value, replace: true }));

    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("set_app_environment_variable", {
      p_name: "RELAY_SIGNING_SECRET",
      p_value: value,
      p_replace: true,
    });
  });

  it("o piso é só da chave de assinatura: outra variável aceita valor curto", async () => {
    const response = await POST(request("POST", { name: "OUTRA_CHAVE", value: "x" }));

    expect(response.status).toBe(200);
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
    expect(revalidatePathMock).toHaveBeenCalledWith("/app/configuracoes");
  });

  it("responde 404 quando a variável já não existe", async () => {
    rpcMock.mockResolvedValue({ data: false, error: null });

    const response = await DELETE(request("DELETE", { name: "MINHA_CHAVE" }));

    expect(response.status).toBe(404);
  });
});
