import { z } from "zod";

import { CONTRACT_STATUSES } from "@/features/contracts/lib/contract-status";

// Compartilhado entre o formulário (react-hook-form + zodResolver) e as rotas:
// a mesma regra valida os dois lados. O banco confere de novo o que é dele
// (checks de support_contracts e as RPCs).

// Mesmo regex das rotas (api/contacts/[id], api/tags/[id]).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// numeric(12,2): até 10 dígitos inteiros e 2 casas, ponto decimal. O campo é
// <input type="number">, que já entrega "1500.00".
const AMOUNT_RE = /^\d{1,10}(\.\d{1,2})?$/;
const AMOUNT_MESSAGE = "Informe o valor mensal (ex.: 1500.00).";
const ENDS_ON_MESSAGE = "Informe uma data de término válida.";
const BILLING_DAY_MESSAGE = "Use um dia de 1 a 28.";

// Data e seleção vazias chegam do formulário como "": viram null antes de validar.
function blankToNull(value: string | null): string | null {
  return value === "" ? null : value;
}

// z.iso.date() confere o calendário: 2026-02-30 é recusado.
const startsOn = z.iso.date("Informe a data de início.");

// Término vazio = prazo indeterminado.
const endsOn = z
  .string(ENDS_ON_MESSAGE)
  .nullable()
  .transform(blankToNull)
  .pipe(z.iso.date(ENDS_ON_MESSAGE).nullable());

// String (campo do formulário) ou número (cliente da API); sai como número.
const monthlyAmount = z
  .union([z.string(), z.number()], AMOUNT_MESSAGE)
  .transform((value) => String(value).trim())
  .pipe(z.string().regex(AMOUNT_RE, AMOUNT_MESSAGE))
  .transform(Number);

// 1..28 existe em todo mês (support_contracts_billing_day_check).
const billingDay = z.coerce
  .number<string | number>(BILLING_DAY_MESSAGE)
  .int(BILLING_DAY_MESSAGE)
  .min(1, BILLING_DAY_MESSAGE)
  .max(28, BILLING_DAY_MESSAGE);

// Vazio = sem plano.
const planId = z
  .string("Plano inválido.")
  .nullable()
  .transform(blankToNull)
  .pipe(z.string().regex(UUID_RE, "Plano inválido.").nullable());

// Mesmos limites da RPC (PRODUCTS_REQUIRED, TOO_MANY_PRODUCTS). Repetido é
// recusado aqui, em vez de a RPC deduplicar em silêncio.
const productIds = z
  .array(z.string().regex(UUID_RE, "Produto inválido."), "Escolha ao menos um produto.")
  .min(1, "Escolha ao menos um produto.")
  .max(50, "Máximo de 50 produtos por contrato.")
  .refine(
    (ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length,
    "O mesmo produto aparece mais de uma vez."
  );

// Edição completa: a RPC grava todos estes campos, então todos são exigidos
// (inclusive ends_on e plan_id, como null) — um campo esquecido no PATCH não
// apaga o término ou o plano em silêncio.
const contractFields = {
  starts_on: startsOn,
  ends_on: endsOn,
  monthly_amount: monthlyAmount,
  billing_day: billingDay,
  plan_id: planId,
  product_ids: productIds,
};

// O erro cai no campo de término; o banco confere de novo
// (support_contracts_term_check). Datas ISO comparam como texto.
function refineTerm(
  value: { starts_on: string; ends_on: string | null },
  ctx: z.RefinementCtx
): void {
  if (value.ends_on !== null && value.ends_on < value.starts_on) {
    ctx.addIssue({
      code: "custom",
      path: ["ends_on"],
      message: "O término não pode ser antes do início.",
    });
  }
}

// Contrato novo nasce ativo ou suspenso (a RPC recusa encerrado).
export const contractCreateSchema = z
  .object({
    customer_id: z.string("Empresa inválida.").regex(UUID_RE, "Empresa inválida."),
    status: z.enum(["ativo", "suspenso"], "Escolha Ativo ou Suspenso.").default("ativo"),
    ...contractFields,
  })
  .strict()
  .superRefine(refineTerm);

// Empresa e situação não mudam na edição: a situação tem rota própria.
export const contractUpdateSchema = z.object(contractFields).strict().superRefine(refineTerm);

// ends_on só vale ao encerrar; ausente, a RPC encerra com a data de hoje (SP).
export const contractStatusSchema = z
  .object({
    status: z.enum(CONTRACT_STATUSES, "Situação inválida."),
    ends_on: z.iso.date(ENDS_ON_MESSAGE).nullable().optional(),
  })
  .strict();

// Plano é só o rótulo do contrato: sem preço.
export const supportPlanCreateSchema = z
  .object({
    name: z
      .string("Informe o nome do plano.")
      .trim()
      .min(2, "Use ao menos 2 caracteres.")
      .max(80, "Máximo de 80 caracteres."),
    // Vazio vira null: o banco recusa descrição em branco.
    description: z
      .string()
      .trim()
      .max(500, "Máximo de 500 caracteres.")
      .nullish()
      .transform((value) => value || null),
  })
  .strict();

export type ContractCreateInput = z.infer<typeof contractCreateSchema>;
export type ContractUpdateInput = z.infer<typeof contractUpdateSchema>;
export type ContractStatusInput = z.infer<typeof contractStatusSchema>;
export type SupportPlanCreateInput = z.infer<typeof supportPlanCreateSchema>;
