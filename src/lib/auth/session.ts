import { SignJWT, jwtVerify } from "jose";

import { siteConfig } from "@/config/site";
import {
  isAppUserRole,
  type AppUserRole,
} from "@/features/settings/types";

export const AUTH_COOKIE = `${siteConfig.slug}-session`;
export const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 dias

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: AppUserRole;
};

// Segredo para assinar/verificar o JWT de sessão (HS256). Obrigatório em
// produção; em dev há um fallback inseguro só para o setup local subir.
function getAuthSecret(): Uint8Array {
  const secret = process.env.AUTH_JWT_SECRET;
  if (secret && secret.length >= 32) {
    return new TextEncoder().encode(secret);
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AUTH_JWT_SECRET ausente ou curto (mín. 32 caracteres): obrigatório em produção."
    );
  }
  return new TextEncoder().encode(
    "dev-jwt-secret-inseguro-troque-em-producao-0123456789"
  );
}

// Assina o JWT de sessão com os dados públicos do usuário (nada sensível no payload).
export async function createSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({ email: user.email, name: user.name, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${AUTH_COOKIE_MAX_AGE}s`)
    .sign(getAuthSecret());
}

// Verifica o JWT do cookie. Retorna o usuário, ou null se ausente/expirado/adulterado.
export async function verifySessionToken(
  token: string | undefined | null
): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getAuthSecret());
    if (typeof payload.sub !== "string") return null;
    if (!isAppUserRole(payload.role)) return null;
    return {
      id: payload.sub,
      email: typeof payload.email === "string" ? payload.email : "",
      name: typeof payload.name === "string" ? payload.name : "",
      role: payload.role,
    };
  } catch {
    return null;
  }
}
