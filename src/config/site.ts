/**
 * Marca do produto, num lugar só. O `name` aparece na interface; o `slug` gera
 * os identificadores técnicos (cookie de sessão, prefixo dos tokens de API,
 * origem das mensagens na uazapi). Trocar a marca = trocar este arquivo e os
 * logos em `public/brand/` e `src/app/icon.png`.
 */
export const siteConfig = {
  name: "CRM Suporte",
  description: "CRM de atendimento de suporte técnico — chamados pelo WhatsApp, triagem por IA e integração por API.",
  slug: "crm-suporte",
} as const;
