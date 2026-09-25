// @vitest-environment node
// Mesmo motivo do `session.test.ts`: o jose checa `instanceof Uint8Array`, e no
// jsdom o Uint8Array vem de outro realm. Este módulo é de servidor, não precisa
// de DOM nenhum.
import { decodeJwt, jwtVerify } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createSupabaseAccessToken,
  SUPABASE_TOKEN_TTL_SECONDS,
} from "@/lib/auth/supabase-token";

const SECRET = "segredo-de-teste-com-mais-de-32-caracteres-aqui";

afterEach(() => {
  delete process.env.SUPABASE_JWT_SECRET;
});

describe("createSupabaseAccessToken", () => {
  it("emite um token que o Supabase aceita: role authenticated e audience", async () => {
    process.env.SUPABASE_JWT_SECRET = SECRET;

    const { token } = await createSupabaseAccessToken("user-1", "admin");
    const { payload } = await jwtVerify(token, new TextEncoder().encode(SECRET));

    expect(payload.role).toBe("authenticated");
    expect(payload.aud).toBe("authenticated");
    expect(payload.sub).toBe("user-1");
  });

  it("carrega o papel do app no claim — é o que a RLS usa para separar quem opera o chat", async () => {
    process.env.SUPABASE_JWT_SECRET = SECRET;

    for (const papel of ["admin", "member"] as const) {
      const { token } = await createSupabaseAccessToken("user-1", papel);
      expect(decodeJwt(token).app_role).toBe(papel);
    }
  });

  it("não promove ninguém: o papel de banco é sempre `authenticated`, nunca o papel do app", async () => {
    process.env.SUPABASE_JWT_SECRET = SECRET;

    // Se `role` recebesse o papel do app, o Postgres tentaria assumir um papel
    // "admin" inexistente — ou, pior, um que exista com privilégios.
    const { token } = await createSupabaseAccessToken("user-1", "admin");
    expect(decodeJwt(token).role).toBe("authenticated");
  });

  it("expira em 15 minutos, e o expiresAt devolvido bate com o exp do token", async () => {
    process.env.SUPABASE_JWT_SECRET = SECRET;

    const { token, expiresAt } = await createSupabaseAccessToken("user-1", "admin");
    const payload = decodeJwt(token);

    expect(payload.exp).toBe(expiresAt);
    expect(expiresAt - (payload.iat as number)).toBe(SUPABASE_TOKEN_TTL_SECONDS);
  });

  it("não é aceito por outro segredo — é isto que separa o token do Supabase do cookie de sessão", async () => {
    process.env.SUPABASE_JWT_SECRET = SECRET;

    const { token } = await createSupabaseAccessToken("user-1", "admin");
    const outro = new TextEncoder().encode("outro-segredo-com-mais-de-32-caracteres!!");

    await expect(jwtVerify(token, outro)).rejects.toThrow();
  });

  it("recusa segredo curto em produção em vez de assinar com fallback de desenvolvimento", async () => {
    // `stubEnv` porque `process.env.NODE_ENV` não aceita `defineProperty`.
    vi.stubEnv("SUPABASE_JWT_SECRET", "curto");
    vi.stubEnv("NODE_ENV", "production");

    await expect(createSupabaseAccessToken("user-1", "admin")).rejects.toThrow(
      /SUPABASE_JWT_SECRET/
    );

    vi.unstubAllEnvs();
  });

  it("em desenvolvimento assina com o segredo do compose local, para o ambiente subir sem configuração", async () => {
    vi.stubEnv("NODE_ENV", "development");
    delete process.env.SUPABASE_JWT_SECRET;

    const { token } = await createSupabaseAccessToken("user-1", "admin");
    const demo = new TextEncoder().encode(
      "super-secret-jwt-token-with-at-least-32-characters-long"
    );

    await expect(jwtVerify(token, demo)).resolves.toBeTruthy();
    vi.unstubAllEnvs();
  });
});
