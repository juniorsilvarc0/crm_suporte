// ============================================================================
// Reset de DEMONSTRAÇÃO — ZERA os dados operacionais do CRM (leads, contratos,
// pagamentos, agendamentos, follow-ups, tags e vínculos). NÃO mexe em usuários,
// etapas do funil (board_columns), integrações de chat nem configurações.
//
// Uso: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/reset-demo.mjs
//
// ⚠️  Apaga TODOS os leads/contratos/etc. — use para limpar a base de demo.
// ============================================================================

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !KEY) {
  console.error("Faltam SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY no ambiente.");
  process.exit(1);
}

const HEADERS = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
  Prefer: "count=exact",
};

// Filtro que casa TODAS as linhas (created_at existe em todas essas tabelas).
const ALL = "created_at=gte.1970-01-01";

async function wipe(table) {
  const res = await fetch(`${URL}/rest/v1/${table}?${ALL}`, {
    method: "DELETE",
    headers: HEADERS,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`delete ${table} falhou (${res.status}): ${text.slice(0, 300)}`);
  }
  const range = res.headers.get("content-range") || "";
  console.log(`  ${table}: apagado (${range})`);
}

async function main() {
  console.log(`Zerando dados de demonstração (${URL}) ...`);
  // Ordem segura de FKs: filhos antes dos pais.
  for (const table of ["payments", "lead_tags", "appointments", "followups", "contracts", "leads", "tags"]) {
    await wipe(table);
  }
  console.log("\n✅ Base zerada.");
}

main().catch((e) => {
  console.error("\n❌ Reset falhou:", e.message);
  process.exit(1);
});
