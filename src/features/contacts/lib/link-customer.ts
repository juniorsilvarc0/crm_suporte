// Liga, troca ou desliga a empresa de um contato pelo PATCH da rota do contato
// (`customer_id`: uuid liga, `null` desliga). Um só caminho de escrita para os
// três chamadores — painel do contato no chat, diálogo de Contatos e ficha da
// empresa — em vez de três fetch com três leituras de erro diferentes.
//
// Neutro (só `fetch`): quem chama é client component.

export type LinkCustomerResult = {
  ok: boolean;
  /** Mensagem pronta para a tela: a do servidor, ou uma genérica. */
  message: string;
  /** Status HTTP; 0 = a requisição nem chegou (rede). 422 = empresa recusada. */
  status: number;
};

const FAILURE_MESSAGE = "Não foi possível atualizar a empresa do contato.";

type PatchPayload = {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string[] | undefined>;
};

export async function linkContactToCustomer(
  contactId: string,
  customerId: string | null
): Promise<LinkCustomerResult> {
  try {
    const response = await fetch(`/api/contacts/${encodeURIComponent(contactId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customer_id: customerId }),
    });
    const payload = (await response.json().catch(() => null)) as PatchPayload | null;

    if (response.ok && payload?.ok) {
      return { ok: true, message: payload.message ?? "Contato atualizado.", status: response.status };
    }
    // O erro do campo é o mais específico ("Empresa arquivada. Reative-a
    // antes."); a mensagem geral vem depois.
    const message = payload?.errors?.customer_id?.[0] ?? payload?.message ?? FAILURE_MESSAGE;
    return { ok: false, message, status: response.status };
  } catch {
    return { ok: false, message: FAILURE_MESSAGE, status: 0 };
  }
}
