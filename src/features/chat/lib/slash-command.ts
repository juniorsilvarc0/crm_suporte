import type { QuickReply } from "@/features/quick-replies/types";

/**
 * O `/` do compositor: quando abrir a lista de respostas rápidas e qual escolher.
 *
 * Regra pura, fora do componente, porque é onde mora a decisão que erra fácil —
 * abrir a lista na hora errada é pior que não abrir: rouba o Enter e o ↑↓ de
 * quem só queria escrever "das 8/9h".
 */

/** Mesmo alfabeto do `shortcutSchema` (quick-replies/schemas.ts). */
const SLASH = /^\/([a-zA-Z0-9_-]*)$/;

/**
 * Termo digitado depois da barra, ou `null` quando a lista NÃO deve abrir.
 *
 * O gatilho é a barra no **começo do compositor**, e só. É o que o WhatsApp
 * faz, e é o que evita o falso positivo: data ("8/9"), fração ("1/2") e
 * endereço ("a/c") têm barra no meio e não são comando.
 *
 * `""` é resposta válida — a barra sozinha abre a lista inteira.
 */
export function readSlashCommand(value: string): string | null {
  const match = SLASH.exec(value);
  return match ? match[1].toLocaleLowerCase("pt-BR") : null;
}

/**
 * Respostas que casam com o termo, na ordem em que ajudam.
 *
 * Prefixo do atalho primeiro: quem digita `/te` está mirando `/teste`, não uma
 * resposta cujo texto por acaso contém "te". Inativa fica de fora — ela nem é
 * inserível no seletor, e oferecer aqui seria mentir sobre o que "inativa" é.
 */
export function matchQuickReplies(
  items: QuickReply[],
  term: string
): QuickReply[] {
  const active = items.filter((item) => item.is_active);
  if (!term) return active;

  const rank = (item: QuickReply): number => {
    const shortcut = item.shortcut.toLocaleLowerCase("pt-BR");
    const title = item.title.toLocaleLowerCase("pt-BR");
    if (shortcut.startsWith(term)) return 0;
    if (title.startsWith(term)) return 1;
    if (shortcut.includes(term)) return 2;
    if (title.includes(term)) return 3;
    return 4;
  };

  return active
    .map((item) => ({ item, score: rank(item) }))
    .filter((entry) => entry.score < 4)
    .sort((a, b) => a.score - b.score)
    .map((entry) => entry.item);
}

/**
 * Índice seguinte na lista, circulando nas pontas.
 *
 * Circular porque a lista é curta e o dedo/seta não deve parar numa parede —
 * chegar no fim e voltar ao topo é o comportamento de todo menu de comando.
 */
export function nextSlashIndex(
  current: number,
  total: number,
  step: 1 | -1
): number {
  if (total <= 0) return 0;
  return (current + step + total) % total;
}
