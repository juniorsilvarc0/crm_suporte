import { z } from "zod";

// Schema ÚNICO da venda, importado pelo modal e pelas rotas.
//
// O diálogo antigo validava em quatro `if` espalhados pelo handler, em ordem
// que fazia o usuário ver um erro por vez. Aqui é um `safeParse` só, e o
// `flatten().fieldErrors` sai no mesmo shape `Record<string, string[]>` que o
// resto do repositório já espalha por campo.

export const PAYMENT_METHODS = [
  "pix",
  "credito",
  "debito",
  "dinheiro",
  "link",
] as const;

export type SalePaymentMethod = (typeof PAYMENT_METHODS)[number];

const money = z.coerce
  .number({ message: "Informe um valor." })
  .refine((value) => Number.isFinite(value), "Informe um valor.");

// A venda é sempre recebida no ato. Parcelamento no cartão é acordo entre o
// paciente e o banco — a clínica recebe o valor pela maquininha, então não há
// "a receber" a controlar aqui.
const saleFields = {
  procedure_name: z
    .string()
    .trim()
    .min(1, "Informe o procedimento.")
    .max(120, "No máximo 120 caracteres."),

  total_amount: money.pipe(
    z.number().positive("O valor precisa ser maior que zero.")
  ),
  discount: money.pipe(z.number().min(0, "O desconto não pode ser negativo.")).default(0),

  method: z.enum(PAYMENT_METHODS, { message: "Escolha a forma de pagamento." }),

  notes: z.string().trim().max(500, "No máximo 500 caracteres.").optional(),
} as const;

// Desconto maior que o total gerava líquido 0 e uma "venda" de R$ 0 contada
// pelo dashboard.
const crossFieldRules = (
  value: { discount: number; total_amount: number },
  ctx: z.RefinementCtx
) => {
  if (value.discount > value.total_amount) {
    ctx.addIssue({
      code: "custom",
      path: ["discount"],
      message: "O desconto não pode passar do valor da venda.",
    });
  }
};

/** Registrar venda: exige cliente e chave de idempotência. */
export const saleSchema = z
  .object({
    idempotency_key: z.string().uuid("Chave de idempotência inválida."),
    lead_id: z.string().uuid("Selecione um cliente válido."),
    deal_id: z.string().uuid().nullish(),
    move_to_won: z.boolean().default(true),
    ...saleFields,
  })
  .superRefine(crossFieldRules);

/**
 * Editar venda: os mesmos campos e as mesmas regras, sem idempotência (o alvo
 * já é identificado pela URL) e sem mexer no funil — o card já foi movido
 * quando a venda entrou.
 */
export const saleEditSchema = z.object(saleFields).superRefine(crossFieldRules);

export type SaleInput = z.infer<typeof saleSchema>;
export type SaleEditInput = z.infer<typeof saleEditSchema>;
