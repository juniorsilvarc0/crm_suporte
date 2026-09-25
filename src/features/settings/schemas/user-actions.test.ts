import { describe, expect, it } from "vitest";

import {
  createUserSchema,
  resetPasswordSchema,
  updateUserSchema,
} from "@/features/settings/schemas/user-actions";

describe("createUserSchema", () => {
  it("aceita entrada válida e normaliza o email", () => {
    const result = createUserSchema.safeParse({
      name: "  Maria Souza ",
      email: "  Maria@Exemplo.com ",
      password: "senha1234",
      role: "member",
      avatar_color: "slate",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Maria Souza");
      // .email() valida; a normalização de caixa fica no banco (lower(trim())).
      expect(result.data.email).toBe("Maria@Exemplo.com");
    }
  });

  it("aceita o papel de tráfego pago", () => {
    const result = createUserSchema.safeParse({
      name: "Marina Tráfego",
      email: "marina@exemplo.com",
      password: "senha1234",
      role: "paid_traffic",
      avatar_color: "violet",
    });
    expect(result.success).toBe(true);
  });

  it("rejeita email inválido", () => {
    const result = createUserSchema.safeParse({
      name: "Maria",
      email: "não-é-email",
      password: "senha1234",
      role: "member",
      avatar_color: "slate",
    });
    expect(result.success).toBe(false);
  });

  it("rejeita senha com menos de 8 caracteres", () => {
    const result = createUserSchema.safeParse({
      name: "Maria",
      email: "maria@exemplo.com",
      password: "1234567",
      role: "member",
      avatar_color: "slate",
    });
    expect(result.success).toBe(false);
  });

  it("rejeita nome vazio", () => {
    const result = createUserSchema.safeParse({
      name: "   ",
      email: "maria@exemplo.com",
      password: "senha1234",
      role: "member",
      avatar_color: "slate",
    });
    expect(result.success).toBe(false);
  });
});

describe("updateUserSchema", () => {
  it("exige is_active booleano", () => {
    const ok = updateUserSchema.safeParse({
      name: "Maria",
      email: "maria@exemplo.com",
      is_active: false,
      role: "member",
      avatar_url: null,
      avatar_color: "slate",
    });
    expect(ok.success).toBe(true);

    const bad = updateUserSchema.safeParse({
      name: "Maria",
      email: "maria@exemplo.com",
      is_active: "false",
      role: "member",
      avatar_url: null,
      avatar_color: "slate",
    });
    expect(bad.success).toBe(false);
  });

  const baseUser = {
    name: "Maria",
    email: "maria@exemplo.com",
    is_active: true,
    role: "member" as const,
    avatar_color: "slate",
  };

  it("aceita avatar_url http(s)", () => {
    expect(
      updateUserSchema.safeParse({ ...baseUser, avatar_url: "https://cdn.exemplo.com/a.png" })
        .success
    ).toBe(true);
  });

  // Regressão de segurança: z.string().url() sozinho ACEITA esquemas perigosos
  // (javascript:/data:/file:), que viram XSS armazenado ao renderizar. O schema
  // precisa restringir a http(s).
  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
  ])("rejeita o esquema perigoso %s no avatar_url", (bad) => {
    expect(updateUserSchema.safeParse({ ...baseUser, avatar_url: bad }).success).toBe(false);
  });
});

describe("resetPasswordSchema", () => {
  it("rejeita senha curta", () => {
    expect(resetPasswordSchema.safeParse({ password: "curta" }).success).toBe(false);
  });
  it("aceita senha válida", () => {
    expect(resetPasswordSchema.safeParse({ password: "senha1234" }).success).toBe(true);
  });
});
