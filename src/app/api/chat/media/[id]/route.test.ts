// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { sessionMock, adminClientMock, signMock } = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  adminClientMock: vi.fn(),
  signMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({
  requireDashboardUser: sessionMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: adminClientMock,
}));
vi.mock("@/lib/storage/chat-media", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage/chat-media")>()),
  signStorageObject: signMock,
}));

import { GET } from "@/app/api/chat/media/[id]/route";

const ID = "8f9bc40b-8b1c-4b17-bbb8-fb6d00fc9c07";
const SIGNED = "http://localhost:54321/storage/v1/object/sign/chat-media/chat/a.webp?token=t";

let row: Record<string, unknown> | null;

function get(id = ID, query = "") {
  return GET(new Request(`http://x/api/chat/media/${id}${query}`), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  row = {
    media_bucket: "chat-media",
    media_key: "chat/2026/09/a.webp",
    metadata: { thumbKey: "chat/2026/09/a.thumb.webp" },
  };
  sessionMock.mockResolvedValue({ viewer: { id: "user-1" } });
  signMock.mockResolvedValue(SIGNED);
  const maybeSingle = vi.fn(async () => ({ data: row, error: null }));
  adminClientMock.mockReturnValue({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  });
});

describe("GET /api/chat/media/[id]", () => {
  it("recusa sem usuário ativo antes de assinar qualquer coisa", async () => {
    sessionMock.mockResolvedValue({
      error: Response.json({ ok: false }, { status: 401 }),
    });

    const response = await get();

    expect(response.status).toBe(401);
    expect(adminClientMock).not.toHaveBeenCalled();
    expect(signMock).not.toHaveBeenCalled();
  });

  it("recusa id que não é UUID", async () => {
    const response = await get("../../etc/passwd");

    expect(response.status).toBe(400);
  });

  it("redireciona para a URL assinada, com cache privado curto", async () => {
    const response = await get();

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(SIGNED);
    expect(response.headers.get("cache-control")).toBe("private, max-age=300");
    expect(signMock).toHaveBeenCalledWith(expect.anything(), "chat-media", "chat/2026/09/a.webp", 600);
  });

  it("serve a miniatura pela chave do metadata", async () => {
    await get(ID, "?variant=thumb");

    expect(signMock).toHaveBeenCalledWith(
      expect.anything(),
      "chat-media",
      "chat/2026/09/a.thumb.webp",
      600
    );
  });

  it.each([
    ["mensagem inexistente", null],
    ["mensagem apagada (sem chave)", { media_bucket: null, media_key: null, metadata: {} }],
    ["bucket que não é o do chat", { media_bucket: "profile-avatars", media_key: "x", metadata: {} }],
  ])("404 para %s", async (_label, value) => {
    row = value;

    const response = await get();

    expect(response.status).toBe(404);
    expect(signMock).not.toHaveBeenCalled();
  });

  it("404 para miniatura que não existe", async () => {
    row = { media_bucket: "chat-media", media_key: "chat/a.webp", metadata: {} };

    const response = await get(ID, "?variant=thumb");

    expect(response.status).toBe(404);
  });
});
