import { z } from "zod";

import { FOLLOWUP_KINDS } from "@/features/followups/lib/followup-kind";
import { FOLLOWUP_STATUSES } from "@/features/followups/lib/followup-status";
import { localDateTimeToIso } from "@/lib/formatters/date";

// Compartilhado entre o diálogo e as rotas. O `done_at` NÃO entra aqui: a rota o
// deriva do status (concluido → now(); pendente/cancelado → null), para honrar o
// invariante do banco `(status='concluido') = (done_at is not null)`. O
// `ticket_id` só existe na criação — um retorno não troca de ticket.

function blankToNull(value: string | null): string | null {
  return value ? value : null;
}

const notes = z
  .string("Observações inválidas.")
  .trim()
  .max(5000, "Observações muito longas.")
  .nullable()
  .transform(blankToNull);

// "AAAA-MM-DDTHH:MM" → ISO; vazio/inválido reprova.
const dueAt = z
  .string("Informe o prazo.")
  .refine((value) => localDateTimeToIso(value) !== "", "Prazo inválido.")
  .transform((value) => localDateTimeToIso(value));

export const followupCreateSchema = z
  .object({
    ticket_id: z.uuid("Ticket inválido."),
    due_at: dueAt,
    kind: z.enum(FOLLOWUP_KINDS),
    notes: notes.optional(),
  })
  .strict();

export const followupUpdateSchema = z
  .object({
    due_at: dueAt,
    kind: z.enum(FOLLOWUP_KINDS),
    notes: notes,
    status: z.enum(FOLLOWUP_STATUSES),
  })
  .partial()
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), "Nada para atualizar.");

export type FollowupCreateInput = z.infer<typeof followupCreateSchema>;
export type FollowupUpdateInput = z.infer<typeof followupUpdateSchema>;
