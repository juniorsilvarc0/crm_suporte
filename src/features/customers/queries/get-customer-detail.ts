import {
  CONTRACT_SELECT,
  toContractView,
  type ContractRowFromDb,
} from "@/features/contracts/lib/contract-view";
import type { ContractView } from "@/features/contracts/types";
import { toCustomerSummary } from "@/features/customers/lib/customer-display";
import type { CustomerContact, CustomerRecord } from "@/features/customers/types";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

// Dia de vencimento só para admin: o select do member nem pede a coluna, então
// o payload dele não tem o campo.
const ADMIN_CONTRACT_SELECT = `${CONTRACT_SELECT}, billing_day` as const;

const CUSTOMER_DETAIL_SELECT =
  "id, legal_name, trade_name, cnpj, contract_status, archived_at, notes, created_at, updated_at";
const CONTACT_SELECT = "id, name, phone, last_message_at";
const MAX_CONTACTS = 200;

/** Contrato como a ficha do admin lê do banco, antes de juntar o valor. */
export type AdminContractRow = ContractView & { billing_day: number };

/**
 * `contacts`/`contracts` = `null` quando AQUELA leitura falhou: a tela diz "não
 * foi possível carregar", nunca "sem contatos" ou "sem contrato".
 */
export type CustomerDetailResult<TContract extends ContractView = ContractView> =
  | {
      status: "ok";
      customer: CustomerRecord;
      contacts: CustomerContact[] | null;
      contracts: TContract[] | null;
    }
  | { status: "not_found" }
  | { status: "error" };

/**
 * Ficha da empresa, arquivada inclusive (o histórico continua existindo).
 *
 * As três leituras correm juntas; só a da empresa decide not_found/error. Falha
 * de contatos ou de contratos vira `null` NAQUELA seção, e a ficha abre.
 */
export function getCustomerDetail(
  id: string,
  options: { admin: true }
): Promise<CustomerDetailResult<AdminContractRow>>;
export function getCustomerDetail(
  id: string,
  options: { admin: false }
): Promise<CustomerDetailResult<ContractView>>;
export async function getCustomerDetail(
  id: string,
  options: { admin: boolean }
): Promise<CustomerDetailResult<ContractView | AdminContractRow>> {
  if (!hasSupabaseAdminEnv()) return { status: "error" };

  try {
    const supabase = createSupabaseAdminClient();

    // Duas cadeias, e não select(admin ? A : B): com a string condicional o
    // parser de tipos do supabase-js desiste (ParserError) e o retorno perde o tipo.
    const contractsQuery = options.admin
      ? supabase
          .from("support_contracts")
          .select(ADMIN_CONTRACT_SELECT)
          .eq("customer_id", id)
          .order("starts_on", { ascending: false })
          .order("created_at", { ascending: false })
      : supabase
          .from("support_contracts")
          .select(CONTRACT_SELECT)
          .eq("customer_id", id)
          .order("starts_on", { ascending: false })
          .order("created_at", { ascending: false });

    const [customerRes, contactsRes, contractsRes] = await Promise.all([
      supabase.from("customers").select(CUSTOMER_DETAIL_SELECT).eq("id", id).maybeSingle(),
      supabase
        .from("contacts")
        .select(CONTACT_SELECT)
        .eq("customer_id", id)
        .is("archived_at", null)
        .order("name", { ascending: true })
        .limit(MAX_CONTACTS),
      contractsQuery,
    ]);

    if (customerRes.error) {
      console.error("getCustomerDetail failed", customerRes.error.message);
      return { status: "error" };
    }
    if (!customerRes.data) return { status: "not_found" };

    const row = customerRes.data;
    const customer: CustomerRecord = {
      ...toCustomerSummary(row),
      notes: row.notes,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };

    let contacts: CustomerContact[] | null = null;
    if (contactsRes.error) {
      console.error("getCustomerDetail contacts failed", contactsRes.error.message);
    } else {
      contacts = (contactsRes.data ?? []).map((contact) => ({
        id: contact.id,
        name: contact.name,
        phone: contact.phone,
        last_message_at: contact.last_message_at,
      }));
    }

    return {
      status: "ok",
      customer,
      contacts,
      contracts: mapContracts(contractsRes, options.admin),
    };
  } catch (error) {
    console.error("getCustomerDetail threw", error);
    return { status: "error" };
  }
}

function mapContracts(
  result: { data: ContractRowFromDb[] | null; error: { message: string } | null },
  admin: boolean
): (ContractView | AdminContractRow)[] | null {
  if (result.error) {
    console.error("getCustomerDetail contracts failed", result.error.message);
    return null;
  }

  const contracts: (ContractView | AdminContractRow)[] = [];
  for (const row of result.data ?? []) {
    const view = toContractView(row);
    // Situação fora do check do banco, ou dia de vencimento ausente para
    // admin: a seção inteira falha em vez de esconder um contrato vigente.
    if (!view || (admin && typeof row.billing_day !== "number")) {
      console.error("getCustomerDetail contracts: linha inesperada", row.id);
      return null;
    }
    contracts.push(
      admin && row.billing_day !== undefined ? { ...view, billing_day: row.billing_day } : view
    );
  }
  return contracts;
}
