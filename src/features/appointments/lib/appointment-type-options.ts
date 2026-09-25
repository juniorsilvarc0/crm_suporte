import type { AppointmentType } from "@/features/appointments/lib/agenda-config";

/**
 * Lista visível do combobox de tipo de atendimento.
 *
 * ⚠️ **É irmã de `features/financeiro/lib/procedure-options.ts`, e é duplicação
 * de propósito.** Este é o segundo uso do padrão, e a regra do projeto manda
 * duplicar no segundo e abstrair no terceiro (AGENTS §0.2.2). Se aparecer um
 * terceiro catálogo com criar/arquivar em linha, aí sim extraia — as duas
 * versões divergem em detalhe (procedimento carrega valor de referência, tipo
 * de atendimento não) e generalizar cedo custaria um parâmetro genérico só para
 * unir 30 linhas.
 */
export type AppointmentTypeOption =
  /** Item do catálogo. */
  | { kind: "catalog"; id: string; name: string }
  /** Tipo já escolhido que saiu do catálogo — a escolha não se perde. */
  | { kind: "orphan"; id: null; name: string }
  /** Linha "Criar «X»". */
  | { kind: "create"; id: null; name: string };

/** Sem acento e sem caixa: "primeira" acha "Primeira consulta". */
export function normalizeTypeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

const MIN_CHARS_TO_CREATE = 2;

export function buildAppointmentTypeOptions({
  items,
  term,
  selectedName,
}: {
  items: AppointmentType[];
  term: string;
  selectedName?: string | null;
}): AppointmentTypeOption[] {
  const normalizedTerm = normalizeTypeName(term);
  const options: AppointmentTypeOption[] = [];

  const matches = normalizedTerm
    ? items.filter((item) => normalizeTypeName(item.name).includes(normalizedTerm))
    : items;

  for (const item of matches) {
    options.push({ kind: "catalog", id: item.id, name: item.name });
  }

  // O agendamento guarda TEXTO, não id: arquivar um tipo não pode apagar a
  // escolha de quem está preenchendo, nem o histórico já gravado.
  const selected = selectedName?.trim();
  if (selected) {
    const inCatalog = items.some(
      (item) => normalizeTypeName(item.name) === normalizeTypeName(selected)
    );
    const matchesTerm = !normalizedTerm || normalizeTypeName(selected).includes(normalizedTerm);
    if (!inCatalog && matchesTerm) {
      options.push({ kind: "orphan", id: null, name: selected });
    }
  }

  const trimmedTerm = term.trim();
  const exactExists = options.some(
    (option) => normalizeTypeName(option.name) === normalizedTerm
  );
  if (trimmedTerm.length >= MIN_CHARS_TO_CREATE && !exactExists) {
    options.push({ kind: "create", id: null, name: trimmedTerm });
  }

  return options;
}
