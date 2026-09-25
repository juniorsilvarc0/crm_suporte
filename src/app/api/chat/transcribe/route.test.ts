import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getConfigMock,
  adminClientMock,
  messageSingleMock,
  updateMock,
  updateEqMock,
  fetchMock,
  userGuardMock,
} = vi.hoisted(() => ({
  getConfigMock: vi.fn(),
  adminClientMock: vi.fn(),
  messageSingleMock: vi.fn(),
  updateMock: vi.fn(),
  updateEqMock: vi.fn(),
  fetchMock: vi.fn(),
  userGuardMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({
  requireDashboardUser: userGuardMock,
}));

vi.mock("@/features/settings/lib/get-runtime-environment", () => ({
  getOpenAiTranscriptionConfig: getConfigMock,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: adminClientMock,
}));

import { POST } from "@/app/api/chat/transcribe/route";

function request() {
  return new Request("http://x/api/chat/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messageId: "message-1" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  userGuardMock.mockResolvedValue({ viewer: { id: "user-1" } });
  getConfigMock.mockResolvedValue({
    apiKey: "openai-key",
    model: "gpt-4o-mini-transcribe",
  });
  messageSingleMock.mockResolvedValue({
    data: {
      id: "message-1",
      conversation_id: "conversation-1",
      external_id: "external-1",
      media_url: "data:audio/ogg;base64,YXVkaW8=",
      media_mime_type: "audio/ogg",
      metadata: {},
    },
    error: null,
  });
  updateEqMock.mockResolvedValue({ error: null });
  updateMock.mockReturnValue({ eq: updateEqMock });
  adminClientMock.mockReturnValue({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ single: messageSingleMock })),
      })),
      update: updateMock,
    })),
  });
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ text: "Áudio transcrito" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  );
});

describe("POST /api/chat/transcribe", () => {
  it("recusa usuário inativo sem ler a mensagem nem chamar a OpenAI", async () => {
    // Transcrever custa dinheiro: cookie válido de alguém desativado não pode
    // disparar a chamada.
    userGuardMock.mockResolvedValue({
      error: Response.json({ ok: false, message: "Sessão inválida." }, { status: 401 }),
    });

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(adminClientMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("usa chave e modelo resolvidos pela configuração segura", async () => {
    const response = await POST(request());
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const form = options.body as FormData;

    expect(response.status).toBe(200);
    expect(options.headers).toEqual({ Authorization: "Bearer openai-key" });
    expect(form.get("model")).toBe("gpt-4o-mini-transcribe");
    expect(form.get("language")).toBe("pt");
    expect(updateMock).toHaveBeenCalledWith({
      metadata: { transcription: "Áudio transcrito" },
    });
  });

  it("não consulta mensagens quando a chave não existe", async () => {
    getConfigMock.mockResolvedValue({ apiKey: null, model: "whisper-1" });

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(adminClientMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
