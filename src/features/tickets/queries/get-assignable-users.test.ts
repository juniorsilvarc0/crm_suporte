import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectMock, orderIdMock, hasEnvMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
  orderIdMock: vi.fn(),
  hasEnvMock: vi.fn(() => true),
}));

vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: hasEnvMock,
  createSupabaseAdminClient: () => ({
    from: () => ({
      select: (columns: string) => {
        selectMock(columns);
        return { order: () => ({ order: orderIdMock }) };
      },
    }),
  }),
}));

import { getAssignableUsers } from "@/features/tickets/queries/get-assignable-users";

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "user-1",
  name: "Ana Lima",
  avatar_color: "violet",
  avatar_url: null,
  is_active: true,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  hasEnvMock.mockReturnValue(true);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("getAssignableUsers", () => {
  it("deve pedir só id, nome, avatar e ativo — nunca e-mail nem papel", async () => {
    orderIdMock.mockResolvedValue({ data: [], error: null });

    await getAssignableUsers();

    const columns = selectMock.mock.calls[0]?.[0] as string;
    expect(columns.split(",").map((column) => column.trim())).toEqual([
      "id",
      "name",
      "avatar_color",
      "avatar_url",
      "is_active",
    ]);
    expect(columns).not.toMatch(/email|role|password/);
  });

  it("deve devolver a equipe campo a campo, inativos inclusive", async () => {
    orderIdMock.mockResolvedValue({
      data: [row(), row({ id: "user-2", name: "Bruno", is_active: false, email: "b@x.com" })],
      error: null,
    });

    expect(await getAssignableUsers()).toEqual([
      row(),
      row({ id: "user-2", name: "Bruno", is_active: false }),
    ]);
  });

  it("deve devolver null quando a leitura falha, nunca lista vazia", async () => {
    orderIdMock.mockResolvedValue({ data: null, error: { message: "boom" } });

    expect(await getAssignableUsers()).toBeNull();
    expect(console.error).toHaveBeenCalledWith("getAssignableUsers failed", "boom");
  });

  it("deve devolver null sem o ambiente do Supabase admin", async () => {
    hasEnvMock.mockReturnValue(false);

    expect(await getAssignableUsers()).toBeNull();
    expect(selectMock).not.toHaveBeenCalled();
  });
});
