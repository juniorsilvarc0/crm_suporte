-- ---------------------------------------------------------------------------
-- Etapa do funil que conta como conversão.
--
-- Contexto: a taxa de conversão do dashboard usava `stage_type = 'won'`, e
-- `won` só existe em `cliente` e `recorrente`. Nesta clínica o marco comercial
-- que importa é `compareceu` — etapa aberta. Resultado: 1 conversão em 320
-- leads (0,3%) numa base com 30 agendados e 5 comparecimentos.
--
-- `stage_type` continua sendo outra coisa: diz se a etapa FECHA o card (ganho
-- ou perdido), e é o que a venda usa para achar a coluna de destino
-- (resolve-won-stage.ts). Conversão é uma pergunta comercial independente, e
-- por isso ganha campo próprio em vez de mais um valor em `stage_type`.
--
-- Podem existir várias etapas marcadas. Conta apenas quem está EXATAMENTE numa
-- delas — não há inferência por posição.
--
-- Backfill: as etapas de ganho já marcadas mantêm o número de hoje idêntico.
--
-- Idempotente: `if not exists` + update condicionado.
-- Sem `begin`/`commit`: o runner já envolve o arquivo numa transação.

alter table public.board_columns
  add column if not exists counts_as_conversion boolean not null default false;

comment on column public.board_columns.counts_as_conversion is
  'Leads nesta etapa entram na taxa de conversão do dashboard. Independente de stage_type.';

-- Preserva o comportamento anterior: conversão = etapas de ganho.
update public.board_columns
set counts_as_conversion = true
where stage_type = 'won'
  and counts_as_conversion = false;
