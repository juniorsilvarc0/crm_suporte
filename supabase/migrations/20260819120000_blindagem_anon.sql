-- ============================================================================
-- BLINDAGEM DO PAPEL `anon` — pré-requisito para expor o PostgREST na internet.
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- Até aqui o navegador se identificava com a chave `anon`, que é PÚBLICA por
-- natureza: vai embutida no bundle JavaScript e qualquer pessoa a lê no
-- DevTools. Enquanto o PostgREST só existia na rede interna, isso era contido.
-- Ao publicá-lo (o Realtime do chat exige que o navegador o alcance), tudo que
-- `anon` enxerga passa a ser LEITURA PÚBLICA NA INTERNET.
--
-- O app passou a emitir um JWT curto com `role: authenticated`
-- (`src/lib/auth/supabase-token.ts`), então `anon` não precisa mais de acesso
-- nenhum. Esta migration recolhe tudo que foi concedido a ele.
--
-- O QUE O LEVANTAMENTO NO BANCO MOSTROU (não foi suposição — foi consulta)
--
--   1. `alter default privileges` concede `arwdDxtm` (TODOS os privilégios) a
--      `anon` em TODA TABELA NOVA do schema public. Seis tabelas já nasceram
--      assim: api_tokens, app_settings, chat_conversations, chat_messages,
--      conversation_tags e user_notes. Só duas são legíveis hoje (as de chat,
--      que têm policy); as outras quatro estão a UMA policy mal escrita de
--      virarem públicas. `api_tokens` com INSERT e UPDATE para anon é o pior
--      caso possível.
--   2. Seis funções `security definer` são executáveis por `anon`. Duas delas
--      — `register_sale` e `update_sale` — ESCREVEM, e o PostgREST as expõe
--      como `/rest/v1/rpc/<nome>`. No Postgres, função nasce com EXECUTE para
--      PUBLIC; só um `revoke` explícito fecha.
--
-- O QUE O NAVEGADOR REALMENTE PRECISA (verificado no código, é o teto)
--
--   REST:     select em chat_conversations
--             (use-conversations.ts:102 e forward-dialog.tsx)
--   Realtime: chat_conversations e chat_messages
--
--   Nada mais. Todo o resto passa por rota do app com service role.
--
-- ⚠️ Esta migration TERMINA COM ASSERÇÕES que falham se o objetivo não foi
-- cumprido. Migration de segurança que "passa" sem ter fechado nada é pior que
-- migration nenhuma, porque gera confiança falsa.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. A raiz: parar de conceder tudo a `anon` em objeto NOVO.
--
-- Sem este bloco, a próxima tabela criada por qualquer migration volta a nascer
-- aberta, e a blindagem abaixo vira trabalho de uma sessão só.
--
-- Há DOIS donos de default privileges neste banco (`postgres` e
-- `supabase_admin`). `alter default privileges` só afeta o dono citado, e só
-- quem é o dono (ou membro dele) pode alterá-lo.
--
-- ⚠️ O QUE IMPORTA É O DONO QUE CRIA A TABELA. As migrations rodam como
-- `postgres`, então é o default DELE que decide como a próxima tabela nasce —
-- e é esse que precisa ser fechado, obrigatoriamente. O de `supabase_admin`
-- rege objetos que o próprio Supabase cria (schemas internos), e no
-- self-hosted `postgres` não é membro dele: fechamos quando dá, e avisamos
-- quando não dá, em vez de abortar por um reforço que não é o caminho real.
--
-- `service_role` continua com tudo: é o papel do servidor, que ignora RLS por
-- desenho e é como o app inteiro fala com o banco.
-- ----------------------------------------------------------------------------
do $$
declare
  dono text;
  eu text := current_user;
begin
  -- Primeiro o que não é opcional: o papel que está aplicando esta migration é
  -- o mesmo que cria as tabelas das próximas.
  alter default privileges in schema public revoke all on tables from anon, authenticated;
  alter default privileges in schema public revoke all on sequences from anon, authenticated;
  alter default privileges in schema public revoke all on functions from anon, authenticated;
  raise notice 'default privileges fechados para o papel corrente (%)', eu;

  foreach dono in array array['postgres', 'supabase_admin'] loop
    continue when dono = eu;

    if not pg_has_role(eu, dono, 'MEMBER') then
      raise notice
        'sem permissão para fechar os default privileges de % (aplicando como %). Objeto criado POR ESSE papel ainda nasceria aberto para anon; migration deste projeto não é criada por ele.',
        dono, eu;
      continue;
    end if;

    execute format(
      'alter default privileges for role %I in schema public revoke all on tables from anon, authenticated',
      dono
    );
    execute format(
      'alter default privileges for role %I in schema public revoke all on sequences from anon, authenticated',
      dono
    );
    execute format(
      'alter default privileges for role %I in schema public revoke all on functions from anon, authenticated',
      dono
    );
    raise notice 'default privileges fechados também para %', dono;
  end loop;
end
$$;

-- ----------------------------------------------------------------------------
-- 2. Recolher o que já foi concedido.
--
-- `revoke all ... from anon` em todas as tabelas existentes, e depois a
-- devolução explícita do mínimo. Preferimos revogar tudo e reconceder a mão do
-- que caçar tabela por tabela: o que não estiver escrito abaixo fica fechado,
-- que é a direção certa do erro.
-- ----------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- O `usage` no schema continua: sem ele o PostgREST nem consegue responder
-- "permissão negada" direito, e o papel `authenticated` precisa dele para
-- alcançar as duas tabelas de chat.
grant usage on schema public to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. O mínimo que o navegador precisa — e SÓ para quem opera o chat.
--
-- `anon` fica de fora deliberadamente: depois de `supabase-token.ts`, ninguém
-- legítimo usa a chave anônima para ler nada.
--
-- ⚠️ NÃO basta trocar `to anon` por `to authenticated` com `using (true)`.
-- Isso TRANSFERE o furo em vez de fechar: todo usuário logado recebe o mesmo
-- papel de banco (`authenticated`), inclusive `paid_traffic`, que no app só
-- enxerga Rastreamento (`TRACKING_ROLES` em src/config/navigation.ts) e não tem
-- acesso ao WhatsApp (`OPERATION_ROLES`). Com `using (true)` ele chamaria
-- `GET /rest/v1/chat_messages?select=*` e leria todas as conversas sobre
-- crianças, contornando o guard de rota — escalada horizontal de privilégio.
--
-- Por isso a policy lê o claim `app_role`, que `supabase-token.ts` põe no
-- token, e repete no banco a mesma regra que o app aplica na navegação.
--
-- `request.jwt.claims` é o GUC que o PostgREST preenche (o compose usa
-- `PGRST_DB_USE_LEGACY_GUCS: false`). Preferido a `auth.jwt()`, que é helper do
-- schema `auth` e não existe num self-hosted sem GoTrue — e aqui não há GoTrue,
-- a autenticação é o cookie do próprio app.
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['chat_conversations', 'chat_messages'] loop
    if to_regclass('public.' || t) is not null then
      execute format('grant select on public.%I to authenticated', t);

      -- A policy antiga (`chat_anon_realtime_read`) alcançava anon. Sai de
      -- cena com nome e tudo: manter o nome antigo apontando para outro papel
      -- confundiria quem for auditar isto depois.
      execute format('drop policy if exists chat_anon_realtime_read on public.%I', t);
      execute format('drop policy if exists chat_authenticated_realtime_read on public.%I', t);
      execute format('drop policy if exists chat_operacao_read on public.%I', t);
      execute format($sql$
        create policy chat_operacao_read on public.%I
          for select to authenticated
          using (
            coalesce(
              current_setting('request.jwt.claims', true)::jsonb ->> 'app_role',
              ''
            ) in ('admin', 'member')
          )
      $sql$, t);
    end if;
  end loop;
end
$$;

-- ----------------------------------------------------------------------------
-- 4. Funções: fechar o EXECUTE que o Postgres concede a PUBLIC por padrão.
--
-- As duas primeiras são as graves: `security definer` que ESCREVEM e são
-- chamáveis por `/rest/v1/rpc/`. As de trigger não são úteis por RPC (o
-- PostgREST não expõe função que retorna `trigger`), mas ficam fechadas do
-- mesmo jeito — o custo é zero e some a discussão sobre se dá para explorar.
--
-- `service_role` recebe de volta o que o servidor usa: as rotas de
-- /api/financeiro chamam register_sale e update_sale.
-- ----------------------------------------------------------------------------
-- ⚠️ DOIS ERROS QUE ESTE BLOCO JÁ TEVE, e por que ele é assim:
--
-- (a) Revogar só de `anon, authenticated` NÃO fecha nada em função. O Postgres
--     concede EXECUTE a **PUBLIC** por padrão embutido, e `anon` herda de
--     PUBLIC. Medido: depois de revogar de anon/authenticated, uma função nova
--     continuava executável por anon. O revoke precisa citar `public`.
--
-- (b) `alter default privileges IN SCHEMA public revoke ... from public` é
--     aceito sem erro e não funciona: a entrada com escopo de schema parte de
--     ACL vazia e só sabe ADICIONAR privilégio na criação. Só a entrada GLOBAL
--     (sem `in schema`) parte da ACL embutida e consegue subtrair PUBLIC.
--     Medido do mesmo jeito: função nova voltava a ser executável por anon.
--
-- O raio da entrada global é: funções criadas POR ESTE PAPEL, em qualquer
-- schema. Aceitável aqui — as migrations criam função só em `public`, e
-- nenhuma extensão mora em `public` (conferido: pgcrypto, uuid-ossp e
-- pg_stat_statements estão em `extensions`; o vault em `vault`).
alter default privileges revoke execute on functions from public;

-- Todas as rotinas existentes, não só as `security definer`: uma função comum
-- roda com os privilégios de quem chama, mas continua sendo superfície exposta
-- na internet, e três delas estavam abertas para anon.
revoke all on all routines in schema public from public, anon, authenticated;

-- E o servidor recupera o que perdeu. É ele quem chama as RPCs (register_sale,
-- update_sale, promote_lead_to_patient, as do Vault); sem este grant, revogar
-- de PUBLIC derrubaria o app junto com o atacante.
grant execute on all routines in schema public to service_role;

-- ----------------------------------------------------------------------------
-- 5. ASSERÇÕES — a migration falha se não cumpriu o que prometeu.
-- ----------------------------------------------------------------------------
do $$
declare
  aberto text;
  quantas int;
begin
  -- 5.1 Nenhuma tabela de public pode conceder nada a anon.
  select string_agg(distinct table_name, ', ')
    into aberto
    from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public';

  if aberto is not null then
    raise exception 'BLINDAGEM FALHOU: anon ainda tem privilégio nas tabelas: %', aberto;
  end if;

  -- 5.2 `authenticated` só pode alcançar as duas tabelas de chat.
  select string_agg(distinct table_name, ', ')
    into aberto
    from information_schema.role_table_grants
   where grantee = 'authenticated' and table_schema = 'public'
     and table_name not in ('chat_conversations', 'chat_messages');

  if aberto is not null then
    raise exception 'BLINDAGEM FALHOU: authenticated alcança além do chat: %', aberto;
  end if;

  -- 5.3 NENHUMA função executável por anon — não só as `security definer`.
  select count(*) into quantas
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and has_function_privilege('anon', p.oid, 'EXECUTE');

  if quantas > 0 then
    raise exception 'BLINDAGEM FALHOU: % função(ões) ainda executáveis por anon', quantas;
  end if;

  -- 5.4 A prova do futuro: cria uma função DE VERDADE e confere se ela nasce
  -- fechada. É a única asserção que pega o erro (b) descrito no bloco 4 — o
  -- `alter default privileges` que é aceito sem erro e não faz nada. Sem esta
  -- sonda, a migration passaria com o buraco intacto.
  --
  -- Nome com uuid para não colidir com objeto existente.
  declare
    sonda text := '_blindagem_sonda_' || replace(gen_random_uuid()::text, '-', '');
    nasce_aberta boolean;
  begin
    execute format('create function public.%I() returns int language sql as ''select 1''', sonda);
    execute format(
      'select has_function_privilege(''anon'', ''public.%I()'', ''EXECUTE'')', sonda
    ) into nasce_aberta;
    execute format('drop function public.%I()', sonda);

    if nasce_aberta then
      raise exception
        'BLINDAGEM FALHOU: função nova ainda nasce executável por anon — o alter default privileges não pegou (ver bloco 4, erro (b))';
    end if;
  end;

  -- 5.5 O caminho legítimo continua aberto: sem isto, "blindado" pode
  -- significar "chat quebrado", e a asserção não teria valor nenhum.
  if not has_table_privilege('authenticated', 'public.chat_conversations', 'SELECT') then
    raise exception 'BLINDAGEM FALHOU: authenticated perdeu o select em chat_conversations — o chat quebraria';
  end if;
  if not has_table_privilege('authenticated', 'public.chat_messages', 'SELECT') then
    raise exception 'BLINDAGEM FALHOU: authenticated perdeu o select em chat_messages — o realtime quebraria';
  end if;

  raise notice 'blindagem anon: ok';
end
$$;

-- O PostgREST guarda permissões em cache; sem o reload ele continuaria
-- respondendo com o mapa antigo.
notify pgrst, 'reload schema';
