import { isContractStatus } from "@/features/contracts/lib/contract-status";
import { getCustomerContext } from "@/features/customer-source/get-customer-context";
import { resolveCustomerByPhone } from "@/features/customer-source/resolve-by-phone";
import type { CustomerContextResult } from "@/features/customer-source/types";
import { apiError } from "@/lib/api/v1/errors";
import { toContactFinancial } from "@/lib/api/v1/financial";
import { apiOk, notFound, unavailable } from "@/lib/api/v1/responses";
import { withApi } from "@/lib/api/v1/with-api";
import { getTodayAppDateKey } from "@/lib/formatters/date";
import { isUuid } from "@/lib/validation/uuid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A situação do cliente do contato, para a IA de triagem: documento, nomes, os
 * selos da empresa e da pessoa e os títulos em aberto (vencidos e a vencer),
 * consultados AO VIVO na TCBX. A mesma resolução do painel do chat
 * (`/api/contacts/[id]/external-context`): o CNPJ da empresa vinculada e, sem
 * ela, o telefone do contato. Escopo próprio, `financial:read`: valores ficam
 * fora do resto da v1.
 */
export const GET = withApi<{ id: string }>(
  { route: "/api/v1/contacts/[id]/financial", scopes: ["financial:read"] },
  async ({ params, requestId, supabase }) => {
    if (!isUuid(params.id)) return notFound(requestId, "Contato não encontrado.");

    const { data: contact, error } = await supabase
      .from("contacts")
      .select("phone, customer_id")
      .eq("id", params.id)
      .maybeSingle();
    if (error) {
      console.error(`[api/v1] ${requestId} financial contact`, error.code, error.message);
      return unavailable(requestId, "o contato");
    }
    if (!contact) return notFound(requestId, "Contato não encontrado.");

    let customer: {
      cnpj: string | null;
      legal_name: string | null;
      trade_name: string | null;
      contract_status: string | null;
    } | null = null;
    if (contact.customer_id) {
      const { data, error: customerError } = await supabase
        .from("customers")
        .select("cnpj, legal_name, trade_name, contract_status")
        .eq("id", contact.customer_id)
        .maybeSingle();
      if (customerError) {
        console.error(`[api/v1] ${requestId} financial customer`, customerError.code, customerError.message);
        return unavailable(requestId, "a empresa");
      }
      customer = data;
    }

    // Empresa com CNPJ: consulta direta (mais preciso). Senão, pelo telefone.
    const result: CustomerContextResult = customer?.cnpj
      ? await getCustomerContext({ documento: customer.cnpj })
      : contact.phone
        ? await resolveCustomerByPhone(contact.phone)
        : { state: "not_found" };

    if (result.state === "not_configured") {
      return apiError(requestId, 503, "source_not_configured", "A integração com a TCBX não está configurada no CRM.");
    }
    if (result.state === "unavailable") return unavailable(requestId, "a TCBX");

    return apiOk(
      toContactFinancial({
        customer: customer
          ? {
              cnpj: customer.cnpj,
              legal_name: customer.legal_name,
              trade_name: customer.trade_name,
              contract_status: isContractStatus(customer.contract_status) ? customer.contract_status : null,
            }
          : null,
        context: result.state === "ok" ? result.context : null,
        notFoundReason: result.state === "ok" ? null : result.state,
        phone: contact.phone,
        today: getTodayAppDateKey(),
        checkedAt: new Date().toISOString(),
      })
    );
  }
);
