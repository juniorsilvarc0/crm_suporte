-- ============================================================================
--   20261021120000_etiquetas_de_ticket.sql  —  Etiquetas do ticket
--
--   O ticket ganha etiquetas do MESMO vocabulário das conversas (`tags`): a
--   "duvida" do ticket é a mesma etiqueta "duvida" do chat. Elas existem para o
--   rastreio e os relatórios: quem triou o atendimento (a IA de triagem, pela
--   API v1) marca o que aconteceu — o tipo do pedido, como evoluiu, como
--   terminou (`duvida`, `evoluiu-para-problema`, `resolvido-pela-ia`, ...).
--
--   - Só acrescenta. Nada aqui tira etiqueta de ticket: o que foi marcado fica,
--     e a trilha guarda quem marcou e quando (`ticket.tags_added`).
--   - Etiqueta que ainda não existe nasce na hora, na cor padrão da tabela
--     (slate). A comparação é a do índice único de `tags` (tags_name_lower_uidx):
--     sem caixa e sem o espaço das pontas ("Dúvida" e "dúvida " são a mesma).
--   - Ticket resolvido ou encerrado também recebe etiqueta: classificar depois
--     é parte da análise, e não mexe em status, SLA nem versão do ticket.
--   - Escrita só pela RPC (security definer); o service_role só LÊ (detalhe do
--     ticket e métricas).
--
--   Aditiva e idempotente. Depende de 20260925120300_contatos (tags),
--   20260925120900_tickets e 20260929170000_api_v1_fundacao (ator ai/api).
-- ============================================================================

do $$
begin
  if to_regclass('public.tickets') is null
     or to_regclass('public.tags') is null
     or to_regclass('public.tags_name_lower_uidx') is null
     or to_regclass('public.api_tokens') is null
     or to_regprocedure('public.require_ticket_actor(uuid, uuid)') is null
     or to_regprocedure('public.ticket_record_event(uuid, text, text, uuid, uuid, jsonb, text)') is null
     or to_regprocedure('public.assert_security_baseline()') is null then
    raise exception 'TICKET_TAGS: aplique as migrations de contatos, tickets e da API v1 antes';
  end if;
end
$$;

create table if not exists public.ticket_tags (
  ticket_id           uuid not null,
  tag_id              uuid not null,
  created_at          timestamptz not null default now(),
  created_by_user_id  uuid,
  created_by_token_id uuid,
  constraint ticket_tags_pkey primary key (ticket_id, tag_id),
  constraint ticket_tags_ticket_id_fkey
    foreign key (ticket_id) references public.tickets (id) on delete cascade,
  -- Como conversation_tags e contact_tags: a etiqueta apagada no cadastro sai
  -- dos tickets. O nome continua na trilha (ticket.tags_added).
  constraint ticket_tags_tag_id_fkey
    foreign key (tag_id) references public.tags (id) on delete cascade,
  constraint ticket_tags_created_by_user_id_fkey
    foreign key (created_by_user_id) references public.app_users (id) on delete set null,
  constraint ticket_tags_created_by_token_id_fkey
    foreign key (created_by_token_id) references public.api_tokens (id) on delete set null,
  -- Um autor só (a RPC grava exatamente um; o set null pode zerar).
  constraint ticket_tags_actor_check
    check (pg_catalog.num_nonnulls(created_by_user_id, created_by_token_id) <= 1)
);

comment on table public.ticket_tags is
  'Etiquetas do ticket (vocabulário de tags). Só acrescenta, pela RPC ticket_add_tags; a trilha é ticket.tags_added.';

-- Recorte das métricas por etiqueta (tag → tickets). O ticket → tags é a PK.
create index if not exists ticket_tags_tag_id_idx on public.ticket_tags (tag_id);

alter table public.ticket_tags enable row level security;
-- Escrita só pela RPC; o service_role lê (detalhe do ticket e métricas).
revoke all on table public.ticket_tags from public, anon, authenticated, service_role;
grant select on table public.ticket_tags to service_role;

-- ============================================================================
-- RPC
-- ============================================================================

-- Acrescenta etiquetas ao ticket. p_names: 1 a 20 nomes, cada um com 1 a 30
-- caracteres depois de tirar o espaço das pontas (o limite da tela de
-- etiquetas), sem caractere de controle. Repetidos (mesmo nome sem caixa)
-- contam uma vez. Exatamente um ator: usuário ativo ou token vigente
-- (require_ticket_actor). Devolve jsonb:
--   { added: [nomes que entraram agora], tags: [{id, name, color}] }  -- todas, pelo nome
-- Repetir é seguro: o que já estava no ticket não entra de novo nem gera trilha.
-- Ticket que não existe: TICKET_NOT_FOUND. Nomes fora do formato: INVALID_TAGS.
create or replace function public.ticket_add_tags(
  p_ticket_id      uuid,
  p_names          text[],
  p_actor_user_id  uuid default null,
  p_actor_token_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text;
  v_raw   text;
  v_name  text;
  v_seen  text[] := '{}';
  v_tag   uuid;
  v_canon text;
  v_added text[] := '{}';
begin
  v_actor := public.require_ticket_actor(p_actor_user_id, p_actor_token_id);

  if p_names is null
     or pg_catalog.cardinality(p_names) = 0
     or pg_catalog.cardinality(p_names) > 20 then
    raise exception 'INVALID_TAGS' using detail = 'Envie de 1 a 20 etiquetas.';
  end if;

  -- KEY SHARE: o ticket não some no meio, e quem altera o ticket não espera.
  perform 1 from public.tickets t where t.id = p_ticket_id for key share;
  if not found then
    raise exception 'TICKET_NOT_FOUND';
  end if;

  foreach v_raw in array p_names loop
    v_name := pg_catalog.btrim(coalesce(v_raw, ''));
    if pg_catalog.char_length(v_name) not between 1 and 30 or v_name ~ '[[:cntrl:]]' then
      raise exception 'INVALID_TAGS'
        using detail = 'Cada etiqueta tem de 1 a 30 caracteres, sem caractere de controle.';
    end if;
    continue when pg_catalog.lower(v_name) = any (v_seen);
    v_seen := v_seen || pg_catalog.lower(v_name);

    v_tag := null;
    select g.id, g.name into v_tag, v_canon
      from public.tags g
     where pg_catalog.lower(pg_catalog.btrim(g.name)) = pg_catalog.lower(v_name);
    if v_tag is null then
      insert into public.tags (name) values (v_name)
      on conflict ((pg_catalog.lower(pg_catalog.btrim(name)))) do nothing
      returning id, name into v_tag, v_canon;
      if v_tag is null then
        -- Outra transação criou a mesma etiqueta ao mesmo tempo: usa a dela.
        select g.id, g.name into v_tag, v_canon
          from public.tags g
         where pg_catalog.lower(pg_catalog.btrim(g.name)) = pg_catalog.lower(v_name);
      end if;
    end if;

    insert into public.ticket_tags (ticket_id, tag_id, created_by_user_id, created_by_token_id)
    values (p_ticket_id, v_tag, p_actor_user_id, p_actor_token_id)
    on conflict (ticket_id, tag_id) do nothing;
    if found then
      v_added := v_added || v_canon;
    end if;
  end loop;

  if pg_catalog.cardinality(v_added) > 0 then
    perform public.ticket_record_event(p_ticket_id, 'ticket.tags_added', v_actor,
      p_actor_user_id, p_actor_token_id,
      pg_catalog.jsonb_build_object('tags', pg_catalog.to_jsonb(v_added)));
  end if;

  return pg_catalog.jsonb_build_object(
    'added', pg_catalog.to_jsonb(v_added),
    'tags', coalesce((
      select pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object('id', g.id, 'name', g.name, 'color', g.color)
               order by pg_catalog.lower(g.name), g.id)
        from public.ticket_tags tt
        join public.tags g on g.id = tt.tag_id
       where tt.ticket_id = p_ticket_id
    ), '[]'::jsonb));
end;
$$;

-- ============================================================================
-- Privilégios de função (EXECUTE nasce para PUBLIC: revogar de todos)
-- ============================================================================

revoke all on function public.ticket_add_tags(uuid, text[], uuid, uuid) from public, anon, authenticated;
grant execute on function public.ticket_add_tags(uuid, text[], uuid, uuid) to service_role;

-- O PostgREST guarda o schema em cache; sem o reload ele segue com o mapa antigo.
notify pgrst, 'reload schema';

select public.assert_security_baseline();
