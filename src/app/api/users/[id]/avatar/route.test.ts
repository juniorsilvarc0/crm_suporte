// @vitest-environment node
// Rota com multipart: o `formData()` precisa do Request do Node (no jsdom ele trava).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "11111111-1111-4111-8111-111111111111";

const rpc = vi.fn();
const upload = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/require-dashboard-session", () => ({
  getDashboardViewer: vi.fn(async () => ({ id: USER_ID, role: "admin" })),
}));
vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: () => true,
  createSupabaseAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { id: USER_ID, email: "a@exemplo.test", name: "Ana", role: "admin", avatar_url: null, avatar_color: "slate", is_active: true },
          }),
        }),
      }),
    }),
    storage: {
      from: () => ({
        upload,
        // O supabase-js monta a URL pública com o SUPABASE_URL interno e tira a
        // porta padrão — é exatamente o que chega aqui em produção.
        getPublicUrl: (path: string) => ({ data: { publicUrl: `http://gateway/storage/v1/object/public/profile-avatars/${path}` } }),
      }),
    },
    rpc,
  }),
}));

import { POST } from "@/app/api/users/[id]/avatar/route";

// PNG mínimo: a rota valida a assinatura real dos bytes, não o Content-Type.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function uploadRequest() {
  const form = new FormData();
  form.append("image", new File([PNG], "foto.png", { type: "image/png" }));
  return new Request(`http://localhost/api/users/${USER_ID}/avatar`, { method: "POST", body: form });
}

describe("POST /api/users/[id]/avatar", () => {
  beforeEach(() => {
    vi.stubEnv("SUPABASE_URL", "http://gateway:80");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://api.exemplo.test");
    upload.mockResolvedValue({ error: null });
    rpc.mockResolvedValue({ error: null });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("grava e devolve a foto com a origem PÚBLICA, nunca com o host interno do gateway", async () => {
    const response = await POST(uploadRequest(), { params: Promise.resolve({ id: USER_ID }) });
    if (!response) throw new Error("a rota não respondeu");
    const body = (await response.json()) as { ok: boolean; avatarUrl: string };

    expect(response.status).toBe(200);
    expect(body.avatarUrl).toMatch(/^https:\/\/api\.exemplo\.test\/storage\/v1\/object\/public\/profile-avatars\/app-users\//);
    const gravado = rpc.mock.calls[0][1] as { p_avatar_url: string };
    expect(gravado.p_avatar_url).toBe(body.avatarUrl);
    expect(gravado.p_avatar_url).not.toContain("gateway");
  });
});
