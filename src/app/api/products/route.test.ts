import { beforeEach, describe, expect, it, vi } from "vitest";

const { adminMock, adminClientMock, fromMock, insertMock, ilikeMock } = vi.hoisted(() => ({
  adminMock: vi.fn(),
  adminClientMock: vi.fn(),
  fromMock: vi.fn(),
  insertMock: vi.fn(),
  ilikeMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({
  requireDashboardAdmin: adminMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: () => true,
  createSupabaseAdminClient: adminClientMock,
}));

import { POST as createProduct } from "@/app/api/products/route";
import { POST as createPlan } from "@/app/api/support-plans/route";

type DbError = { code: string; message: string };

const PRODUCT = {
  id: "8f9bc40b-8b1c-4b17-bbb8-fb6d00fc9c07",
  name: "ERP Varejo",
  niche: null,
  color: "slate",
  archived_at: null,
};
const PLAN = {
  id: "2c1e6a52-4f0b-4f7e-9d59-0b8f7d1c3a11",
  name: "Ouro",
  description: null,
  archived_at: null,
};

// Resposta do insert e da 2ª leitura (o item que já existe, no 409).
let inserted: { data: unknown; error: DbError | null };
let lookup: { data: unknown[] | null; error: DbError | null };

function post(body: unknown) {
  return new Request("http://x/api/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function duplicate(constraint: string): DbError {
  return {
    code: "23505",
    message: `duplicate key value violates unique constraint "${constraint}"`,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  adminMock.mockResolvedValue({ viewer: { id: "admin-1", role: "admin" } });
  inserted = { data: PRODUCT, error: null };
  lookup = { data: [], error: null };

  insertMock.mockReturnValue({
    select: vi.fn(() => ({ single: vi.fn(async () => inserted) })),
  });
  ilikeMock.mockReturnValue({
    is: vi.fn(() => ({ limit: vi.fn(async () => lookup) })),
  });
  fromMock.mockReturnValue({
    insert: insertMock,
    select: vi.fn(() => ({ ilike: ilikeMock })),
  });
  adminClientMock.mockReturnValue({ from: fromMock });
});

describe("POST /api/products", () => {
  it("member → 403 sem acessar o banco", async () => {
    adminMock.mockResolvedValue({
      error: Response.json(
        { ok: false, message: "Apenas administradores podem executar esta ação." },
        { status: 403 }
      ),
    });

    const response = await createProduct(post({ name: "ERP Varejo" }));

    expect(response.status).toBe(403);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("nasce slate e sem nicho quando só o nome vem", async () => {
    const response = await createProduct(post({ name: "  ERP Varejo  " }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(fromMock).toHaveBeenCalledWith("products");
    expect(insertMock).toHaveBeenCalledWith({ name: "ERP Varejo", niche: null, color: "slate" });
    expect(json).toEqual({ ok: true, message: "Produto criado.", item: PRODUCT });
  });

  it("cor fora da paleta → 400 sem gravar", async () => {
    const response = await createProduct(post({ name: "ERP Varejo", color: "magenta" }));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.errors.color).toEqual(["Cor inválida."]);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("nicho em branco vira null; chave desconhecida → 400", async () => {
    await createProduct(post({ name: "ERP Varejo", niche: "   ", color: "emerald" }));
    expect(insertMock).toHaveBeenCalledWith({ name: "ERP Varejo", niche: null, color: "emerald" });

    const response = await createProduct(post({ name: "ERP Varejo", archived_at: null }));
    expect(response.status).toBe(400);
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it("nome curto → 400 no campo", async () => {
    const response = await createProduct(post({ name: "E" }));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.errors.name).toEqual(["Use ao menos 2 caracteres."]);
  });

  it("nome repetido → 409 no campo, devolvendo o produto que já existe", async () => {
    inserted = { data: null, error: duplicate("products_name_active_uidx") };
    lookup = { data: [PRODUCT], error: null };

    const response = await createProduct(post({ name: "erp varejo" }));
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(ilikeMock).toHaveBeenCalledWith("name", "erp varejo");
    expect(json).toEqual({
      ok: false,
      message: "Já existe um produto com este nome.",
      errors: { name: ["Já existe um produto com este nome."] },
      item: PRODUCT,
    });
  });

  it("409 escapa os curingas e não devolve um homônimo aproximado", async () => {
    inserted = { data: null, error: duplicate("products_name_active_uidx") };
    // `_` casa qualquer caractere: o banco pode devolver outro nome.
    lookup = { data: [{ ...PRODUCT, name: "ERP 10x" }], error: null };

    const response = await createProduct(post({ name: "ERP 10%*" }));
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(ilikeMock).toHaveBeenCalledWith("name", "ERP 10\\%_");
    expect(json.item).toBeUndefined();
  });

  it("erro inesperado → 500 sem repassar a mensagem do banco", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    inserted = { data: null, error: { code: "42501", message: "permission denied for table products" } };

    const response = await createProduct(post({ name: "ERP Varejo" }));
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.message).toBe("Não foi possível concluir a operação.");
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("POST /api/support-plans", () => {
  it("member → 403 sem acessar o banco", async () => {
    adminMock.mockResolvedValue({
      error: Response.json({ ok: false, message: "Sem permissão." }, { status: 403 }),
    });

    const response = await createPlan(post({ name: "Ouro" }));

    expect(response.status).toBe(403);
    expect(adminClientMock).not.toHaveBeenCalled();
  });

  it("cria o plano com descrição vazia como null", async () => {
    inserted = { data: PLAN, error: null };

    const response = await createPlan(post({ name: " Ouro ", description: "" }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(fromMock).toHaveBeenCalledWith("support_plans");
    expect(insertMock).toHaveBeenCalledWith({ name: "Ouro", description: null });
    expect(json).toEqual({ ok: true, message: "Plano criado.", item: PLAN });
  });

  it("preço no corpo → 400 (plano não tem valor)", async () => {
    const response = await createPlan(post({ name: "Ouro", monthly_amount: 100 }));

    expect(response.status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("nome repetido → 409 no campo, devolvendo o plano que já existe", async () => {
    inserted = { data: null, error: duplicate("support_plans_name_active_uidx") };
    lookup = { data: [PLAN], error: null };

    const response = await createPlan(post({ name: "OURO" }));
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.errors).toEqual({ name: ["Já existe um plano com este nome."] });
    expect(json.item).toEqual(PLAN);
  });

  it("409 sem conseguir reler o plano ainda responde 409, sem item", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    inserted = { data: null, error: duplicate("support_plans_name_active_uidx") };
    lookup = { data: null, error: { code: "57014", message: "timeout" } };

    const response = await createPlan(post({ name: "Ouro" }));
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.item).toBeUndefined();
    consoleError.mockRestore();
  });
});
