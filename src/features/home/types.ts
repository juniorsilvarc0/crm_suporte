import type { NoteColor } from "@/features/home/schemas/note";
import type { PatientSex } from "@/features/patients/types";

/** Pessoa como a tela de Início a apresenta: quem é + o que vem a seguir. */
export type HomePerson = {
  id: string;
  name: string | null;
  phone: string | null;
  status: string;
  /** Próximo agendamento futuro, quando existe. */
  nextAppointmentAt: string | null;
  /** Última mensagem trocada, quando existe. */
  lastMessageAt: string | null;
  /** "AAAA-MM-DD" da ficha de paciente. Lead que ainda não virou ficha: nulo. */
  birthDate: string | null;
  createdAt: string;
};

/** Agendamento reduzido ao que a grade da semana desenha. */
export type HomeAppointment = {
  id: string;
  leadId: string | null;
  personName: string;
  startsAt: string;
  endsAt: string | null;
  status: string;
  service: string | null;
  /** Sexo do paciente — é dele que sai a cor do chip na grade da semana. */
  sex: PatientSex | null;
};

export type HomeSummary = {
  /** Pessoas em acompanhamento (não perdidas, não arquivadas). */
  active: number;
  /** Atendimentos de hoje. */
  today: number;
};

export type UserNote = {
  id: string;
  title: string | null;
  content: string;
  color: NoteColor;
  updatedAt: string;
};

export type HomeNotes = {
  quick: { content: string; updatedAt: string | null };
  stickies: UserNote[];
};
