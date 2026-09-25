import { createHash, randomBytes } from "node:crypto";

import { siteConfig } from "@/config/site";

// Prefixo legível que identifica um token deste CRM (estilo "sk_..."). Deriva
// da marca, sem hífen: o slug `crm-suporte` vira `crmsuporte_…`.
const TOKEN_PREFIX = siteConfig.slug.replace(/-/g, "");

export type GeneratedApiToken = {
  // Token em texto puro — exibido UMA única vez ao usuário, nunca persistido.
  token: string;
  // Hash sha256 (hex) que é gravado no banco e comparado no verify.
  hash: string;
  // Primeiros caracteres do token, guardados para exibição na listagem.
  prefix: string;
};

// sha256 em hex — determinístico, sem sal (o token já tem 256 bits de entropia,
// então não é uma senha; o hash serve para lookup indexado e para não guardar
// o segredo em texto puro).
export function hashApiToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Gera um novo token de API: `crmsuporte_` + 32 bytes aleatórios em base64url.
export function generateApiToken(): GeneratedApiToken {
  const raw = randomBytes(32).toString("base64url");
  const token = `${TOKEN_PREFIX}_${raw}`;
  return {
    token,
    hash: hashApiToken(token),
    prefix: token.slice(0, 12),
  };
}
