import { mapCadastroError } from "@/features/customers/lib/map-cadastro-error";
import { CONTACT_API_SELECT, toApiContact, updateContactSchema } from "@/lib/api/v1/cadastros";
import { apiError } from "@/lib/api/v1/errors";
import { apiOk, invalidInput, notFound, unavailable } from "@/lib/api/v1/responses";
import { withApi } from "@/lib/api/v1/with-api";
import { readJsonBody } from "@/lib/http/read-json-body";
import { isUuid } from "@/lib/validation/uuid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

/** Um contato, arquivado inclusive. Anonimizado é 404. */
export const GET = withApi<Params>(
  { route: "/api/v1/contacts/[id]", scopes: ["contacts:read"] },
  async ({ params, requestId, supabase }) => {
    if (!isUuid(params.id)) return notFound(requestId, "Contato não encontrado.");

    const { data, error } = await supabase
      .from("contacts")
      .select(CONTACT_API_SELECT)
      .eq("id", params.id)
      .is("anonymized_at", null)
      .maybeSingle();
    if (error) {
      console.error(`[api/v1] ${requestId} contact`, error.message);
      return unavailable(requestId, "o contato");
    }
    if (!data) return notFound(requestId, "Contato não encontrado.");
    return apiOk(toApiContact(data));
  }
);

/**
 * Nome, e-mail, observações e empresa. Telefone é imutável (o histórico é da
 * pessoa DESTE número): 422 explícito, em vez de descartar o campo em silêncio.
 */
export const PATCH = withApi<Params>(
  { route: "/api/v1/contacts/[id]", scopes: ["contacts:write"] },
  async ({ request, params, requestId, supabase }) => {
    if (!isUuid(params.id)) return notFound(requestId, "Contato não encontrado.");

    const body = await readJsonBody(request);
    if (body.error) return apiError(requestId, 400, "invalid_json", "JSON inválido.");
    if (body.data !== null && typeof body.data === "object" && "phone" in body.data) {
      const message = "O telefone de um contato não pode ser alterado.";
      return apiError(requestId, 422, "phone_immutable", message, { fields: { phone: message } });
    }

    const parsed = updateContactSchema.safeParse(body.data);
    if (!parsed.success) return invalidInput(requestId, parsed.error);
    if (Object.keys(parsed.data).length === 0) {
      return apiError(requestId, 400, "validation_error", "Nada para alterar.");
    }

    const { data, error } = await supabase
      .from("contacts")
      .update(parsed.data)
      .eq("id", params.id)
      .is("anonymized_at", null)
      .select(CONTACT_API_SELECT)
      .maybeSingle();
    if (error) {
      // Empresa arquivada (trigger) ou inexistente (FK) é erro do campo.
      const mapped = mapCadastroError(error);
      if (mapped.field === "customer_id" && mapped.status === 422) {
        return apiError(requestId, 422, "invalid_customer", mapped.message, {
          fields: { customer_id: mapped.message },
        });
      }
      // Valor que o banco não aceitou pelo tipo: o schema deveria ter barrado.
      if (mapped.status === 400) return apiError(requestId, 400, "validation_error", mapped.message);
      throw new Error(`contacts update: ${error.message}`);
    }
    if (!data) return notFound(requestId, "Contato não encontrado.");
    return apiOk(toApiContact(data));
  }
);
