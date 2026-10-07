// Contexto de um cliente lido de uma fonte externa (ex.: a API da TCBX), já
// NORMALIZADO para o nosso formato: a tela e o resto do CRM dependem deste tipo,
// não do formato de um fornecedor. Outra fonte, no futuro, mapeia para o mesmo
// contrato (ver get-customer-context.ts). É só leitura, sob demanda — nada aqui
// depende de webhook.

export type CustomerPersonType = "PF" | "PJ";

export type CustomerContract = {
  id: number;
  numero: string | null;
  modalidade: string | null;
  vigencia: string | null;
  dataInicio: string | null;
  dataFim: string | null;
  vencimentoDia: number | null;
  status: string | null;
  statusVigencia: string | null;
  dataAtivacao: string | null;
};

export type CustomerOpenInvoice = {
  id: number;
  contratoId: number | null;
  contratoNumero: string | null;
  descricao: string | null;
  tipo: string | null;
  dataEmissao: string | null;
  dataVencimento: string | null;
  valorPrincipal: number | null;
  multaValor: number | null;
  jurosValor: number | null;
  situacao: string | null;
  parcelaN: number | null;
  parcelaDe: number | null;
};

export type CustomerContext = {
  /** O id estável do cliente NA FONTE (o que amarra as bases). Sempre presente. */
  externalId: string;
  tipoPessoa: CustomerPersonType | null;
  documento: string | null;
  razaoSocial: string | null;
  nomeFantasia: string | null;
  status: string | null;
  emailPrincipal: string | null;
  emailFinanceiro: string | null;
  telefonePrincipal: string | null;
  telefoneSecundario: string | null;
  contratos: CustomerContract[];
  titulosEmAberto: CustomerOpenInvoice[];
};

/**
 * A chave da consulta. A fonte aceita documento (CPF/CNPJ) ou o id dela; o
 * telefone só funciona quando a fonte passar a aceitá-lo (hoje a TCBX ainda
 * não), mas já é encaminhado para não exigir mudança de código depois.
 */
export type CustomerLookup =
  | { documento: string }
  | { clienteId: string | number }
  | { telefone: string };

/**
 * O desfecho da consulta. Numa tela de atendimento, falha de leitura NÃO vira
 * "cliente não encontrado": `unavailable` é explícito, como no resto do app.
 */
export type CustomerContextResult =
  | { state: "ok"; context: CustomerContext }
  // A fonte não tem esse cliente.
  | { state: "not_found" }
  // A fonte achou MAIS DE UM cliente para a chave (ex.: telefone que casa com
  // vários cadastros): não dá para escolher. 409 na TCBX.
  | { state: "ambiguous" }
  // Sem URL ou sem chave no cofre: a integração está desligada.
  | { state: "not_configured" }
  // A fonte não respondeu, respondeu com erro, ou respondeu algo inesperado.
  | { state: "unavailable" };
