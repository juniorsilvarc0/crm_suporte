// Regras da lista do CatalogCombobox, isoladas da UI para serem testáveis.
// Porte da mecânica do combobox de catálogo do legado (tag `legado-clinica`),
// com o valor como OBJETO com id — nunca texto solto.

/** Item de catálogo que o combobox escolhe (produto, plano…). */
export type CatalogOption = {
  id: string;
  name: string;
  /** Nome da paleta (features/tags/schemas/colors.ts): vira o ponto de cor. */
  color?: string | null;
  /** Texto de apoio à direita, em cinza. */
  hint?: string | null;
  /** Item arquivado: só aparece quando já é o valor atual. */
  archived?: boolean;
};

/** Linha da lista: um item do catálogo ou a linha "Criar «X»". */
export type CatalogEntry =
  | ({ kind: "item" } & CatalogOption)
  | { kind: "create"; name: string };

/** Comparação sem acento e sem caixa: "suporte" acha "Suporte", "gestao" acha "Gestão". */
export function normalizeCatalogText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

// Mesmo mínimo dos schemas de criação (produto e plano: 2 a 80 caracteres).
const MIN_CHARS_TO_CREATE = 2;

export function toCatalogEntry(option: CatalogOption): CatalogEntry {
  return {
    kind: "item",
    id: option.id,
    name: option.name,
    color: option.color ?? null,
    hint: option.hint ?? null,
    archived: option.archived ?? false,
  };
}

/** Devolve o item sem o `kind`, campo a campo. */
export function toCatalogOption(entry: Extract<CatalogEntry, { kind: "item" }>): CatalogOption {
  return {
    id: entry.id,
    name: entry.name,
    color: entry.color ?? null,
    hint: entry.hint ?? null,
    archived: entry.archived ?? false,
  };
}

/** Igualdade para o Base UI: item por id, "Criar" pelo nome. Nunca por referência. */
export function isSameCatalogEntry(a: CatalogEntry, b: CatalogEntry): boolean {
  if (a.kind === "item" && b.kind === "item") return a.id === b.id;
  if (a.kind === "create" && b.kind === "create") return a.name === b.name;
  return false;
}

/**
 * Monta a lista visível do combobox:
 *
 * 1. itens do catálogo que casam com o termo, menos os já escolhidos
 *    (`chosen`, os chips do modo "adder");
 * 2. o valor atual (`selected`, modo "single"), quando ele não está no
 *    catálogo — arquivado, ou criado agora e ainda sem `router.refresh()`.
 *    Sem isso a escolha sumiria da lista;
 * 3. "Criar «termo»", só com `canCreate`, 2+ caracteres e sem casar exatamente
 *    com um item — contando o valor atual e os já escolhidos, senão a linha
 *    ofereceria criar um repetido.
 */
export function buildCatalogEntries({
  options,
  term,
  selected = null,
  chosen = [],
  canCreate,
}: {
  options: readonly CatalogOption[];
  term: string;
  selected?: CatalogOption | null;
  chosen?: readonly CatalogOption[];
  canCreate: boolean;
}): CatalogEntry[] {
  const normalizedTerm = normalizeCatalogText(term);
  const matchesTerm = (name: string) =>
    !normalizedTerm || normalizeCatalogText(name).includes(normalizedTerm);
  const chosenIds = new Set(chosen.map((option) => option.id));

  const entries: CatalogEntry[] = options
    .filter((option) => !chosenIds.has(option.id) && matchesTerm(option.name))
    .map(toCatalogEntry);

  if (
    selected &&
    !chosenIds.has(selected.id) &&
    !options.some((option) => option.id === selected.id) &&
    matchesTerm(selected.name)
  ) {
    entries.push(toCatalogEntry(selected));
  }

  const trimmedTerm = term.trim();
  if (canCreate && trimmedTerm.length >= MIN_CHARS_TO_CREATE) {
    const known = [...options, ...chosen, ...(selected ? [selected] : [])];
    const exactExists = known.some(
      (option) => normalizeCatalogText(option.name) === normalizedTerm
    );
    if (!exactExists) entries.push({ kind: "create", name: trimmedTerm });
  }

  return entries;
}

/**
 * Lê o item que a rota de criação devolve (`item` do POST, ou do 409 quando o
 * nome já existia). Só o que o combobox usa; o resto do registro é ignorado.
 * `null` = resposta sem um item legível.
 */
export function parseCreatedCatalogItem(raw: unknown): CatalogOption | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  if (typeof item.id !== "string" || typeof item.name !== "string") return null;
  return {
    id: item.id,
    name: item.name,
    color: typeof item.color === "string" ? item.color : null,
    hint: null,
    archived: item.archived_at !== null && item.archived_at !== undefined,
  };
}
