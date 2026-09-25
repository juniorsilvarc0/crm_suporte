// Sinaliza ao agente que um humano ASSUMIU (assumed:true) ou LIBEROU
// (assumed:false) uma conversa, para o bot pausar/reativar aquele contato. O
// agente não enxerga o "Assumir" no CRM (o inbound é uazapi→CRM→relay→agente),
// então sem este sinal o bot continua respondendo após o humano assumir.
//
// Best-effort com UM retry curto (o contrato recomenda): a falha não desfaz o
// takeover no CRM, mas se o sinal não chegar o bot pode continuar respondendo.
// Nunca lança — devolve o resultado.
export type TakeoverPushResult = {
  delivered: boolean;
  skipped: boolean; // sem TAKEOVER_AGENT_URL configurado, ou sem telefone
  error?: string;
};

const TIMEOUT_MS = 5000;

export async function pushTakeoverToAgent(
  phone: string | null | undefined,
  assumed: boolean
): Promise<TakeoverPushResult> {
  const url = process.env.TAKEOVER_AGENT_URL?.trim();
  if (!url || !phone) return { delivered: false, skipped: true };

  // Mesmo segredo do push de assinatura (Bearer), conforme o contrato.
  const secret = process.env.BOT_SIGNATURE_AGENT_SECRET?.trim();

  const attempt = async (): Promise<{ ok: boolean; error?: string }> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
        },
        body: JSON.stringify({ phone, assumed }),
        signal: controller.signal,
      });
      return res.ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "erro" };
    } finally {
      clearTimeout(timer);
    }
  };

  let result = await attempt();
  if (!result.ok) result = await attempt(); // um retry curto (contrato)

  return {
    delivered: result.ok,
    skipped: false,
    error: result.ok ? undefined : result.error,
  };
}
