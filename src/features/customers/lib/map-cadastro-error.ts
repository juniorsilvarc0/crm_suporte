// Traduz os erros do banco nos cadastros (empresa, contato ↔ empresa, produto,
// plano e contrato) em status HTTP + mensagem amigável, marcando o campo quando
// o erro é de um input específico. Molde de map-user-rpc-error.ts.
//
// Ordem de leitura:
//   1. TAG na message — raise exception 'TAG' das RPCs e dos triggers
//      (migration _cadastros), sem errcode próprio;
//   2. nome da constraint na message — o Postgres cita o nome em 23505/23514/23503;
//   3. code.
//
// status 500 = bug ou falha do banco: a rota loga (console.error) antes de
// responder, e a mensagem nunca repassa error.message ao cliente.
export type CadastroErrorField =
  | "customer_id"
  | "plan_id"
  | "product_ids"
  | "status"
  | "cnpj"
  | "name"
  | "ends_on"
  | "billing_day"
  | "monthly_amount";

export type MappedCadastroError = {
  status: number;
  message: string;
  field?: CadastroErrorField;
};

type DatabaseErrorLike = {
  message?: string | null;
  code?: string | null;
};

const GENERIC_ERROR: MappedCadastroError = {
  status: 500,
  message: "Não foi possível concluir a operação.",
};

// Nenhuma TAG é trecho de outra (CURRENT_CONTRACT_EXISTS ≠
// CUSTOMER_HAS_CURRENT_CONTRACT), então a ordem da lista não decide empate.
const TAG_ERRORS: ReadonlyArray<readonly [string, MappedCadastroError]> = [
  ["FORBIDDEN", { status: 403, message: "Apenas administradores podem executar esta ação." }],
  ["CUSTOMER_NOT_FOUND", { status: 404, message: "Empresa não encontrada.", field: "customer_id" }],
  ["CONTRACT_NOT_FOUND", { status: 404, message: "Contrato não encontrado." }],
  [
    "CURRENT_CONTRACT_EXISTS",
    {
      status: 409,
      message: "Esta empresa já tem um contrato vigente. Encerre-o antes de criar outro.",
    },
  ],
  [
    "CONTRACT_CLOSED",
    { status: 409, message: "Contrato encerrado não pode ser alterado. Crie um novo." },
  ],
  [
    "CUSTOMER_HAS_CURRENT_CONTRACT",
    { status: 409, message: "Encerre o contrato vigente antes de arquivar a empresa." },
  ],
  [
    "CUSTOMER_ARCHIVED",
    { status: 422, message: "Empresa arquivada. Reative-a antes.", field: "customer_id" },
  ],
  ["PLAN_NOT_FOUND", { status: 422, message: "Plano não encontrado.", field: "plan_id" }],
  ["PLAN_ARCHIVED", { status: 422, message: "Plano arquivado.", field: "plan_id" }],
  ["PRODUCT_NOT_FOUND", { status: 422, message: "Produto não encontrado.", field: "product_ids" }],
  [
    "PRODUCT_ARCHIVED",
    { status: 422, message: "Um dos produtos foi arquivado.", field: "product_ids" },
  ],
  [
    "PRODUCTS_REQUIRED",
    { status: 400, message: "Escolha ao menos um produto.", field: "product_ids" },
  ],
  ["TOO_MANY_PRODUCTS", { status: 400, message: "Produtos demais.", field: "product_ids" }],
  ["INVALID_STATUS", { status: 400, message: "Situação inválida.", field: "status" }],
];

const CONSTRAINT_ERRORS: ReadonlyArray<readonly [string, MappedCadastroError]> = [
  // O índice único é a última defesa da invariante "1 contrato vigente", se a
  // RPC um dia deixar a checagem passar numa corrida.
  [
    "support_contracts_one_current_per_customer_uidx",
    {
      status: 409,
      message: "Esta empresa já tem um contrato vigente. Encerre-o antes de criar outro.",
    },
  ],
  [
    "customers_cnpj_active_uidx",
    { status: 409, message: "Já existe empresa ativa com este CNPJ.", field: "cnpj" },
  ],
  [
    "customers_cnpj_format_check",
    { status: 422, message: "CNPJ inválido — confira os caracteres.", field: "cnpj" },
  ],
  [
    "products_name_active_uidx",
    { status: 409, message: "Já existe um produto com este nome.", field: "name" },
  ],
  [
    "support_plans_name_active_uidx",
    { status: 409, message: "Já existe um plano com este nome.", field: "name" },
  ],
  [
    "support_contracts_term_check",
    { status: 422, message: "O término não pode ser antes do início.", field: "ends_on" },
  ],
  [
    "support_contracts_billing_day_check",
    { status: 422, message: "Use um dia de 1 a 28.", field: "billing_day" },
  ],
  [
    "support_contracts_amount_check",
    { status: 422, message: "Valor inválido.", field: "monthly_amount" },
  ],
  [
    "contacts_customer_id_fkey",
    { status: 422, message: "Empresa não encontrada.", field: "customer_id" },
  ],
];

// Entrada que o banco não aceitou pelo tipo: texto em uuid/date (22P02), número
// fora da faixa (22003), obrigatório nulo (23502). O zod deveria ter barrado.
const INVALID_INPUT_CODES = new Set(["22P02", "22003", "23502"]);

export function mapCadastroError(error: DatabaseErrorLike | null | undefined): MappedCadastroError {
  const message = error?.message ?? "";

  // Cópia: a rota pode acrescentar campos à resposta sem alterar a tabela.
  for (const [tag, mapped] of TAG_ERRORS) {
    if (message.includes(tag)) return { ...mapped };
  }
  for (const [constraint, mapped] of CONSTRAINT_ERRORS) {
    if (message.includes(constraint)) return { ...mapped };
  }

  if (error?.code && INVALID_INPUT_CODES.has(error.code)) {
    return { status: 400, message: "Revise os campos destacados." };
  }
  // Inclui o 42501 sem TAG: não é "sem permissão" do usuário, é grant faltando
  // ou um select que tocou monthly_amount. Bug — 500, nunca 403.
  return { ...GENERIC_ERROR };
}
