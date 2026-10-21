// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { adminClientMock, transcribeMock, configMock } = vi.hoisted(() => ({
  adminClientMock: vi.fn(),
  transcribeMock: vi.fn(),
  configMock: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: adminClientMock, hasSupabaseAdminEnv: () => true }));
vi.mock("@/features/chat/lib/transcribe-message", () => ({ transcribeChatMessage: transcribeMock }));
vi.mock("@/features/settings/lib/get-runtime-environment", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/settings/lib/get-runtime-environment")>()),
  getOpenAiTranscriptionConfig: configMock,
}));

import { POST as transcribe } from "@/app/api/v1/conversations/[id]/messages/[message_id]/transcription/route";
import { itemOf } from "@/lib/api/v1/cadastros";
import { messageTranscriptionSchema } from "@/lib/api/v1/conversations";

import { createHarness, where } from "./test-harness";

// A transcrição de áudio para a IA (v1). A transcrição em si (bytes, OpenAI,
// cache na mensagem) tem os testes da rota do analista (/api/chat/transcribe);
// aqui se confere quem pode pedir, o que é recusado e como cada desfecho sai.

const CONVERSATION = "1d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a";
const MESSAGE = "2e3f4a5b-6c7d-4e8f-9a0b-1c2d3e4f5a6b";

const h = createHarness(adminClientMock);

beforeEach(() => {
  vi.clearAllMocks();
  h.reset(["conversations:read"]);
  h.tables.chat_messages = () => ({ data: { id: MESSAGE, type: "audio", is_deleted: false }, error: null });
  configMock.mockResolvedValue({ apiKey: "sk-teste", model: "gpt-4o-mini-transcribe" });
  transcribeMock.mockResolvedValue({ ok: true, transcription: "Meu caixa não fecha", cached: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

type Params = { id: string; message_id: string };
type Handler = (request: Request, context: { params: Promise<Params> }) => Promise<Response>;
const call = (params: Params = { id: CONVERSATION, message_id: MESSAGE }) =>
  (transcribe as Handler)(h.request("/x", { method: "POST" }), { params: Promise.resolve(params) });
const silence = () => vi.spyOn(console, "error").mockImplementation(() => undefined);

describe("POST /api/v1/conversations/{id}/messages/{message_id}/transcription", () => {
  it("transcreve o áudio DESTA conversa com a chave e o modelo do cofre, no schema publicado", async () => {
    const response = await call();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(itemOf(messageTranscriptionSchema).parse(payload).data).toEqual({
      message_id: MESSAGE,
      transcription: "Meu caixa não fecha",
      cached: false,
    });
    const chain = h.lastChain("chat_messages");
    expect(where(chain, "id", MESSAGE) && where(chain, "conversation_id", CONVERSATION)).toBe(true);
    expect(transcribeMock).toHaveBeenCalledWith(expect.anything(), MESSAGE, {
      apiKey: "sk-teste",
      model: "gpt-4o-mini-transcribe",
    });
  });

  it("já transcrito sai com cached: true", async () => {
    transcribeMock.mockResolvedValue({ ok: true, transcription: "Já tinha", cached: true });

    expect((await (await call()).json()).data).toMatchObject({ transcription: "Já tinha", cached: true });
  });

  it("mensagem de outra conversa, inexistente ou id que não é UUID: 404 sem transcrever", async () => {
    h.tables.chat_messages = () => ({ data: null, error: null });
    expect((await call()).status).toBe(404);
    expect((await call({ id: "x", message_id: MESSAGE })).status).toBe(404);
    expect((await call({ id: CONVERSATION, message_id: "x" })).status).toBe(404);
    expect(transcribeMock).not.toHaveBeenCalled();
  });

  it.each([
    ["não é áudio", { id: MESSAGE, type: "text", is_deleted: false }, "not_audio"],
    ["foi apagada", { id: MESSAGE, type: "audio", is_deleted: true }, "message_deleted"],
  ])("mensagem que %s: 422 sem transcrever", async (_label, row, code) => {
    h.tables.chat_messages = () => ({ data: row, error: null });

    const response = await call();

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe(code);
    expect(transcribeMock).not.toHaveBeenCalled();
  });

  it("sem a chave da OpenAI no cofre: 503 transcription_unavailable, sem chamar a transcrição", async () => {
    configMock.mockResolvedValue({ apiKey: null, model: "whisper-1" });

    const response = await call();

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("transcription_unavailable");
    expect(transcribeMock).not.toHaveBeenCalled();
  });

  it("cofre ou banco fora: 503 unavailable com Retry-After", async () => {
    silence();
    configMock.mockRejectedValue(new Error("cofre fora"));
    let response = await call();
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("5");

    h.tables.chat_messages = () => ({ data: null, error: { code: "08006", message: "conexão caiu" } });
    response = await call();
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("unavailable");
  });

  it.each([
    ["arquivo indisponível", "audio_unavailable", 422],
    ["OpenAI falhou", "provider_failed", 502],
    ["mensagem sumiu entre as leituras", "not_found", 404],
  ])("%s: %s vira %i", async (_label, reason, status) => {
    transcribeMock.mockResolvedValue({ ok: false, reason });

    expect((await call()).status).toBe(status);
  });

  it("sem o escopo conversations:read: 403 sem ler nada", async () => {
    h.scopes = ["tickets:read"];

    const response = await call();

    expect(response.status).toBe(403);
    expect(transcribeMock).not.toHaveBeenCalled();
  });
});
