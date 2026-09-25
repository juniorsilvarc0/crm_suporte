import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import {
  deleteEnvironmentVariableSchema,
  environmentVariableSchema,
} from "@/features/settings/schemas/environment-variable";
import { requireDashboardAdmin } from "@/lib/auth/require-dashboard-session";
import { readJsonBody } from "@/lib/http/read-json-body";
import {
  createSupabaseAdminClient,
  hasSupabaseAdminEnv,
} from "@/lib/supabase/admin";

export const runtime = "nodejs";

function unavailable() {
  return NextResponse.json(
    { ok: false, message: "O armazenamento seguro não está configurado." },
    { status: 500 }
  );
}

export async function POST(request: Request) {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;
  if (!hasSupabaseAdminEnv()) return unavailable();

  const body = await readJsonBody(request);
  if (body.error) {
    return NextResponse.json(
      { ok: false, message: "JSON inválido." },
      { status: 400 }
    );
  }

  const parsed = environmentVariableSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        message: "Revise os campos destacados.",
        errors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("set_app_environment_variable", {
    p_name: parsed.data.name,
    p_value: parsed.data.value,
    p_replace: parsed.data.replace,
  });

  if (error?.code === "23505") {
    return NextResponse.json(
      {
        ok: false,
        message: "Esta variável já existe.",
        errors: { name: ["Use a ação Substituir na variável existente."] },
      },
      { status: 409 }
    );
  }
  if (error || !data) {
    return NextResponse.json(
      { ok: false, message: "Não foi possível salvar a variável." },
      { status: 500 }
    );
  }

  revalidatePath("/app/configuracoes");
  return NextResponse.json({
    ok: true,
    name: parsed.data.name,
    message: "Variável salva com segurança.",
  });
}

export async function DELETE(request: Request) {
  const auth = await requireDashboardAdmin();
  if ("error" in auth) return auth.error;
  if (!hasSupabaseAdminEnv()) return unavailable();

  const body = await readJsonBody(request);
  if (body.error) {
    return NextResponse.json(
      { ok: false, message: "JSON inválido." },
      { status: 400 }
    );
  }

  const parsed = deleteEnvironmentVariableSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: "Variável inválida." },
      { status: 400 }
    );
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("delete_app_environment_variable", {
    p_name: parsed.data.name,
  });

  if (error) {
    return NextResponse.json(
      { ok: false, message: "Não foi possível remover a variável." },
      { status: 500 }
    );
  }
  if (!data) {
    return NextResponse.json(
      { ok: false, message: "Variável não encontrada." },
      { status: 404 }
    );
  }

  revalidatePath("/app/configuracoes");
  return NextResponse.json({ ok: true, message: "Variável removida." });
}
