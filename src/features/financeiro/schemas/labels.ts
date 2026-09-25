import type { ContractStatus, ExpenseCategory, PaymentMethod, PaymentStatus } from "@/lib/supabase/types";

export const contractStatusLabel: Record<ContractStatus, string> = {
  aberto: "Em aberto",
  quitado: "Quitado",
  cancelado: "Cancelado",
};

export const contractStatusColor: Record<ContractStatus, string> = {
  aberto: "text-amber-600 bg-amber-50 border-amber-200",
  quitado: "text-emerald-600 bg-emerald-50 border-emerald-200",
  cancelado: "text-rose-600 bg-rose-50 border-rose-200",
};

export const paymentMethodLabel: Record<PaymentMethod, string> = {
  pix: "Pix",
  credito: "Cartão de crédito",
  debito: "Cartão de débito",
  dinheiro: "Dinheiro",
  link: "Link de pagamento",
  parcelado: "Parcelado (cartão)",
};

export const paymentStatusLabel: Record<PaymentStatus, string> = {
  pago: "Pago",
  pendente: "Pendente",
  estornado: "Estornado",
};

export const expenseCategoryLabel: Record<string, string> = {
  luz: "Luz / energia",
  agua: "Água",
  aluguel: "Aluguel",
  internet: "Internet",
  limpeza: "Limpeza",
  equipamento: "Equipamentos",
  manutencao: "Manutenção",
  fornecedor: "Fornecedores",
  operacional: "Operacional",
  cartao_credito: "Cartão de crédito",
  cartao_debito: "Cartão de débito",
  marketing: "Marketing / Publicidade",
  software: "Software / Assinaturas",
  alimentacao: "Alimentação",
  combustivel: "Combustível / Transporte",
  seguro: "Seguro",
  imposto: "Impostos / Taxas",
  salario: "Salários / Freelancer",
  outro: "Outro",
};

// Ordem de exibição no select agrupado por afinidade.
export const expenseCategoryGroups: { label: string; items: { value: string; label: string }[] }[] = [
  {
    label: "Estrutura",
    items: [
      { value: "aluguel",   label: "Aluguel" },
      { value: "luz",       label: "Luz / energia" },
      { value: "agua",      label: "Água" },
      { value: "internet",  label: "Internet" },
      { value: "limpeza",   label: "Limpeza" },
    ],
  },
  {
    label: "Pagamentos",
    items: [
      { value: "cartao_credito", label: "Cartão de crédito" },
      { value: "cartao_debito",  label: "Cartão de débito" },
      { value: "imposto",        label: "Impostos / Taxas" },
      { value: "seguro",         label: "Seguro" },
      { value: "salario",        label: "Salários / Freelancer" },
    ],
  },
  {
    label: "Negócio",
    items: [
      { value: "equipamento",  label: "Equipamentos" },
      { value: "manutencao",   label: "Manutenção" },
      { value: "software",     label: "Software / Assinaturas" },
      { value: "marketing",    label: "Marketing / Publicidade" },
      { value: "fornecedor",   label: "Fornecedores" },
      { value: "alimentacao",  label: "Alimentação" },
      { value: "combustivel",  label: "Combustível / Transporte" },
      { value: "operacional",  label: "Operacional" },
    ],
  },
  {
    label: "Outros",
    items: [
      { value: "outro", label: "Outro" },
    ],
  },
];

export const expenseKindLabel: Record<"fixa" | "variavel", string> = {
  fixa: "Fixa",
  variavel: "Variável",
};

export const expenseStatusColor: Record<"pago" | "pendente", string> = {
  pago: "text-emerald-600 bg-emerald-50 border-emerald-200",
  pendente: "text-amber-600 bg-amber-50 border-amber-200",
};
