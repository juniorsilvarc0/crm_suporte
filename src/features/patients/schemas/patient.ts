import { z } from "zod";

import { isValidCpf, onlyDigits } from "@/features/patients/lib/documents";
import { BLOOD_TYPES, MARITAL_STATUS, PATIENT_SEX } from "@/features/patients/types";

/**
 * Campos vindos de `<form>`: input vazio chega como "" e significa "sem valor",
 * não "string vazia". Ausência significa "não altere".
 */
const text = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.string().trim().max(200).nullish()
);

const longText = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.string().trim().max(2000).nullish()
);

const isoDate = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use uma data válida.")
    .nullish()
);

const enumOf = (values: readonly string[], message: string) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z
      .string()
      .refine((value) => values.includes(value), message)
      .nullish()
  );

/** CPF: aceita com máscara, guarda só dígitos e recusa dígito verificador errado. */
const cpf = z.preprocess(
  (value) => {
    if (typeof value !== "string" || value.trim() === "") return null;
    return onlyDigits(value);
  },
  z
    .string()
    .refine((value) => isValidCpf(value), "CPF inválido — confira os números.")
    .nullish()
);

const zipCode = z.preprocess(
  (value) => {
    if (typeof value !== "string" || value.trim() === "") return null;
    return onlyDigits(value);
  },
  z.string().regex(/^\d{8}$/, "CEP deve ter 8 dígitos.").nullish()
);

const phone = z.preprocess(
  (value) => {
    if (typeof value !== "string" || value.trim() === "") return null;
    return onlyDigits(value);
  },
  z.string().regex(/^\d{10,15}$/, "Telefone inválido.").nullish()
);

const email = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.string().trim().email("E-mail inválido.").max(200).nullish()
);

/** Os campos comuns a criar e editar. */
const patientFields = {
  social_name: text,
  birth_date: isoDate,
  sex: enumOf(PATIENT_SEX, "Selecione uma opção válida."),
  cpf,
  rg: text,
  marital_status: enumOf(MARITAL_STATUS, "Selecione uma opção válida."),
  occupation: text,
  nationality: text,
  birthplace: text,

  phone,
  phone_alt: phone,
  email,

  zip_code: zipCode,
  street: text,
  street_number: text,
  complement: text,
  district: text,
  city: text,
  state: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().length(2, "Use a sigla do estado (ex.: ES).").toUpperCase().nullish()
  ),

  mother_name: text,
  father_name: text,
  guardian_name: text,
  guardian_phone: phone,
  guardian_cpf: cpf,
  guardian_relationship: text,

  insurance_name: text,
  insurance_plan: text,
  insurance_number: text,
  insurance_valid_until: isoDate,

  blood_type: enumOf(BLOOD_TYPES, "Selecione um tipo válido."),
  allergies: longText,
  chronic_conditions: longText,
  medications: longText,
  notes: longText,
};

export const createPatientSchema = z.object({
  full_name: z.string().trim().min(2, "Informe o nome do paciente.").max(200),
  /** Quando o cadastro nasce de um lead existente. */
  lead_id: z.string().uuid().nullish(),
  ...patientFields,
});

export const updatePatientSchema = z.object({
  full_name: z.string().trim().min(2, "Informe o nome do paciente.").max(200).optional(),
  ...patientFields,
});

export type CreatePatientInput = z.infer<typeof createPatientSchema>;
export type UpdatePatientInput = z.infer<typeof updatePatientSchema>;
