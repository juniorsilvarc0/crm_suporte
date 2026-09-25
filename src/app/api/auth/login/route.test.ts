// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: () => true,
  createSupabaseAdminClient: () => ({ rpc: rpcMock }),
}));

import { POST } from "@/app/api/auth/login/route";
import { AUTH_COOKIE } from "@/lib/auth/session";

// O rate limit é por IP e mora na memória do processo: cada teste usa um IP
// próprio para não herdar tentativas do anterior.
let ip = 0;
function loginRequest() {
  ip += 1;
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${ip}` },
    body: JSON.stringify({ email: "ana@exemplo.com", password: "senha1234" }),
  });
}

const user = (role: string) => ({ id: "user-1", email: "ana@exemplo.com", name: "Ana", role });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_JWT_SECRET = "segredo-de-teste-com-mais-de-32-caracteres";
});

describe("POST /api/auth/login", () => {
  it("abre sessão para um papel conhecido", async () => {
    rpcMock.mockResolvedValue({ data: [user("member")], error: null });

    const response = await POST(loginRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain(`${AUTH_COOKIE}=`);
  });

  it("recusa papel que o app não conhece, sem emitir cookie", async () => {
    // O papel de tráfego pago saiu do app, mas o banco ainda aceita o valor:
    // quem sobrou com ele não pode entrar como se fosse membro.
    rpcMock.mockResolvedValue({ data: [user("paid_traffic")], error: null });

    const response = await POST(loginRequest());

    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("recusa credencial errada com 401", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });

    const response = await POST(loginRequest());

    expect(response.status).toBe(401);
  });
});
