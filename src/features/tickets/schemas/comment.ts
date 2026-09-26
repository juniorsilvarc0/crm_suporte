import { z } from "zod";

import { isPgSafeText, PG_UNSAFE_TEXT_MESSAGE } from "@/features/tickets/schemas/ticket";

// Compartilhado entre o composer de comentário do detalhe e as rotas
// POST /api/tickets/[id]/comments e PATCH …/comments/[commentId]: a mesma regra
// nos dois lados. O banco confere de novo (ticket_comments_body_check). O autor
// nunca vem do corpo: a rota o tira da sessão, e .strict() responde 400 a quem
// o mandar.

// Mesmo teto de ticket_comments_body_check. Depois do trim: só espaços é
// comentário vazio, e o banco recusa texto em branco.
const body = z
  .string("Escreva o comentário.")
  .trim()
  .min(1, "Escreva o comentário.")
  .max(5000, "Máximo de 5.000 caracteres.")
  .refine(isPgSafeText, PG_UNSAFE_TEXT_MESSAGE);

export const ticketCommentSchema = z.object({ body }).strict();

// Values = o que o formulário edita (z.input); Input = o que a rota grava
// depois do parse (z.output).
export type TicketCommentValues = z.input<typeof ticketCommentSchema>;
export type TicketCommentInput = z.output<typeof ticketCommentSchema>;
