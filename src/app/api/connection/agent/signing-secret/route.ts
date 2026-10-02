import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { recordIntegrationLog } from "@/features/integrations/queries/record-integration-log";
import { RELAY_SIGNING_SECRET_NAME } from "@/features/settings/types";
import { requireDashboardAdmin } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import { createSupabaseAdminClient, hasSupabaseAdminEnv } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// A chave com que o CRM assina o que envia ao agente (docs/CONTRATO-RELAY.md,
// seção 4). Quem gera é o CRM: 32 bytes aleatórios, gravados no Cofre e
// devolvidos UMA vez, na resposta de quem gerou. Ela não se grava à mão (a rota
// do Cofre recusa o nome), então nunca é fraca nem copiada de outro lugar.
//
// Gerar, trocar e remover valem a partir do envio seguinte, em todas as
// réplicas: o relay lê a chave na hora, e ela não entra no cache do cofre.
//
// Uma tela desatualizada não mexe na chave que outro administrador gerou:
// - gerar (sem `replace`) com a chave já existente é 409;
// - trocar e remover levam o `updated_at` que a tela mostrava, e a rota recusa
//   (409) se a chave guardada já não é essa. A conferência e a gravação não são
//   um passo só no banco: sobra uma janela de milissegundos, que a releitura
//   depois de gravar cobre para quem gerou.
//
// Erro do cofre ao gravar ou ao remover não é tratado como "não aconteceu": a
// resposta do banco pode ter se perdido depois do commit. A rota confere o que
// ficou guardado, e só diz que falhou quando viu que nada mudou.

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/** O `updated_at` da chave vista na tela: um carimbo do PostgREST, comparado como texto. */
const stamp = z.string().min(1).max(64);

const generateSchema = z
  .strictObject({
    // true = troca a chave que já existe. O corpo é estrito: a chave nunca vem de fora.
    replace: z.boolean().default(false),
    expectedUpdatedAt: stamp.optional(),
  })
  // Trocar exige dizer qual chave; gerar a primeira não tem o que dizer.
  .refine((value) => value.replace === (value.expectedUpdatedAt !== undefined));

const removeSchema = z.strictObject({ expectedUpdatedAt: stamp });

const STALE = "A chave mudou depois que esta tela foi carregada. Confira o estado e tente de novo.";

/**
 * Uma recusa. `applied: false` marca o erro de servidor em que NADA foi gravado:
 * a tela mostra o motivo. Num 5xx sem a marca o desfecho é desconhecido, e a
 * tela manda conferir o estado (todo 4xx já quer dizer "nada foi feito").
 */
function reply(status: number, message: string, applied?: false) {
  return NextResponse.json(
    { ok: false, message, ...(applied === false ? { applied: false } : {}) },
    { status }
  );
}

/** O carimbo da chave guardada (`null` = não há). LANÇA se a leitura falhar. */
async function storedStamp(supabase: Admin): Promise<string | null> {
  const { data, error } = await supabase
    .from("app_environment_variables")
    .select("updated_at")
    .eq("name", RELAY_SIGNING_SECRET_NAME)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.updated_at ?? null;
}

/**
 * Quem gerou, trocou ou removeu a chave, e quando: é a primeira pergunta quando
 * o agente passa a recusar. A ação já aconteceu: uma falha ao registrar não
 * derruba a resposta (quem gerou ficaria sem a chave que já vale).
 */
async function audit(supabase: Admin, action: "generated" | "rotated" | "removed", viewerId: string) {
  try {
    await recordIntegrationLog(supabase, {
      provider: "relay",
      action: `signing_secret.${action}`,
      status: "ok",
      payload: { by: viewerId },
    });
  } catch (error) {
    console.error("[agent] registrar a ação na chave de assinatura falhou:", error);
  }
}

export async function POST(request: Request) {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;
  if (!hasSupabaseAdminEnv()) return reply(500, "O armazenamento seguro não está configurado.", false);

  const body = await readJsonBody(request);
  if (body.error) return reply(400, "JSON inválido.");
  const parsed = generateSchema.safeParse(body.data);
  if (!parsed.success) return reply(400, "Pedido inválido.");
  const { replace, expectedUpdatedAt } = parsed.data;

  const supabase = createSupabaseAdminClient();
  if (replace) {
    let current: string | null;
    try {
      current = await storedStamp(supabase);
    } catch (error) {
      console.error("[agent] ler a chave de assinatura falhou:", error);
      return reply(500, "Não foi possível conferir a chave atual.", false);
    }
    if (current !== expectedUpdatedAt) return reply(409, STALE);
  }

  const secret = randomBytes(32).toString("hex");
  const { data, error } = await supabase.rpc("set_app_environment_variable", {
    p_name: RELAY_SIGNING_SECRET_NAME,
    p_value: secret,
    p_replace: replace,
  });

  if (error?.code === "23505") {
    return reply(409, "Já existe uma chave de assinatura. Para trocá-la, use Gerar nova chave.");
  }
  // O cofre confirmou a gravação? Um erro aqui não quer dizer que nada foi
  // gravado: a resposta do banco pode ter se perdido depois do commit. Só o
  // código vai para o log (o pedido levava a chave).
  const confirmed = !error && Boolean(data);
  if (!confirmed) {
    console.error("[agent] gravar a chave de assinatura falhou:", error?.code ?? "sem confirmação");
  }

  // A releitura decide o que ficou guardado. A chave devolvida tem de ser essa:
  // duas trocas quase ao mesmo tempo gravam as duas, e só a última vale.
  const stored = await supabase.rpc("get_app_environment_variable", { p_name: RELAY_SIGNING_SECRET_NAME });
  if (stored.error) {
    console.error("[agent] conferir a chave gravada falhou:", stored.error.message);
    // Sem a conferência, vale o que o cofre respondeu ao gravar. Se ele não
    // confirmou, o desfecho é desconhecido (sem a marca `applied`).
    if (!confirmed) return reply(500, "Não foi possível gerar a chave.");
  } else if (stored.data !== secret) {
    return confirmed
      ? reply(409, "Outra troca da chave aconteceu ao mesmo tempo. Confira o estado e gere de novo.")
      : reply(500, "Não foi possível gerar a chave.", false);
  }

  await audit(supabase, replace ? "rotated" : "generated", auth.viewer.id);
  revalidatePath("/app/conexao");
  // A chave em texto puro sai só aqui: a tela a mostra para cópia e não tem
  // como lê-la de novo.
  return NextResponse.json(
    { ok: true, secret, message: "Chave gerada." },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function DELETE(request: Request) {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;
  if (!hasSupabaseAdminEnv()) return reply(500, "O armazenamento seguro não está configurado.", false);

  const body = await readJsonBody(request);
  if (body.error) return reply(400, "JSON inválido.");
  const parsed = removeSchema.safeParse(body.data);
  if (!parsed.success) return reply(400, "Pedido inválido.");

  const supabase = createSupabaseAdminClient();
  let current: string | null;
  try {
    current = await storedStamp(supabase);
  } catch (error) {
    console.error("[agent] ler a chave de assinatura falhou:", error);
    return reply(500, "Não foi possível conferir a chave atual.", false);
  }
  if (current === null) return reply(404, "Não há chave de assinatura.");
  if (current !== parsed.data.expectedUpdatedAt) return reply(409, STALE);

  const { data, error } = await supabase.rpc("delete_app_environment_variable", {
    p_name: RELAY_SIGNING_SECRET_NAME,
  });
  if (error) {
    console.error("[agent] remover a chave de assinatura falhou:", error.code ?? "sem código");
    // Como ao gravar: o erro pode ter vindo depois do commit. O carimbo decide.
    let after: string | null;
    try {
      after = await storedStamp(supabase);
    } catch {
      // Nem a conferência respondeu: desfecho desconhecido.
      return reply(500, "Não foi possível remover a chave.");
    }
    if (after !== null) return reply(500, "Não foi possível remover a chave.", false);
  } else if (!data) {
    return reply(404, "Não há chave de assinatura.");
  }

  await audit(supabase, "removed", auth.viewer.id);
  revalidatePath("/app/conexao");
  return NextResponse.json({
    ok: true,
    message: "Chave removida: os pedidos ao agente passam a sair sem assinatura.",
  });
}
