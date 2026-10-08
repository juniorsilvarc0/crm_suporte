import type { Database } from "@/lib/supabase/types";

import type { AppointmentKind } from "@/features/appointments/lib/appointment-kind";
import type { AppointmentStatus } from "@/features/appointments/lib/appointment-status";

type AppointmentRow = Database["public"]["Tables"]["appointments"]["Row"];

/** A empresa vinculada, como o embed da query devolve. */
export type AppointmentCustomer = {
  id: string;
  legal_name: string;
  trade_name: string | null;
};

/** O contato vinculado. */
export type AppointmentContact = {
  id: string;
  name: string | null;
  phone: string;
};

/** O ticket de origem. */
export type AppointmentTicket = {
  id: string;
  number: number;
  title: string;
  status: string;
};

/** O técnico responsável (app_user). */
export type AppointmentAssignee = {
  id: string;
  name: string;
};

/**
 * Um compromisso como a lista o consome: a linha + os vínculos embutidos. O
 * `kind`/`status` chegam como `string` do banco; a UI estreita com os type
 * guards (`isAppointmentKind`/`isAppointmentStatus`).
 */
export type AppointmentListItem = Omit<AppointmentRow, "kind" | "status"> & {
  kind: AppointmentKind;
  status: AppointmentStatus;
  customer: AppointmentCustomer | null;
  contact: AppointmentContact | null;
  ticket: AppointmentTicket | null;
  assignee: AppointmentAssignee | null;
};
