// @vitest-environment node
// jose usa Web Crypto e checa `instanceof Uint8Array`; no ambiente jsdom o
// Uint8Array é de outro realm e a checagem falha. session.ts é código de
// servidor, então este teste roda no ambiente node.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createSessionToken,
  verifySessionToken,
  type SessionUser,
} from "@/lib/auth/session";

const user = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "ana@exemplo.com",
  name: "Ana",
  role: "admin" as const,
};

describe("JWT de sessão", () => {
  beforeEach(() => {
    process.env.AUTH_JWT_SECRET = "test-secret-com-mais-de-32-caracteres-0123456789";
  });
  afterEach(() => {
    delete process.env.AUTH_JWT_SECRET;
  });

  it("faz roundtrip de assinar e verificar", async () => {
    const token = await createSessionToken(user);
    expect(await verifySessionToken(token)).toEqual(user);
  });

  it("rejeita o papel de tráfego pago, que deixou de existir", async () => {
    // Cookie emitido antes da remoção do papel não pode virar sessão válida.
    const trafficUser = { ...user, role: "paid_traffic" } as unknown as SessionUser;
    const token = await createSessionToken(trafficUser);
    expect(await verifySessionToken(token)).toBeNull();
  });

  it("rejeita papel desconhecido", async () => {
    const invalidUser = { ...user, role: "unknown" } as unknown as SessionUser;
    const token = await createSessionToken(invalidUser);
    expect(await verifySessionToken(token)).toBeNull();
  });

  it("rejeita token ausente ou vazio", async () => {
    expect(await verifySessionToken(undefined)).toBeNull();
    expect(await verifySessionToken(null)).toBeNull();
    expect(await verifySessionToken("")).toBeNull();
  });

  it("rejeita token adulterado", async () => {
    const token = await createSessionToken(user);
    expect(await verifySessionToken(`${token}x`)).toBeNull();
  });

  it("rejeita token assinado com outro segredo", async () => {
    const token = await createSessionToken(user);
    process.env.AUTH_JWT_SECRET = "outro-secret-com-mais-de-32-caracteres-0123456789";
    expect(await verifySessionToken(token)).toBeNull();
  });
});
