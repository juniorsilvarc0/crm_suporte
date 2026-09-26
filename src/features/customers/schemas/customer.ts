import { z } from "zod";

import { isValidCnpj, normalizeCnpj } from "@/lib/formatters/cnpj";

// Compartilhado entre o formulário (react-hook-form + zodResolver) e as rotas:
// a mesma regra valida os dois lados. O banco confere de novo o que é dele
// (checks de customers e o índice único de CNPJ entre ativas).

const CNPJ_MESSAGE = "CNPJ inválido — confira os caracteres.";

// Texto vazio (ou só espaços) = "sem valor": vira null, porque o banco recusa
// texto em branco. Ausente continua ausente (ver customerUpdateSchema).
function blankToNull(value: string | null): string | null {
  return value ? value : null;
}

const legalName = z
  .string("Informe a razão social.")
  .trim()
  .min(2, "Informe a razão social.")
  .max(160, "Máximo de 160 caracteres.");

const tradeName = z
  .string("Nome fantasia inválido.")
  .trim()
  .max(160, "Máximo de 160 caracteres.")
  .nullable()
  .transform(blankToNull);

const notes = z
  .string("Observações inválidas.")
  .trim()
  .max(2000, "Máximo de 2.000 caracteres.")
  .nullable()
  .transform(blankToNull);

// Aceita com ou sem máscara, em qualquer caixa, e grava como o banco guarda
// ("12.abc.345/01de-35" → "12ABC34501DE35"). O dígito verificador é conferido
// AQUI: o banco só confere o formato (customers_cnpj_format_check).
const cnpj = z
  .string(CNPJ_MESSAGE)
  .nullable()
  .transform((value) => (value === null || value.trim() === "" ? null : normalizeCnpj(value)))
  .pipe(z.string().refine(isValidCnpj, CNPJ_MESSAGE).nullable());

// ⚠️ .optional() por fora de cada campo: ausente fica AUSENTE (undefined), nunca
// null. No PATCH, isso é o que separa "não mexa" de "apague".
const customerFields = {
  legal_name: legalName,
  trade_name: tradeName.optional(),
  cnpj: cnpj.optional(),
  notes: notes.optional(),
};

// contract_status (selo do trigger) e archived_at (rota própria) ficam fora:
// .strict() responde 400 em vez de descartá-los em silêncio.
export const customerCreateSchema = z.object(customerFields).strict();

// Edição parcial: só as chaves enviadas são gravadas (o formulário manda os
// dirtyFields).
export const customerUpdateSchema = z
  .object(customerFields)
  .partial()
  .strict()
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    "Nada para atualizar."
  );

export type CustomerCreateInput = z.infer<typeof customerCreateSchema>;
export type CustomerUpdateInput = z.infer<typeof customerUpdateSchema>;
