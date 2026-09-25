// Regras da lista do combobox de procedimentos, isoladas da UI para serem
// testáveis — molde de features/deals/lib/attendance.ts.

export type Procedure = {
  id: string;
  name: string;
  defaultAmount: number | null;
};

export type ProcedureOption =
  /** Item do catálogo. */
  | { kind: "catalog"; id: string; name: string; defaultAmount: number | null }
  /** Procedimento já escolhido que saiu do catálogo — o valor não se perde. */
  | { kind: "orphan"; id: null; name: string; defaultAmount: null }
  /** Linha "Criar «X»". */
  | { kind: "create"; id: null; name: string; defaultAmount: null };

/** Comparação sem acento e sem caixa: "rezum" acha "Rezum", "próstata" acha "prostata". */
export function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

const MIN_CHARS_TO_CREATE = 2;

/**
 * Monta a lista visível do combobox:
 *
 * 1. itens do catálogo que casam com o termo;
 * 2. o valor já escolhido, quando ele não está mais no catálogo (arquivado em
 *    outra aba, por exemplo) — sem isso, apagar o procedimento apagaria a
 *    escolha do operador no meio do preenchimento;
 * 3. "Criar «termo»", só com 2+ caracteres e sem casar exatamente com um item
 *    existente (senão a linha aparece competindo com o próprio item).
 */
export function buildProcedureOptions({
  items,
  term,
  selectedName,
}: {
  items: Procedure[];
  term: string;
  selectedName?: string | null;
}): ProcedureOption[] {
  const normalizedTerm = normalize(term);
  const options: ProcedureOption[] = [];

  const matches = normalizedTerm
    ? items.filter((item) => normalize(item.name).includes(normalizedTerm))
    : items;

  for (const item of matches) {
    options.push({
      kind: "catalog",
      id: item.id,
      name: item.name,
      defaultAmount: item.defaultAmount,
    });
  }

  const selected = selectedName?.trim();
  if (selected) {
    const inCatalog = items.some((item) => normalize(item.name) === normalize(selected));
    const matchesTerm = !normalizedTerm || normalize(selected).includes(normalizedTerm);
    if (!inCatalog && matchesTerm) {
      options.push({ kind: "orphan", id: null, name: selected, defaultAmount: null });
    }
  }

  const trimmedTerm = term.trim();
  const exactExists = options.some((option) => normalize(option.name) === normalizedTerm);
  if (trimmedTerm.length >= MIN_CHARS_TO_CREATE && !exactExists) {
    options.push({ kind: "create", id: null, name: trimmedTerm, defaultAmount: null });
  }

  return options;
}
