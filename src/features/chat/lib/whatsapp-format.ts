// Formatação de texto do WhatsApp: `*negrito*`, `_itálico_`, `~riscado~`,
// `` `mono` `` e o bloco ```pré-formatado```.
//
// O WhatsApp NÃO reescreve o texto ao enviar — o que trafega é o texto cru com
// os marcadores, e cada cliente renderiza. Por isso isto é só leitura: nada
// aqui altera o que é gravado ou enviado.
//
// Devolve uma árvore de nós em vez de HTML **de propósito**. O conteúdo vem de
// desconhecidos pela API do WhatsApp; montar HTML e jogar num
// `dangerouslySetInnerHTML` seria XSS com passo de entrada aberto.

export type FormattedNode =
  | { type: "text"; value: string }
  | { type: "bold" | "italic" | "strike" | "mono"; children: FormattedNode[] }
  /** Bloco ``` — conteúdo literal, sem formatação interna. */
  | { type: "block"; value: string };

const MARKERS: Record<string, "bold" | "italic" | "strike" | "mono"> = {
  "*": "bold",
  _: "italic",
  "~": "strike",
  "`": "mono",
};

const WORD = /[\p{L}\p{N}]/u;

/**
 * Marcador de abertura precisa de "colo": vem no início, depois de espaço ou de
 * pontuação — nunca grudado numa palavra. É o que impede `2*3*4` de virar
 * negrito, igual ao WhatsApp.
 */
function opensHere(input: string, index: number): boolean {
  const marker = input[index];
  const before = index > 0 ? input[index - 1] : "";
  const after = input[index + 1] ?? "";

  if (before && WORD.test(before)) return false;
  if (!after || after === marker) return false;
  return !/\s/.test(after);
}

/** Fechamento válido: colado no conteúdo e não seguido de letra ou número. */
function findClosing(input: string, from: number, marker: string): number {
  for (let i = from; i < input.length; i += 1) {
    if (input[i] !== marker) continue;
    const before = input[i - 1] ?? "";
    const after = input[i + 1] ?? "";
    if (/\s/.test(before)) continue;
    if (after && WORD.test(after)) continue;
    return i;
  }
  return -1;
}

/**
 * Marcador sem par fica literal — o WhatsApp faz o mesmo, e é o que salva um
 * "*" solto no meio da frase de virar formatação bagunçada.
 */
export function parseWhatsappText(input: string): FormattedNode[] {
  const nodes: FormattedNode[] = [];
  let buffer = "";
  let i = 0;

  const flush = () => {
    if (buffer) {
      nodes.push({ type: "text", value: buffer });
      buffer = "";
    }
  };

  while (i < input.length) {
    const char = input[i];

    // Bloco ``` vem primeiro: dentro dele nada mais é marcador.
    if (char === "`" && input.startsWith("```", i)) {
      const end = input.indexOf("```", i + 3);
      if (end !== -1) {
        flush();
        nodes.push({ type: "block", value: input.slice(i + 3, end) });
        i = end + 3;
        continue;
      }
    }

    const kind = MARKERS[char];
    if (kind && opensHere(input, i)) {
      const close = findClosing(input, i + 1, char);
      if (close > i + 1) {
        flush();
        nodes.push({ type: kind, children: parseWhatsappText(input.slice(i + 1, close)) });
        i = close + 1;
        continue;
      }
    }

    buffer += char;
    i += 1;
  }

  flush();
  return nodes;
}

/** O texto sem marcador nenhum — para prévia de conversa e citação. */
export function stripWhatsappFormat(input: string): string {
  return parseWhatsappText(input)
    .map(function render(node): string {
      if (node.type === "text") return node.value;
      if (node.type === "block") return node.value;
      return node.children.map(render).join("");
    })
    .join("");
}
