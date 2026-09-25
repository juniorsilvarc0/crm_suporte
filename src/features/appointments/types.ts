import type { Database } from "@/lib/supabase/types";
import type { Lead } from "@/features/leads/types";

export type AppointmentLead = Pick<
  Lead,
  | "id"
  | "name"
  | "phone"
  | "email"
  | "instagram_user"
  | "status"
  | "source"
  | "tipo_ensaio"
  | "interesse"
  | "agencia_nome"
  | "modelo_nome"
  | "is_recorrente"
  | "valor_estimado"
  | "notes"
  | "created_at"
  | "last_message_at"
>;

export type Appointment = Database["public"]["Tables"]["appointments"]["Row"] & {
  leads?: AppointmentLead | null;
};

export type PendingLinkLead = {
  id: string;
  name: string | null;
  phone: string | null;
  tipo_ensaio: string | null;
  linkSentAt: string;
};

export type AppointmentBoardItem =
  | { kind: "pending_link"; lead: PendingLinkLead }
  | { kind: "appointment"; appointment: Appointment };
