import { beforeEach, describe, expect, it, vi } from "vitest";

const { maybeSingleMock, orderMock } = vi.hoisted(() => ({
  maybeSingleMock: vi.fn(),
  orderMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: () => true,
  createSupabaseAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: maybeSingleMock }),
        order: orderMock,
      }),
    }),
  }),
}));

import { getAppUser, getAppUsers } from "@/features/settings/queries/get-app-users";

const row = (role: string) => ({
  id: "user-1",
  email: "ana@exemplo.com",
  name: "Ana",
  is_active: true,
  role,
  avatar_url: null,
  avatar_color: "sky",
  must_change_password: false,
  apelido_atendimento: null,
  assinar_mensagens: true,
  created_at: "2026-09-25T10:00:00Z",
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("getAppUser", () => {
  it("devolve o usuário com papel conhecido", async () => {
    maybeSingleMock.mockResolvedValue({ data: row("member"), error: null });

    expect(await getAppUser("user-1")).toEqual(row("member"));
  });

  it("falha fechado com papel que o app não conhece", async () => {
    // Um `paid_traffic` que sobrasse no banco não pode herdar o acesso de
    // `member`: sem viewer, a sessão cai.
    maybeSingleMock.mockResolvedValue({ data: row("paid_traffic"), error: null });

    expect(await getAppUser("user-1")).toBeNull();
  });
});

describe("getAppUsers", () => {
  it("omite da lista quem tem papel desconhecido", async () => {
    orderMock.mockResolvedValue({ data: [row("admin"), row("paid_traffic")], error: null });

    expect(await getAppUsers()).toEqual([row("admin")]);
  });
});
