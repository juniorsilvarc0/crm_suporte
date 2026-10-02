import { API_SCOPES } from "@/lib/api/v1/scopes";

// Como a tela de tokens mostra cada escopo da API v1. Neutro: o diálogo de
// edição (client) e os testes importam daqui. O código do escopo aparece junto,
// em fonte mono: é ele que a documentação da API e o agente usam.

const RESOURCE_LABELS: Record<string, string> = {
  context: "Contexto da triagem",
  contacts: "Contatos",
  customers: "Empresas",
  catalog: "Catálogos (filas, categorias e status)",
  tickets: "Tickets",
  comments: "Comentários internos",
  attachments: "Anexos",
  conversations: "Conversas",
  messages: "Mensagens",
  notices: "Avisos",
};

const ACTION_LABELS: Record<string, string> = {
  read: "Ler",
  write: "Criar e editar",
  handoff: "Passar para um humano",
  send: "Enviar ao cliente",
  claim: "Reivindicar",
  "*": "Todas as ações, inclusive as que vierem",
};

function split(scope: string): [resource: string, action: string] {
  const index = scope.indexOf(":");
  return [scope.slice(0, index), scope.slice(index + 1)];
}

export function scopeResourceLabel(resource: string): string {
  return RESOURCE_LABELS[resource] ?? resource;
}

/** A ação do escopo em português; a que a tela não conhece aparece como veio. */
export function scopeActionLabel(scope: string): string {
  const [, action] = split(scope);
  return ACTION_LABELS[action] ?? action;
}

export type ScopeGroup = { resource: string; label: string; scopes: string[] };

/**
 * Os escopos do catálogo agrupados por recurso, na ordem do catálogo, mais os
 * que o token tem e o catálogo não lista (`recurso:*`): eles continuam na
 * tela, marcados, e não somem ao salvar.
 */
export function scopeGroups(tokenScopes: readonly string[] = []): ScopeGroup[] {
  const extras = tokenScopes.filter((scope) => !(API_SCOPES as readonly string[]).includes(scope));
  const groups = new Map<string, string[]>();
  for (const scope of [...API_SCOPES, ...extras]) {
    const [resource] = split(scope);
    groups.set(resource, [...(groups.get(resource) ?? []), scope]);
  }
  return [...groups].map(([resource, scopes]) => ({ resource, label: scopeResourceLabel(resource), scopes }));
}

