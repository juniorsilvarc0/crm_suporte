import type { UrlTab } from "@/components/layout/url-tab-state";

// As abas de /app/conexao, na ordem da tela. WhatsApp é a padrão (fora da URL).
// Neutro, sem "use client": a página lê daqui e entrega a lista ao `UrlTabs`.
export const CONNECTION_TABS = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "api", label: "API do CRM" },
  // Não desmonta ao trocar de aba: a chave gerada só aparece uma vez, e o
  // pedido pode voltar depois de o administrador ter ido a outra aba.
  { value: "agente", label: "Agente de IA", keepMounted: true },
  { value: "variaveis", label: "Variáveis" },
  { value: "registros", label: "Registros" },
  { value: "saude", label: "Saúde" },
] as const satisfies readonly [UrlTab, ...UrlTab[]];

export type ConnectionTab = (typeof CONNECTION_TABS)[number]["value"];
