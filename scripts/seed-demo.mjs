// ============================================================================
// Seed de DEMONSTRAÇÃO — popula o CRM com dados fictícios realistas, simulando
// ~6 meses em produção (leads espalhados pelo funil, contratos/pagamentos,
// agendamentos, tags). Usa a API REST do Supabase (service role), então
// conseguimos definir datas históricas (a API do app carimba created_at=now()).
//
// Uso:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-demo.mjs
//   (opcional) LEAD_COUNT=120
//
// Para zerar tudo: node scripts/reset-demo.mjs
// ============================================================================

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LEAD_COUNT = Number(process.env.LEAD_COUNT || 120);

if (!URL || !KEY) {
  console.error("Faltam SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY no ambiente.");
  process.exit(1);
}

const HEADERS = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

async function insert(table, rows) {
  if (rows.length === 0) return [];
  const res = await fetch(`${URL}/rest/v1/${table}`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`insert ${table} falhou (${res.status}): ${text.slice(0, 400)}`);
  }
  return res.json();
}

// ---- helpers de aleatoriedade ------------------------------------------------
const DAY = 86_400_000;
const rand = (min, max) => Math.random() * (max - min) + min;
const randInt = (min, max) => Math.floor(rand(min, max + 1));
const pick = (arr) => arr[randInt(0, arr.length - 1)];
const money = (min, max) => Math.round(rand(min, max) / 50) * 50;
function weighted(pairs) {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [v, w] of pairs) {
    if ((r -= w) <= 0) return v;
  }
  return pairs[0][0];
}
const iso = (date) => date.toISOString();
const daysAgo = (d) => new Date(Date.now() - d * DAY);
const addDays = (date, d) => new Date(date.getTime() + d * DAY);
const clampNow = (date) => (date.getTime() > Date.now() ? new Date(Date.now() - rand(0, 2) * DAY) : date);

// ---- catálogos ---------------------------------------------------------------
const FIRST = ["Maria", "José", "Ana", "João", "Francisca", "Antônio", "Adriana", "Carlos", "Juliana", "Paulo", "Fernanda", "Lucas", "Camila", "Rafael", "Beatriz", "Gabriel", "Larissa", "Marcos", "Patrícia", "Rodrigo", "Aline", "Bruno", "Vanessa", "Felipe", "Letícia", "Gustavo", "Amanda", "Diego", "Carolina", "Thiago", "Débora", "Vinícius", "Sabrina", "André", "Priscila", "Leonardo", "Tatiane", "Ricardo", "Michele", "Eduardo"];
const LAST = ["Silva", "Santos", "Oliveira", "Souza", "Lima", "Pereira", "Costa", "Rodrigues", "Almeida", "Nascimento", "Carvalho", "Araújo", "Ribeiro", "Gomes", "Martins", "Rocha", "Barbosa", "Fernandes", "Moraes", "Dias", "Cardoso", "Teixeira", "Correia", "Mendes", "Freitas"];
// DDDs variados p/ o "Por Estado" ficar rico (peso maior nos maiores mercados)
const DDDS = [[11, 10], [21, 6], [31, 5], [41, 4], [51, 4], [71, 4], [81, 4], [85, 4], [62, 3], [27, 3], [98, 3], [86, 3], [61, 3], [47, 2], [48, 2], [19, 2], [92, 2], [65, 2], [84, 2], [95, 1]];
const SOURCES = [["whatsapp", 45], ["anuncio", 20], ["indicacao", 15], ["agencia", 10], ["particular", 7], ["outro", 3]];
const STATUSES = [["novo", 28], ["em_atendimento", 15], ["qualificado", 12], ["agendado", 10], ["compareceu", 8], ["cliente", 12], ["recorrente", 7], ["perdido", 8]];
const TIPOS = ["reuniao", "consulta", "demonstracao", "proposta", "onboarding", "suporte", "outro"];
const PACOTES = ["50 fotos digitais", "Álbum + Photolivro 30 fotos", "Promoção 10 fotos", "Ensaio completo", "Pacote família", "Sessão newborn"];
const PAY_METHODS = ["pix", "credito", "debito", "dinheiro", "link"];
const TAGS = [
  { name: "Quente", color: "rose" },
  { name: "VIP", color: "amber" },
  { name: "Indicação", color: "emerald" },
  { name: "Retorno", color: "violet" },
  { name: "Frio", color: "sky" },
];

// ordem do funil (quais etapas já foram "passadas" por status)
const ORDER = ["novo", "em_atendimento", "qualificado", "agendado", "compareceu", "cliente", "recorrente"];
const reached = (status, stage) => {
  if (status === "perdido") return stage === "novo";
  return ORDER.indexOf(status) >= ORDER.indexOf(stage);
};

async function main() {
  console.log(`Semeando ~${LEAD_COUNT} leads (staging: ${URL}) ...`);

  // --- Tags ---
  const tags = await insert("tags", TAGS);
  console.log(`  tags: ${tags.length}`);

  // --- Leads ---
  const usedPhones = new Set();
  const leadRows = [];
  for (let i = 0; i < LEAD_COUNT; i++) {
    const status = weighted(STATUSES);
    const createdDaysAgo = randInt(2, 200);
    const created = daysAgo(createdDaysAgo);

    // Telefone único: 55 + DDD + 9 + 8 dígitos → normalized_phone = DDD+9+8 (11 díg.)
    let ddd, tail, normalized;
    do {
      ddd = weighted(DDDS);
      tail = String(randInt(10000000, 99999999));
      normalized = `${ddd}9${tail}`;
    } while (usedPhones.has(normalized));
    usedPhones.add(normalized);

    // Timestamps de etapa coerentes com o status
    let cursor = created;
    const stamp = (stage) => {
      if (!reached(status, stage) || stage === "novo") return null;
      cursor = clampNow(addDays(cursor, rand(0.5, 9)));
      return iso(cursor);
    };
    const qualificado_at = stamp("qualificado");
    const agendado_at = stamp("agendado");
    const compareceu_at = stamp("compareceu");
    const cliente_at = reached(status, "cliente") ? (stamp("cliente"), iso(cursor)) : null;

    const qualified = reached(status, "qualificado");
    leadRows.push({
      name: `${pick(FIRST)} ${pick(LAST)}`,
      phone: `55${normalized}`,
      normalized_phone: normalized,
      email: Math.random() < 0.4 ? `contato${i}@exemplo.com` : null,
      source: weighted(SOURCES),
      status,
      tipo_ensaio: qualified ? pick(TIPOS) : null,
      interesse: qualified ? pick(PACOTES) : null,
      valor_estimado: qualified ? money(500, 6000) : null,
      is_recorrente: status === "recorrente",
      last_message_at: status === "novo" && Math.random() < 0.6 ? null : iso(clampNow(addDays(created, rand(0, createdDaysAgo)))),
      qualificado_at,
      agendado_at,
      compareceu_at,
      cliente_at,
      created_at: iso(created),
      updated_at: iso(created),
    });
  }
  const leads = await insert("leads", leadRows);
  console.log(`  leads: ${leads.length}`);

  // --- lead_tags (vincula ~45% dos leads a 1-2 tags) ---
  const leadTags = [];
  for (const lead of leads) {
    if (Math.random() < 0.45) {
      const n = randInt(1, 2);
      const chosen = new Set();
      for (let k = 0; k < n; k++) chosen.add(pick(tags).id);
      for (const tag_id of chosen) leadTags.push({ lead_id: lead.id, tag_id });
    }
  }
  await insert("lead_tags", leadTags);
  console.log(`  lead_tags: ${leadTags.length}`);

  // --- Contratos + pagamentos (clientes/recorrentes) ---
  const contractRows = [];
  const contractPlan = []; // guarda pagamentos após inserir p/ pegar ids
  for (const lead of leads) {
    if (lead.status !== "cliente" && lead.status !== "recorrente") continue;
    const nContracts = lead.status === "recorrente" ? randInt(2, 4) : 1;
    let base = new Date(lead.cliente_at ?? lead.created_at);
    for (let k = 0; k < nContracts; k++) {
      base = clampNow(addDays(base, k === 0 ? rand(0, 5) : rand(20, 70)));
      const total = money(800, 6500);
      const discount = Math.random() < 0.3 ? money(50, 400) : 0;
      const status = Math.random() < 0.75 ? "quitado" : "aberto";
      const signal = Math.random() < 0.6 ? money(100, Math.max(150, total * 0.3)) : 0;
      contractRows.push({
        lead_id: lead.id,
        package_name: pick(PACOTES),
        total_amount: total,
        signal_amount: signal,
        discount,
        status,
        created_at: iso(base),
        updated_at: iso(base),
      });
      contractPlan.push({ leadId: lead.id, base: new Date(base), total, discount, status });
    }
  }
  const contracts = await insert("contracts", contractRows);
  console.log(`  contracts: ${contracts.length}`);

  // --- Pagamentos ---
  const paymentRows = [];
  contracts.forEach((c, idx) => {
    const plan = contractPlan[idx];
    const net = plan.total - plan.discount;
    if (plan.status === "quitado") {
      // 1-3 parcelas pagas somando ~net
      const parts = randInt(1, 3);
      let remaining = net;
      for (let p = 0; p < parts; p++) {
        const amount = p === parts - 1 ? remaining : money(remaining / parts / 1.5, remaining / parts * 1.2);
        remaining = Math.max(0, remaining - amount);
        const paid = clampNow(addDays(plan.base, p * randInt(15, 35)));
        paymentRows.push({
          lead_id: plan.leadId,
          contract_id: c.id,
          amount: Math.max(50, Math.round(amount)),
          method: pick(PAY_METHODS),
          installments: parts,
          is_signal: p === 0,
          status: "pago",
          due_at: iso(paid),
          paid_at: iso(paid),
          created_at: iso(plan.base),
        });
      }
    } else {
      // aberto: um sinal pago + uma parcela pendente/atrasada
      if (Math.random() < 0.7) {
        paymentRows.push({
          lead_id: plan.leadId, contract_id: c.id, amount: money(150, Math.max(200, net * 0.4)),
          method: pick(PAY_METHODS), installments: 1, is_signal: true, status: "pago",
          due_at: iso(plan.base), paid_at: iso(plan.base), created_at: iso(plan.base),
        });
      }
      paymentRows.push({
        lead_id: plan.leadId, contract_id: c.id, amount: money(200, Math.max(250, net * 0.6)),
        method: "parcelado", installments: 1, is_signal: false, status: "pendente",
        due_at: iso(addDays(plan.base, randInt(10, 45))), paid_at: null, created_at: iso(plan.base),
      });
    }
  });
  await insert("payments", paymentRows);
  console.log(`  payments: ${paymentRows.length}`);

  // --- Agendamentos (agendado/compareceu + alguns futuros) ---
  const appts = [];
  for (const lead of leads) {
    if (!["agendado", "compareceu", "cliente", "recorrente"].includes(lead.status)) continue;
    if (Math.random() < 0.35) continue;
    const isPast = lead.status !== "agendado" || Math.random() < 0.5;
    const when = isPast
      ? new Date(lead.compareceu_at ?? lead.agendado_at ?? lead.created_at)
      : addDays(new Date(), randInt(1, 20));
    const status = lead.status === "agendado"
      ? (isPast ? pick(["faltou", "compareceu"]) : pick(["agendado", "confirmado"]))
      : "compareceu";
    appts.push({
      lead_id: lead.id,
      scheduled_at: iso(when),
      duration_min: pick([30, 45, 60, 90]),
      tipo_ensaio: lead.tipo_ensaio ?? pick(TIPOS),
      status,
      created_at: iso(new Date(lead.agendado_at ?? lead.created_at)),
      updated_at: iso(new Date(lead.agendado_at ?? lead.created_at)),
    });
  }
  await insert("appointments", appts);
  console.log(`  appointments: ${appts.length}`);

  // --- Follow-ups pendentes ---
  const fups = [];
  for (const lead of leads) {
    if (["em_atendimento", "qualificado", "agendado"].includes(lead.status) && Math.random() < 0.2) {
      fups.push({
        lead_id: lead.id,
        scheduled_for: iso(addDays(new Date(), randInt(1, 14))),
        status: "pendente",
        message: "Retomar contato com o cliente.",
        created_at: iso(new Date()),
      });
    }
  }
  await insert("followups", fups);
  console.log(`  followups: ${fups.length}`);

  console.log("\n✅ Seed de demonstração concluído.");
}

main().catch((e) => {
  console.error("\n❌ Seed falhou:", e.message);
  process.exit(1);
});
