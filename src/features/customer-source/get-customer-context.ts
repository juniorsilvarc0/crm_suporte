import { z } from "zod";

import {
  CUSTOMER_SOURCE_TOKEN_NAME,
  CUSTOMER_SOURCE_URL_NAME,
} from "@/features/settings/types";
import { getRuntimeEnvironmentVariable } from "@/features/settings/lib/get-runtime-environment";
import { safeBaseUrl, UnsafeUrlError } from "@/lib/security/ssrf-guard";

import type {
  CustomerContext,
  CustomerContextResult,
  CustomerLookup,
  CustomerPersonType,
} from "./types";

// Consulta o contexto de UM cliente na fonte externa, na hora do atendimento.
// Só leitura, sob demanda — não depende de webhook. Hoje a fonte é a API da
// TCBX (`GET {base}/clientes/contexto?documento=…|cliente_id=…`); para trocar de
// fonte, muda-se o mapeamento abaixo, não quem chama. A URL e a chave vêm do
// cofre (Variáveis), nunca de arquivo. Falha é sempre explícita (ver types).

const TIMEOUT_MS = 12_000;

const text = z.string().nullish();
const number = z.number().nullish();

const contractSchema = z.object({
  id: z.number(),
  numero: text,
  modalidade_contratacao: text,
  vigencia: text,
  data_inicio: text,
  data_fim: text,
  vencimento_dia: number,
  status: text,
  status_vigencia: text,
  data_ativacao: text,
});

const invoiceSchema = z.object({
  id: z.number(),
  contrato_id: number,
  contrato_numero: text,
  descricao: text,
  tipo: text,
  data_emissao: text,
  data_vencimento: text,
  valor_principal: number,
  multa_valor: number,
  juros_valor: number,
  situacao: text,
  parcela_n: number,
  parcela_de: number,
});

// O formato cru da TCBX. Campo extra é ignorado (zod descarta o desconhecido);
// campo com o tipo errado derruba o parse, e a leitura vira `unavailable`.
const responseSchema = z.object({
  success: z.literal(true),
  cliente: z.object({
    id: z.union([z.number(), z.string()]),
    tipo_pessoa: text,
    documento: text,
    razao_social: text,
    nome_fantasia: text,
    status: text,
    email_principal: text,
    email_financeiro: text,
    telefone_principal: text,
    telefone_secundario: text,
  }),
  contratos: z.array(contractSchema).nullish(),
  financeiro: z.object({ titulos_em_aberto: z.array(invoiceSchema).nullish() }).nullish(),
});

type RawResponse = z.infer<typeof responseSchema>;

const personType = (value: string | null | undefined): CustomerPersonType | null =>
  value === "PF" || value === "PJ" ? value : null;

function toContext(raw: RawResponse): CustomerContext {
  return {
    externalId: String(raw.cliente.id),
    tipoPessoa: personType(raw.cliente.tipo_pessoa),
    documento: raw.cliente.documento ?? null,
    razaoSocial: raw.cliente.razao_social ?? null,
    nomeFantasia: raw.cliente.nome_fantasia ?? null,
    status: raw.cliente.status ?? null,
    emailPrincipal: raw.cliente.email_principal ?? null,
    emailFinanceiro: raw.cliente.email_financeiro ?? null,
    telefonePrincipal: raw.cliente.telefone_principal ?? null,
    telefoneSecundario: raw.cliente.telefone_secundario ?? null,
    contratos: (raw.contratos ?? []).map((contract) => ({
      id: contract.id,
      numero: contract.numero ?? null,
      modalidade: contract.modalidade_contratacao ?? null,
      vigencia: contract.vigencia ?? null,
      dataInicio: contract.data_inicio ?? null,
      dataFim: contract.data_fim ?? null,
      vencimentoDia: contract.vencimento_dia ?? null,
      status: contract.status ?? null,
      statusVigencia: contract.status_vigencia ?? null,
      dataAtivacao: contract.data_ativacao ?? null,
    })),
    titulosEmAberto: (raw.financeiro?.titulos_em_aberto ?? []).map((invoice) => ({
      id: invoice.id,
      contratoId: invoice.contrato_id ?? null,
      contratoNumero: invoice.contrato_numero ?? null,
      descricao: invoice.descricao ?? null,
      tipo: invoice.tipo ?? null,
      dataEmissao: invoice.data_emissao ?? null,
      dataVencimento: invoice.data_vencimento ?? null,
      valorPrincipal: invoice.valor_principal ?? null,
      multaValor: invoice.multa_valor ?? null,
      jurosValor: invoice.juros_valor ?? null,
      situacao: invoice.situacao ?? null,
      parcelaN: invoice.parcela_n ?? null,
      parcelaDe: invoice.parcela_de ?? null,
    })),
  };
}

function queryFor(lookup: CustomerLookup): string {
  const params = new URLSearchParams();
  if ("documento" in lookup) params.set("documento", String(lookup.documento));
  else if ("clienteId" in lookup) params.set("cliente_id", String(lookup.clienteId));
  else params.set("telefone", String(lookup.telefone));
  return params.toString();
}

async function readConfig(): Promise<{ baseUrl: string; token: string } | null | "error"> {
  try {
    const [url, token] = await Promise.all([
      getRuntimeEnvironmentVariable(CUSTOMER_SOURCE_URL_NAME),
      getRuntimeEnvironmentVariable(CUSTOMER_SOURCE_TOKEN_NAME),
    ]);
    if (!url.value || !token.value) return null;
    return { baseUrl: url.value, token: token.value };
  } catch (error) {
    console.error("getCustomerContext: não consegui ler a configuração", error);
    return "error";
  }
}

export async function getCustomerContext(lookup: CustomerLookup): Promise<CustomerContextResult> {
  const config = await readConfig();
  if (config === "error") return { state: "unavailable" };
  if (config === null) return { state: "not_configured" };

  let base: string;
  try {
    base = safeBaseUrl(config.baseUrl);
  } catch (error) {
    // URL mal configurada ou apontando para rede interna: não é "sem cliente".
    const reason = error instanceof UnsafeUrlError || error instanceof Error ? error.message : error;
    console.error("getCustomerContext: a URL da fonte foi recusada", reason);
    return { state: "unavailable" };
  }

  let response: Response;
  try {
    response = await fetch(`${base}/clientes/contexto?${queryFor(lookup)}`, {
      headers: { Authorization: `Bearer ${config.token}`, Accept: "application/json" },
      cache: "no-store",
      // Não seguir redirect: evita vazar o Bearer para outro host.
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    // Rede: a mensagem costuma ser só "fetch failed"; o motivo vem na causa.
    console.error(
      "getCustomerContext: a fonte não respondeu",
      error instanceof Error ? error.message : error,
      error instanceof Error ? error.cause : undefined
    );
    return { state: "unavailable" };
  }

  if (response.status === 404) return { state: "not_found" };
  // 409: a fonte achou mais de um cliente para a chave (telefone ambíguo). Não é
  // "fora do ar" — é "não dá para escolher".
  if (response.status === 409) return { state: "ambiguous" };
  if (!response.ok) {
    console.error("getCustomerContext: a fonte respondeu com erro", response.status);
    return { state: "unavailable" };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    console.error("getCustomerContext: a resposta da fonte não é JSON");
    return { state: "unavailable" };
  }

  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) {
    console.error("getCustomerContext: a fonte respondeu num formato inesperado");
    return { state: "unavailable" };
  }

  return { state: "ok", context: toContext(parsed.data) };
}
