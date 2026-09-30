import { findContactIdByPhone } from "@/features/contacts/queries/find-contact-by-phone";
import { resolveContactIdentity, type ContactIdentityResolution } from "@/features/contacts/queries/resolve-contact-identity";
import {
  CONTACT_API_SELECT,
  contactListQuerySchema,
  createContactSchema,
  toApiContact,
} from "@/lib/api/v1/cadastros";
import { afterCursorFilter, cursorPage, searchParamsOf } from "@/lib/api/v1/cursor";
import { apiError } from "@/lib/api/v1/errors";
import { apiOk, apiPage, invalidInput, unavailable } from "@/lib/api/v1/responses";
import { withApi } from "@/lib/api/v1/with-api";
import { searchTokens } from "@/lib/formatters/search-text";
import { readJsonBody } from "@/lib/http/read-json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Contatos em ordem de `updated_at` crescente, com cursor. Anonimizado nunca
 * sai; arquivado só com `include_archived=true`.
 */
export const GET = withApi(
  { route: "/api/v1/contacts", scopes: ["contacts:read"] },
  async ({ request, requestId, supabase }) => {
    const parsed = contactListQuerySchema.safeParse(searchParamsOf(request));
    if (!parsed.success) return invalidInput(requestId, parsed.error);
    const params = parsed.data;

    let phoneContactId: string | null = null;
    if (params.phone) {
      try {
        phoneContactId = await findContactIdByPhone(supabase, params.phone);
      } catch (error) {
        console.error(`[api/v1] ${requestId} contacts phone`, error);
        return unavailable(requestId, "os contatos");
      }
      // Número sem dono: a página vazia é a resposta, sem outra consulta.
      if (!phoneContactId) return apiPage([], null);
    }

    let query = supabase.from("contacts").select(CONTACT_API_SELECT).is("anonymized_at", null);
    if (!params.include_archived) query = query.is("archived_at", null);
    if (phoneContactId) query = query.eq("id", phoneContactId);
    // Tokens só com [a-z0-9]: entram no ilike sem escape (search-text.ts).
    for (const token of searchTokens(params.q)) {
      query = query.ilike("search_name", `%${token}%`);
    }
    if (params.customer_id) query = query.eq("customer_id", params.customer_id);
    if (params.updated_since) query = query.gte("updated_at", params.updated_since);
    if (params.cursor) query = query.or(afterCursorFilter(params.cursor));

    const { data, error } = await query
      .order("updated_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(params.limit + 1);
    if (error) {
      console.error(`[api/v1] ${requestId} contacts`, error.message);
      return unavailable(requestId, "os contatos");
    }

    const page = cursorPage(data ?? [], params.limit);
    return apiPage(page.items.map(toApiContact), page.nextCursor);
  }
);

/**
 * Acha a pessoa pelo telefone ou a cria (`source: api`): 201 criado, 200 já
 * existia. Decisões do dono (2026-09-29): contato arquivado volta como está,
 * SEM desarquivar; o nome enviado só preenche um nome vazio.
 */
export const POST = withApi(
  { route: "/api/v1/contacts", scopes: ["contacts:write"], idempotency: "required" },
  async ({ request, requestId, supabase }) => {
    const body = await readJsonBody(request);
    if (body.error) return apiError(requestId, 400, "invalid_json", "JSON inválido.");
    const parsed = createContactSchema.safeParse(body.data);
    if (!parsed.success) return invalidInput(requestId, parsed.error);

    let identity: ContactIdentityResolution;
    try {
      identity = await resolveContactIdentity(supabase, {
        phone: parsed.data.phone,
        name: parsed.data.name,
        source: "api",
        reactivate: false,
      });
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
      // 23505 = o número já é alias de outra pessoa (corrida rara na RPC).
      if (code === "23505") {
        return apiError(requestId, 409, "phone_conflict", "Este telefone já pertence a outra pessoa.");
      }
      // Classe 22 = valor que o banco recusou (o schema deveria ter barrado).
      if (typeof code === "string" && code.startsWith("22")) {
        return apiError(requestId, 400, "validation_error", "Revise os campos.");
      }
      throw error;
    }

    const { data, error } = await supabase
      .from("contacts")
      .select(CONTACT_API_SELECT)
      .eq("id", identity.contactId)
      .is("anonymized_at", null)
      .maybeSingle();
    if (error) throw new Error(`contacts: ${error.message}`);
    // Contato não se apaga (sem DELETE): sumir aqui é anonimização (LGPD).
    if (!data) {
      return apiError(requestId, 409, "contact_anonymized", "Este telefone pertence a um contato anonimizado.");
    }

    return apiOk(toApiContact(data), { status: identity.created ? 201 : 200 });
  }
);
