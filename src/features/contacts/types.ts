import type { CustomerSummary } from "@/features/customers/types";

// Tipos e constantes da lista de contatos. Neutro: a query (servidor), a página
// e a tabela (client) importam daqui — o client não pode puxar
// queries/get-contacts-page, que traz o supabase admin junto.

// Filtro "Empresa" da lista (?empresa=). "todos" é o padrão e fica fora da URL;
// valor fora da lista vira "todos" (parseContactListParams).
export const CONTACT_COMPANY_FILTERS = ["todos", "com", "sem"] as const;

export type ContactCompanyFilter = (typeof CONTACT_COMPANY_FILTERS)[number];

export type ContactListParams = {
  q: string;
  empresa: ContactCompanyFilter;
  page: number;
};

// Escrito à mão, nunca derivado do Row de contacts: só o que a tabela mostra.
export type ContactListItem = {
  id: string;
  name: string | null;
  phone: string;
  last_message_at: string | null;
  customer: CustomerSummary | null;
};

// `failed` = a leitura deu erro: a tela diz "não foi possível carregar", nunca
// "nenhum contato ainda".
export type ContactsPage = {
  items: ContactListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  failed: boolean;
};
