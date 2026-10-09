import type { Database } from "@/lib/supabase/types";

import type { FollowupKind } from "@/features/followups/lib/followup-kind";
import type { FollowupStatus } from "@/features/followups/lib/followup-status";

type FollowupRow = Database["public"]["Tables"]["followups"]["Row"];

/** O ticket a que o retorno pertence, como o embed devolve. */
export type FollowupTicket = {
  id: string;
  number: number;
  title: string;
  status: string;
};

/**
 * Um follow-up como a UI consome: a linha, com `kind`/`status` já estreitados
 * pelos type guards, e o ticket embutido (para a fila cruzar tickets).
 */
export type FollowupListItem = Omit<FollowupRow, "kind" | "status"> & {
  kind: FollowupKind;
  status: FollowupStatus;
  ticket: FollowupTicket | null;
};
