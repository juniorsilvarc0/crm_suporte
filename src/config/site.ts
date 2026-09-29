/**
 * Marca do produto, num lugar só. O `name` aparece na interface; o `slug` gera
 * os identificadores técnicos (cookie de sessão, prefixo dos tokens de API,
 * origem das mensagens na uazapi) e NÃO muda num rebranding: derrubaria as
 * sessões e os tokens. Trocar a marca = trocar este arquivo, os paths de
 * `src/components/ui/logo-mark.tsx` e `src/app/icon.png`/`apple-icon.png`.
 */
export const siteConfig = {
  // O que aparece ao lado da logo. A marca é do cliente (`brand`): a logo diz
  // "ticbox", e o nome completo do produto é "<brand> <name>".
  name: "Suporte",
  brand: "Ticbox",
  description: "CRM de atendimento de suporte técnico — chamados pelo WhatsApp, triagem por IA e integração por API.",
  slug: "crm-suporte",
  // Protocolo do ticket na tela: SUP-1024 (<ticketPrefix>-<tickets.number>).
  ticketPrefix: "SUP",
} as const;
