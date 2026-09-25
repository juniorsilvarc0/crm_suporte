import { z } from "zod";

/** Cores de post-it. Literais estáticos — o Tailwind v4 não vê classe montada. */
export const NOTE_COLORS = ["amber", "teal", "sky", "rose", "violet"] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export const noteColorClass: Record<NoteColor, string> = {
  amber: "bg-amber-100 text-amber-950 dark:bg-amber-300/25 dark:text-amber-50",
  teal: "bg-teal-100 text-teal-950 dark:bg-teal-300/25 dark:text-teal-50",
  sky: "bg-sky-100 text-sky-950 dark:bg-sky-300/25 dark:text-sky-50",
  rose: "bg-rose-100 text-rose-950 dark:bg-rose-300/25 dark:text-rose-50",
  violet: "bg-violet-100 text-violet-950 dark:bg-violet-300/25 dark:text-violet-50",
};

const CONTENT_MAX = 2000;

export const quickNoteSchema = z.object({
  content: z.string().max(CONTENT_MAX, "Lembrete muito longo."),
});

/**
 * ⚠️ Post-it VAZIO é válido, de propósito.
 *
 * Um post-it nasce em branco e o usuário digita por cima — obrigar conteúdo
 * forçava a criação com um texto de exemplo que a pessoa tinha de apagar antes
 * de escrever. Vazio também é o estado legítimo de quem limpou a nota e ainda
 * não decidiu o que pôr no lugar.
 */
export const createStickySchema = z.object({
  title: z.string().trim().max(80, "Título muito longo.").optional(),
  content: z.string().trim().max(CONTENT_MAX, "Post-it muito longo.").default(""),
  color: z.enum(NOTE_COLORS).default("amber"),
});

export const updateStickySchema = z.object({
  title: z.string().trim().max(80).nullish(),
  content: z.string().trim().max(CONTENT_MAX, "Post-it muito longo.").optional(),
  color: z.enum(NOTE_COLORS).optional(),
});

/** Nova ordem dos post-its: a posição de cada um é o índice na lista. */
export const reorderStickiesSchema = z.object({
  ids: z.array(z.string().uuid("Post-it inválido.")).max(120, "Post-its demais."),
});

export type CreateStickyInput = z.infer<typeof createStickySchema>;
export type UpdateStickyInput = z.infer<typeof updateStickySchema>;
