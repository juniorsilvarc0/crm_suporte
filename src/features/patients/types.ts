import type { Database } from "@/lib/supabase/types";

export type Patient = Database["public"]["Tables"]["patients"]["Row"];

/** Sexo como o cadastro registra. Rótulos em `patientSexLabel`. */
export const PATIENT_SEX = ["feminino", "masculino", "intersexo", "nao_informado"] as const;
export type PatientSex = (typeof PATIENT_SEX)[number];

export const patientSexLabel: Record<PatientSex, string> = {
  feminino: "Feminino",
  masculino: "Masculino",
  intersexo: "Intersexo",
  nao_informado: "Não informado",
};

/** Como a pessoa virou paciente — o histórico importa para auditoria. */
export const patientPromotionLabel: Record<string, string> = {
  agendamento: "Agendou consulta",
  manual: "Promovido manualmente",
  cadastro: "Cadastro direto",
  importacao: "Importação",
};

export const MARITAL_STATUS = [
  "solteiro",
  "casado",
  "uniao_estavel",
  "divorciado",
  "viuvo",
  "separado",
] as const;

export const maritalStatusLabel: Record<string, string> = {
  solteiro: "Solteiro(a)",
  casado: "Casado(a)",
  uniao_estavel: "União estável",
  divorciado: "Divorciado(a)",
  viuvo: "Viúvo(a)",
  separado: "Separado(a)",
};

export const BLOOD_TYPES = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;

/** Linha da lista de pacientes: só o que a tabela mostra. */
export type PatientListItem = Pick<
  Patient,
  | "id"
  | "full_name"
  | "social_name"
  | "birth_date"
  | "phone"
  | "cpf"
  | "city"
  | "state"
  | "insurance_name"
  | "promotion_source"
  | "created_at"
  | "archived_at"
>;

export type PaginatedPatients = {
  items: PatientListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};
