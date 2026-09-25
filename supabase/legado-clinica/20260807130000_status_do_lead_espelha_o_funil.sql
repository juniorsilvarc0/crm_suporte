-- Repara `leads.status` para espelhar a etapa real do card no funil.
--
-- Contexto: o funil renderiza `deals`. `leads.status` é a PROJEÇÃO desse
-- estado, lida pela lista de leads, pelos filtros e por todo o dashboard.
-- O arrastar do Kanban (PATCH /api/deals/[id]/stage) nunca escreveu em
-- `leads`, então a projeção congelou. Medido em 2026-08-06, em produção:
--
--   etapa            deals   leads.status
--   novo                66            273
--   em_atendimento     214              2
--   qualificado          1              7
--
--   226 de 318 leads divergiam do próprio card. O dashboard mostrava
--   "Sem contato: 273 (86%)" quando a coluna "Novo" do funil tinha 66.
--
-- A rota corrigida reprojeta a cada movimentação (features/deals/queries/
-- sync-lead-status.ts). Esta migration repara o passado.
--
-- ORDEM DE DEPLOY: pode rodar antes ou depois do código — é só dado, não muda
-- contrato. Rodar antes deixa o dashboard certo já no deploy.
--
-- Idempotente: rodar de novo não altera linha nenhuma.
--
-- Sem `begin`/`commit` explícitos, como as demais migrations do projeto: o
-- runner já envolve o arquivo numa transação, e abrir outra dentro dela
-- encerraria a de fora no `commit`, quebrando a atomicidade do próprio runner.

-- 1. Backup antes de reescrever. Para reverter:
--
--      update public.leads l
--      set status = b.status,
--          qualificado_at = b.qualificado_at,
--          agendado_at = b.agendado_at,
--          compareceu_at = b.compareceu_at,
--          cliente_at = b.cliente_at
--      from public.leads_status_backup_20260807 b
--      where b.id = l.id;
create table if not exists public.leads_status_backup_20260807 (
  id uuid primary key,
  status text,
  qualificado_at timestamptz,
  agendado_at timestamptz,
  compareceu_at timestamptz,
  cliente_at timestamptz,
  backed_up_at timestamptz not null default now()
);

alter table public.leads_status_backup_20260807 enable row level security;
revoke all on public.leads_status_backup_20260807 from anon, authenticated;

-- `do nothing` mantém o snapshot da PRIMEIRA execução, que é o estado a que se
-- quer voltar. Reexecutar não sobrescreve o backup com o dado já corrigido.
insert into public.leads_status_backup_20260807
  (id, status, qualificado_at, agendado_at, compareceu_at, cliente_at)
select id, status, qualificado_at, agendado_at, compareceu_at, cliente_at
from public.leads
on conflict (id) do nothing;

-- 2. Projeta o card sobre o lead. Mesma regra de projectLeadStatus():
--    ganho > aberto mais avançado (maior position) > perdido.
--    A ordem importa: `position` sozinha elegeria `perdido`, a última coluna.
--    Etapa que não existe em board_columns fica de fora pelo join.
with projetado as (
  select distinct on (d.lead_id)
    d.lead_id,
    c.key
  from public.deals d
  join public.board_columns c on c.key = d.stage
  order by
    d.lead_id,
    case c.stage_type when 'won' then 2 when 'lost' then 0 else 1 end desc,
    c.position desc
)
update public.leads l
set status = p.key
from projetado p
where p.lead_id = l.id
  and l.status is distinct from p.key;

-- 3. Reconstrói os marcos do funil a partir do histórico de transições, que o
--    trigger trg_deals_stage_history vem gravando desde sempre. Sem isto, os
--    leads reparados no passo 2 ficariam com status novo e marco nulo, e o
--    "tempo médio de conversão" do dashboard seguiria cego.
--
--    Só preenche o que está nulo: `agendado_at` legítimo guarda a data do
--    agendamento (escrita por /api/appointments), não a data da transição.
with marcos as (
  select
    lead_id,
    min(occurred_at) filter (where to_stage = 'qualificado') as qualificado_at,
    min(occurred_at) filter (where to_stage = 'agendado')    as agendado_at,
    min(occurred_at) filter (where to_stage = 'compareceu')  as compareceu_at,
    min(occurred_at) filter (where to_stage = 'cliente')     as cliente_at
  from public.deal_stage_history
  where lead_id is not null
  group by lead_id
)
update public.leads l
set
  qualificado_at = coalesce(l.qualificado_at, m.qualificado_at),
  agendado_at    = coalesce(l.agendado_at,    m.agendado_at),
  compareceu_at  = coalesce(l.compareceu_at,  m.compareceu_at),
  cliente_at     = coalesce(l.cliente_at,     m.cliente_at)
from marcos m
where m.lead_id = l.id
  and (
    (l.qualificado_at is null and m.qualificado_at is not null) or
    (l.agendado_at    is null and m.agendado_at    is not null) or
    (l.compareceu_at  is null and m.compareceu_at  is not null) or
    (l.cliente_at     is null and m.cliente_at     is not null)
  );
