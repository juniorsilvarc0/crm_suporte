-- ============================================================================
-- FUNDAÇÃO DO BASELINE — roda antes de qualquer objeto do domínio.
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- O baseline novo substitui as 45 migrations da clínica (agora em
-- supabase/legado-clinica/) e nasce num banco vazio. A lição mais cara da
-- origem foi que objeto novo NASCIA ABERTO para `anon`
-- (20260819120000_blindagem_anon.sql): o default privileges da imagem concede
-- tudo em toda tabela nova, e o Postgres concede EXECUTE a PUBLIC em toda
-- função nova. Lá a correção veio depois do furo; aqui ela vem antes do
-- primeiro `create table`.
--
-- O QUE ELA FAZ
--
--   1. recusa banco com schema da clínica (o baseline só vale em banco vazio);
--   2. extensões, cada uma no schema em que o SQL portado as chama;
--   3. fecha os default privileges (porte dos blocos 1 e 4 da blindagem);
--   4. sonda: cria objetos de verdade e aborta se nascerem abertos (porte da
--      asserção 5.4 da blindagem);
--   5. public.set_updated_at();
--   6. public.assert_security_baseline(), que TODA migration chama no fim.
--
-- Roda como `postgres` (scripts/db-local-apply.sh), que NÃO é superusuário
-- na imagem supabase/postgres. Reaplicar não muda nada.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Só em banco vazio.
--
-- `create table if not exists` sobre um volume antigo da clínica não falha:
-- mantém a forma antiga (ex.: chat_conversations.lead_id NOT NULL restrict) e
-- o baseline "passa" com o schema errado. Melhor parar aqui, com a causa.
-- ----------------------------------------------------------------------------
do $$
declare
  v_legado text;
begin
  select pg_catalog.string_agg(t, ', ' order by t)
    into v_legado
    from pg_catalog.unnest(
           array['leads', 'deals', 'board_columns', 'patients', 'meta_attributions']
         ) as t
   where pg_catalog.to_regclass('public.' || t) is not null;

  if v_legado is not null then
    raise exception
      'o baseline exige banco vazio, e public ainda tem tabelas da clínica (%). Recrie o volume do banco local antes de aplicar.',
      v_legado;
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 2. Extensões.
--
-- Schemas iguais aos da origem, porque o SQL portado os cita por nome:
--   pgcrypto       → extensions  (extensions.crypt/gen_salt: 20260703000000_app_users.sql:6)
--   supabase_vault → vault       (vault.create_secret: 20260811140000_variaveis_ambiente_seguras.sql:8)
--   pg_trgm        → extensions  (novo; a origem não tinha. Índice cita extensions.gin_trgm_ops)
--
-- Nenhuma extensão em `public`: função de extensão nasce executável por
-- PUBLIC, e em `public` o PostgREST a exporia como /rest/v1/rpc/<nome>.
--
-- Vêm ANTES do bloco 3 de propósito. Na imagem supabase quem instala é o
-- supautils, como supabase_admin. Mas se o papel da migration instalasse, a
-- entrada GLOBAL do bloco 3 tiraria o EXECUTE de PUBLIC das funções da
-- extensão, e a política de `public` vazaria para `extensions`.
-- ----------------------------------------------------------------------------
create extension if not exists pgcrypto with schema extensions;
create extension if not exists supabase_vault with schema vault;
create extension if not exists pg_trgm with schema extensions;

-- `if not exists` não move extensão que já exista em OUTRO schema. Nesse caso
-- o `extensions.crypt` das RPCs de senha só quebraria no primeiro login.
do $$
declare
  v_errado text;
begin
  select pg_catalog.string_agg(
           pg_catalog.format('%s em %s (esperado: %s)', x.nome, coalesce(n.nspname::text, 'lugar nenhum'), x.esperado),
           '; '
         )
    into v_errado
    from (values ('pgcrypto', 'extensions'),
                 ('supabase_vault', 'vault'),
                 ('pg_trgm', 'extensions')) as x(nome, esperado)
    left join pg_catalog.pg_extension e on e.extname = x.nome
    left join pg_catalog.pg_namespace n on n.oid = e.extnamespace
   where n.nspname is distinct from x.esperado;

  if v_errado is not null then
    raise exception 'extensão fora do schema que o baseline cita: %', v_errado;
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 3. Default privileges: objeto novo em `public` nasce fechado.
--
-- Porte dos blocos 1 e 4 de 20260819120000_blindagem_anon.sql, com uma
-- diferença deliberada (3a): service_role também sai do default.
-- ----------------------------------------------------------------------------
do $$
declare
  v_dono text;
  v_eu   text := current_user;
begin
  -- 3a. O papel corrente é quem cria os objetos do baseline, então fechar o
  --     default DELE é obrigatório (blindagem, bloco 1).
  --
  --     DIFERENÇA DA ORIGEM: lá service_role ficava com tudo. Aqui ele sai
  --     também. Com o default da imagem (arwdDxtm para service_role), um
  --     `grant select, insert` em tabela append-only não restringiria nada,
  --     porque o ALL já estaria lá, e um grant por coluna seria ignorado. Assim
  --     tabela, sequência e função novas nascem sem grant para NINGUÉM além do
  --     dono, e cada migration concede só os verbos que o app usa. Esquecer um
  --     grant falha alto ("permission denied"); sobrar um falharia em silêncio.
  alter default privileges in schema public
    revoke all on tables from anon, authenticated, service_role;
  alter default privileges in schema public
    revoke all on sequences from anon, authenticated, service_role;
  alter default privileges in schema public
    revoke all on functions from anon, authenticated, service_role;

  -- 3b. EXECUTE de PUBLIC em função nova. Dois erros que a origem já cometeu
  --     (blindagem, bloco 4):
  --       (a) revogar só de anon/authenticated não fecha nada: o EXECUTE nasce
  --           para PUBLIC e anon herda de PUBLIC;
  --       (b) `alter default privileges IN SCHEMA ... from public` é aceito e
  --           não faz nada: a entrada com escopo de schema parte de ACL vazia
  --           e só sabe SOMAR. Só a entrada GLOBAL, sem `in schema`, parte da
  --           ACL embutida e consegue subtrair PUBLIC.
  --     Raio da entrada global: funções criadas por ESTE papel, em qualquer
  --     schema. Aceitável: as migrations só criam função em `public`, e
  --     extensão não é instalada por este papel (bloco 2).
  alter default privileges revoke execute on functions from public;

  -- 3c. supabase_admin rege o que o próprio Supabase cria, e o default dele
  --     em public também concede tudo a anon. No self-hosted `postgres` não é
  --     membro dele, então fechamos quando dá e avisamos quando não dá, em
  --     vez de abortar por um reforço que não é o caminho real (blindagem,
  --     bloco 1). O objeto que ele criar em public ainda cai nas asserções de
  --     grant de assert_security_baseline().
  foreach v_dono in array array['postgres', 'supabase_admin'] loop
    continue when v_dono = v_eu;
    continue when pg_catalog.to_regrole(v_dono) is null;

    if not pg_catalog.pg_has_role(v_eu, v_dono, 'MEMBER') then
      raise notice
        'default privileges de % em public continuam abertos para anon: % não é membro dele. Feche no init do banco, que roda como superusuário.',
        v_dono, v_eu;
      continue;
    end if;

    execute pg_catalog.format(
      'alter default privileges for role %I in schema public revoke all on tables from anon, authenticated',
      v_dono
    );
    execute pg_catalog.format(
      'alter default privileges for role %I in schema public revoke all on sequences from anon, authenticated',
      v_dono
    );
    execute pg_catalog.format(
      'alter default privileges for role %I in schema public revoke all on functions from anon, authenticated',
      v_dono
    );
  end loop;
end
$$;

-- O `usage` no schema fica (blindagem, bloco 2): sem ele o PostgREST nem
-- responde "permissão negada" direito, e authenticated precisa dele para
-- alcançar as tabelas de chat. Usage no schema não dá acesso a objeto nenhum.
grant usage on schema public to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. Sonda: a prova de que o bloco 3 pegou.
--
-- Porte da asserção 5.4 da blindagem, ampliada para tabela e sequência. É a
-- única asserção que pega o erro (b) do bloco 3: o comando que é aceito sem
-- erro e não faz nada. Cria objetos DE VERDADE, confere a ACL com que
-- nasceram e os apaga. Se abortar, o bloco inteiro volta atrás e a sonda não
-- fica no banco. Nome com uuid para não colidir com nada.
-- ----------------------------------------------------------------------------
do $$
declare
  v_sufixo  text := pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
  v_funcao  text := '_sonda_fundacao_fn_' || v_sufixo;
  v_tabela  text := '_sonda_fundacao_tb_' || v_sufixo;
  v_seq     text;
  v_papel   name;
  v_abertos text[] := '{}';
begin
  execute pg_catalog.format(
    'create function public.%I() returns integer language sql as %L',
    v_funcao, 'select 1'
  );
  -- A identity cria a sequência junto, e a sonda confere as duas.
  execute pg_catalog.format(
    'create table public.%I (id bigint generated always as identity primary key)',
    v_tabela
  );
  v_seq := pg_catalog.pg_get_serial_sequence(pg_catalog.format('public.%I', v_tabela), 'id');

  foreach v_papel in array array['anon', 'authenticated', 'service_role']::name[] loop
    if pg_catalog.has_function_privilege(v_papel, pg_catalog.format('public.%I()', v_funcao), 'EXECUTE') then
      v_abertos := v_abertos || pg_catalog.format('função → %s', v_papel);
    end if;
    if pg_catalog.has_table_privilege(
         v_papel, pg_catalog.format('public.%I', v_tabela),
         'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
       ) then
      v_abertos := v_abertos || pg_catalog.format('tabela → %s', v_papel);
    end if;
    if pg_catalog.has_sequence_privilege(v_papel, v_seq, 'USAGE, SELECT, UPDATE') then
      v_abertos := v_abertos || pg_catalog.format('sequência → %s', v_papel);
    end if;
  end loop;

  execute pg_catalog.format('drop table public.%I', v_tabela);
  execute pg_catalog.format('drop function public.%I()', v_funcao);

  if pg_catalog.cardinality(v_abertos) > 0 then
    raise exception
      'FUNDAÇÃO FALHOU: objeto novo em public nasce aberto (%). O alter default privileges não pegou; ver bloco 3.',
      pg_catalog.array_to_string(v_abertos, ', ');
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 5. updated_at carimbado pelo banco.
--
-- Porte de 20260807120000_procedimentos_e_venda_atomica.sql:65. Unifica o
-- `touch_user_notes_updated_at` de 20260818000000_notas_do_usuario.sql:66, que
-- era a mesma função com outro nome. `updated_at` é o carimbo que a UI mostra,
-- e rotas como a de respostas rápidas fazem UPDATE sem enviá-lo: não pode
-- depender de a aplicação lembrar.
--
-- Carimba em todo UPDATE, mesmo sem mudança real (igual à origem). Por isso não
-- vai em chat_conversations: lá o `updated_at` é do trigger de mensagem, e zerar
-- as não lidas não deve mexer nele.
--
-- Sem `security definer`: roda com os privilégios de quem faz o UPDATE e só
-- toca o NEW. O `search_path` fixo tira a função do alcance de um schema
-- plantado no caminho.
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Trigger BEFORE UPDATE: carimba updated_at com now(). Uso: create trigger trg_<tabela>_set_updated_at before update on public.<tabela> for each row execute function public.set_updated_at().';

-- Trigger não confere EXECUTE ao disparar (só em CREATE TRIGGER, que roda como
-- dono), então o revoke não atrapalha o UPDATE de ninguém.
revoke all on function public.set_updated_at() from public, anon, authenticated;
grant execute on function public.set_updated_at() to service_role;

-- ----------------------------------------------------------------------------
-- 6. assert_security_baseline(): a segurança do banco como função.
--
-- Porte das asserções 5.1 a 5.4 da blindagem, no formato que TODA migration do
-- baseline chama no fim (`select public.assert_security_baseline();`). Na
-- origem as asserções rodaram uma vez, na migration que fechou o furo; aqui
-- rodam depois de cada migration, e o objeto que nascer aberto derruba a
-- migration que o criou, não uma auditoria meses depois.
--
-- Funciona em qualquer ponto da sequência. Tudo que depende de objeto que
-- ainda pode não existir (tabelas de chat, publication, schema storage) é
-- condicional. Junta TODAS as falhas antes de abortar, para uma correção só.
--
-- `security definer` por dois motivos: `current_user` aqui dentro é o dono
-- (o papel das migrations), que é quem define como objeto novo nasce (item 8
-- abaixo); e storage.buckets é lido com os privilégios do dono, seja quem
-- chamar.
-- Só lê catálogo, e só o service_role pode chamar.
--
-- ⚠️ Quem precisar de exceção (outra tabela para authenticated, outro bucket
-- público) muda as listas abaixo numa migration nova, com a decisão escrita.
-- Não afrouxe a verificação para fazer uma migration passar.
-- ----------------------------------------------------------------------------
create or replace function public.assert_security_baseline()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Únicas tabelas que o navegador alcança: o Realtime do chat, com o JWT curto
  -- de src/lib/auth/supabase-token.ts (role authenticated + claim app_role).
  c_chat     constant text[] := array['chat_conversations', 'chat_messages'];
  -- Único bucket público: avatar de operador, sem dado de cliente.
  c_publicos constant text[] := array['profile-avatars'];

  v_anon    oid := pg_catalog.to_regrole('anon');
  v_auth    oid := pg_catalog.to_regrole('authenticated');
  v_service oid := pg_catalog.to_regrole('service_role');
  v_public  oid := pg_catalog.to_regnamespace('public');
  v_storage oid := pg_catalog.to_regnamespace('storage');

  -- Privilégios de tabela que não existem por coluna. MAINTAIN só no PG 17+.
  v_sem_coluna text := 'DELETE, TRUNCATE, TRIGGER';
  v_criadores  oid[];
  v_falhas     text[] := '{}';
  v_lista      text;
  v_tabelas    integer;
  v_funcoes    integer;
begin
  if v_anon is null or v_auth is null or v_service is null then
    raise exception
      'assert_security_baseline: faltam os papéis anon/authenticated/service_role. Este baseline pressupõe a imagem supabase/postgres.';
  end if;

  if pg_catalog.current_setting('server_version_num')::integer >= 170000 then
    v_sem_coluna := v_sem_coluna || ', MAINTAIN';
  end if;

  -- 1. Toda tabela de public com RLS (blindagem, premissa das policies). Sem
  --    RLS, um grant errado vira leitura total; com RLS e sem policy, o mesmo
  --    grant não devolve linha nenhuma.
  select pg_catalog.string_agg(c.relname::text, ', ' order by c.relname)
    into v_lista
    from pg_catalog.pg_class c
   where c.relnamespace = v_public
     and c.relkind in ('r', 'p')
     and not c.relrowsecurity;
  if v_lista is not null then
    v_falhas := v_falhas || ('tabela de public sem RLS: ' || v_lista);
  end if;

  -- 2. anon não alcança nada em public (blindagem 5.1): tabela, view, coluna ou
  --    sequência. PUBLIC entra junto, porque anon herda de PUBLIC. Usamos
  --    has_*_privilege, e não information_schema/relacl, porque ele resolve
  --    herança de papel e grant por coluna.
  select pg_catalog.string_agg(c.relname::text, ', ' order by c.relname)
    into v_lista
    from pg_catalog.pg_class c
   where c.relnamespace = v_public
     and case
           when c.relkind = 'S' then
             pg_catalog.has_sequence_privilege(v_anon, c.oid, 'USAGE, SELECT, UPDATE')
           when c.relkind in ('r', 'p', 'v', 'm', 'f') then
             pg_catalog.has_any_column_privilege(v_anon, c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
             or pg_catalog.has_table_privilege(v_anon, c.oid, v_sem_coluna)
           else false
         end;
  if v_lista is not null then
    v_falhas := v_falhas || ('anon/PUBLIC tem privilégio em: ' || v_lista);
  end if;

  -- 3. authenticated só lê as tabelas de chat (blindagem 5.2). Todo usuário
  --    logado recebe esse mesmo papel de banco, e o PostgREST está na internet:
  --    cada grant a ele é uma rota pública fora do route-guard (AGENTS §3.1).
  select pg_catalog.string_agg(c.relname::text, ', ' order by c.relname)
    into v_lista
    from pg_catalog.pg_class c
   where c.relnamespace = v_public
     and case
           when c.relkind = 'S' then
             pg_catalog.has_sequence_privilege(v_auth, c.oid, 'USAGE, SELECT, UPDATE')
           when c.relkind in ('r', 'p') and c.relname::text = any (c_chat) then
             pg_catalog.has_any_column_privilege(v_auth, c.oid, 'INSERT, UPDATE, REFERENCES')
             or pg_catalog.has_table_privilege(v_auth, c.oid, v_sem_coluna)
           when c.relkind in ('r', 'p', 'v', 'm', 'f') then
             pg_catalog.has_any_column_privilege(v_auth, c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
             or pg_catalog.has_table_privilege(v_auth, c.oid, v_sem_coluna)
           else false
         end;
  if v_lista is not null then
    v_falhas := v_falhas || (
      'authenticated fora da regra (só SELECT em ' || pg_catalog.array_to_string(c_chat, '/') || '): ' || v_lista
    );
  end if;

  -- 4. Nenhuma função de public executável por PUBLIC/anon/authenticated
  --    (blindagem 5.3), não só as `security definer`. has_function_privilege
  --    enxerga o EXECUTE que o Postgres dá a PUBLIC quando a ACL é nula.
  select pg_catalog.string_agg(p.oid::pg_catalog.regprocedure::text, ', ' order by p.proname)
    into v_lista
    from pg_catalog.pg_proc p
   where p.pronamespace = v_public
     and (
       pg_catalog.has_function_privilege(v_anon, p.oid, 'EXECUTE')
       or pg_catalog.has_function_privilege(v_auth, p.oid, 'EXECUTE')
     );
  if v_lista is not null then
    v_falhas := v_falhas || ('função executável por PUBLIC/anon/authenticated: ' || v_lista);
  end if;

  -- 5. `security definer` sem `set search_path = ''` roda com o privilégio do
  --    dono resolvendo nomes num caminho que quem chama controla. Regra de
  --    todas as RPCs portadas (ex.: 20260809111000:314).
  select pg_catalog.string_agg(p.oid::pg_catalog.regprocedure::text, ', ' order by p.proname)
    into v_lista
    from pg_catalog.pg_proc p
   where p.pronamespace = v_public
     and p.prosecdef
     and not ('search_path=""' = any (coalesce(p.proconfig, '{}'::text[])));
  if v_lista is not null then
    v_falhas := v_falhas || ('security definer sem set search_path = '''': ' || v_lista);
  end if;

  -- 6. Ninguém de fora cria objeto em public: função plantada lá viraria RPC.
  if pg_catalog.has_schema_privilege(v_anon, v_public, 'CREATE')
     or pg_catalog.has_schema_privilege(v_auth, v_public, 'CREATE') then
    v_falhas := v_falhas || 'anon/authenticated/PUBLIC podem criar objetos no schema public'::text;
  end if;

  -- 7. Policies. Tabela de public tem RLS e NENHUMA policy, exceto as de chat.
  --    Nelas, só SELECT, só para authenticated, e a permissiva precisa ler o
  --    claim app_role. Trocar `to anon` por `to authenticated using (true)`
  --    transfere o furo em vez de fechar (blindagem, bloco 3).
  select pg_catalog.string_agg(
           pg_catalog.format('%s em %s', pol.polname, c.relname), ', ' order by c.relname, pol.polname
         )
    into v_lista
    from pg_catalog.pg_policy pol
    join pg_catalog.pg_class c on c.oid = pol.polrelid
   where c.relnamespace = v_public
     and (
       not (c.relname::text = any (c_chat))
       or pol.polcmd <> 'r'
       or not (pol.polroles <@ array[v_auth, v_service])
       or (
         pol.polpermissive
         and coalesce(pg_catalog.pg_get_expr(pol.polqual, pol.polrelid), '') not like '%app_role%'
       )
     );
  if v_lista is not null then
    v_falhas := v_falhas || (
      'policy fora da regra (só nas tabelas de chat, só SELECT, só authenticated, lendo app_role): ' || v_lista
    );
  end if;

  -- 8. Default privileges: como o PRÓXIMO objeto vai nascer. Blindagem 5.4,
  --    feita pelo catálogo em vez de criar objeto (a sonda do bloco 4 da
  --    fundação faz a prova com objeto real, uma vez).
  --
  --    Quem cria objeto em public: o dono desta função (o papel das
  --    migrations) e o dono de qualquer objeto que já esteja lá. O default de
  --    outro papel só vira objeto se esse papel criar algo, e aí o objeto cai
  --    nos itens 2 a 4.
  --
  --    A ACL de um objeto novo é a entrada GLOBAL do dono (ou, sem ela, a ACL
  --    embutida, que dá EXECUTE a PUBLIC em função) somada à entrada do schema.
  --    É a regra de get_user_default_acl() no Postgres. Atenção: acldefault
  --    usa 's' para sequência, e pg_default_acl usa 'S'.
  select pg_catalog.array_agg(distinct s.r)
    into v_criadores
    from (
      select pg_catalog.to_regrole(current_user::text)::oid
      union all
      select c.relowner from pg_catalog.pg_class c where c.relnamespace = v_public
      union all
      select p.proowner from pg_catalog.pg_proc p where p.pronamespace = v_public
    ) as s(r)
   where s.r is not null;

  select pg_catalog.string_agg(
           pg_catalog.format('%s (%s)', pg_catalog.pg_get_userbyid(cr.r), t.rotulo), ', '
         )
    into v_lista
    from pg_catalog.unnest(v_criadores) as cr(r)
   cross join (
     values ('r'::"char", 'r'::"char", 'tabelas'),
            ('S'::"char", 's'::"char", 'sequências'),
            ('f'::"char", 'f'::"char", 'funções')
   ) as t(tipo_default, tipo_acl, rotulo)
   where exists (
     select 1
       from pg_catalog.aclexplode(
              coalesce(
                (select d.defaclacl
                   from pg_catalog.pg_default_acl d
                  where d.defaclrole = cr.r
                    and d.defaclnamespace = 0
                    and d.defaclobjtype = t.tipo_default),
                pg_catalog.acldefault(t.tipo_acl, cr.r)
              )
              || coalesce(
                (select d.defaclacl
                   from pg_catalog.pg_default_acl d
                  where d.defaclrole = cr.r
                    and d.defaclnamespace = v_public
                    and d.defaclobjtype = t.tipo_default),
                '{}'::aclitem[]
              )
            ) as a
      where a.grantee in (0, v_anon, v_auth, v_service)
   );
  if v_lista is not null then
    v_falhas := v_falhas || (
      'default privileges dão a PUBLIC/anon/authenticated/service_role o próximo objeto de public criado por: ' || v_lista
    );
  end if;

  -- 9. Realtime. A publication decide o que sai pelo websocket. Tabela fora da
  --    lista vazaria mudanças para qualquer assinante, e FOR ALL TABLES
  --    publicaria até app_users.
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    if exists (
      select 1 from pg_catalog.pg_publication
       where pubname = 'supabase_realtime' and puballtables
    ) then
      v_falhas := v_falhas || 'publication supabase_realtime está FOR ALL TABLES'::text;
    else
      select pg_catalog.string_agg(
               pg_catalog.format('%I.%I', pt.schemaname, pt.tablename), ', '
               order by pt.schemaname, pt.tablename
             )
        into v_lista
        from pg_catalog.pg_publication_tables pt
       where pt.pubname = 'supabase_realtime'
         and not (pt.schemaname = 'public' and pt.tablename::text = any (c_chat));
      if v_lista is not null then
        v_falhas := v_falhas || ('publication supabase_realtime com tabela fora do chat: ' || v_lista);
      end if;
    end if;

    -- Caminho legítimo (blindagem 5.5). Aqui é só aviso, porque grant, policy
    -- e publication podem vir em migrations diferentes da sequência. Quem
    -- monta o Realtime faz a asserção positiva no próprio arquivo.
    select pg_catalog.string_agg(c.relname::text, ', ' order by c.relname)
      into v_lista
      from pg_catalog.pg_publication_tables pt
      join pg_catalog.pg_class c
        on c.relname = pt.tablename and c.relnamespace = v_public
     where pt.pubname = 'supabase_realtime'
       and pt.schemaname = 'public'
       and (
         not pg_catalog.has_table_privilege(v_auth, c.oid, 'SELECT')
         or not exists (
           select 1 from pg_catalog.pg_policy pol
            where pol.polrelid = c.oid and pol.polpermissive and pol.polcmd = 'r'
              and v_auth = any (pol.polroles)
         )
       );
    if v_lista is not null then
      raise notice
        'aviso: % está na publication mas authenticated não tem SELECT ou policy. O Realtime não entrega nada, em silêncio.',
        v_lista;
    end if;
  end if;

  -- 10. Storage, se o storage-api já criou o schema. O navegador alcança o
  --     storage-api pelo gateway COM o JWT authenticated do Realtime. Então a
  --     privacidade de um bucket privado depende de três coisas: o bucket não
  --     ser público, storage.objects não ter policy para esses papéis e as
  --     tabelas de storage terem RLS. O app lê e grava por service_role e URL
  --     assinada; nenhuma policy é necessária.
  if v_storage is not null then
    if pg_catalog.to_regclass('storage.buckets') is not null then
      select pg_catalog.string_agg(b.id, ', ' order by b.id)
        into v_lista
        from storage.buckets b
       where b.public
         and not (b.id = any (c_publicos));
      if v_lista is not null then
        v_falhas := v_falhas || (
          'bucket público fora de ' || pg_catalog.array_to_string(c_publicos, '/') || ': ' || v_lista
        );
      end if;
    end if;

    select pg_catalog.string_agg(
             pg_catalog.format('%s em storage.%s', pol.polname, c.relname), ', '
             order by c.relname, pol.polname
           )
      into v_lista
      from pg_catalog.pg_policy pol
      join pg_catalog.pg_class c on c.oid = pol.polrelid
     where c.relnamespace = v_storage
       and pol.polroles && array[0::oid, v_anon, v_auth];
    if v_lista is not null then
      v_falhas := v_falhas || ('policy de storage alcançável por PUBLIC/anon/authenticated: ' || v_lista);
    end if;

    select pg_catalog.string_agg(c.relname::text, ', ' order by c.relname)
      into v_lista
      from pg_catalog.pg_class c
     where c.relnamespace = v_storage
       and c.relkind in ('r', 'p')
       and not c.relrowsecurity
       and (
         pg_catalog.has_any_column_privilege(v_anon, c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
         or pg_catalog.has_any_column_privilege(v_auth, c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
         or pg_catalog.has_table_privilege(v_anon, c.oid, v_sem_coluna)
         or pg_catalog.has_table_privilege(v_auth, c.oid, v_sem_coluna)
       );
    if v_lista is not null then
      v_falhas := v_falhas || ('tabela de storage alcançável pelo navegador sem RLS: ' || v_lista);
    end if;
  end if;

  -- 11. service_role (BYPASSRLS): o menor privilégio dele é só grant. Nenhuma
  --     rota usa TRUNCATE/TRIGGER/REFERENCES/MAINTAIN; se aparecerem, alguém
  --     rodou `grant all` — e o hash de senha e o append-only caíram junto.
  --     (Foi o que o seed herdado fazia: revisão da Fase 2, B1/I1.)
  select pg_catalog.string_agg(c.relname::text, ', ' order by c.relname)
    into v_lista
    from pg_catalog.pg_class c
   where c.relnamespace = v_public
     and c.relkind in ('r', 'p')
     and (pg_catalog.has_table_privilege(v_service, c.oid,
            pg_catalog.replace(v_sem_coluna, 'DELETE, ', ''))
          or pg_catalog.has_any_column_privilege(v_service, c.oid, 'REFERENCES'));
  if v_lista is not null then
    v_falhas := v_falhas || ('service_role com privilégio de dono (grant all?) em: ' || v_lista);
  end if;

  if pg_catalog.to_regclass('public.app_users') is not null
     and pg_catalog.has_column_privilege(v_service, pg_catalog.to_regclass('public.app_users'), 'password_hash', 'SELECT') then
    v_falhas := v_falhas || 'service_role lê app_users.password_hash'::text;
  end if;

  select pg_catalog.string_agg(t, ', ' order by t)
    into v_lista
    from pg_catalog.unnest(array['contact_events', 'integration_logs']) as t
   where pg_catalog.to_regclass('public.' || t) is not null
     and (pg_catalog.has_any_column_privilege(v_service, pg_catalog.to_regclass('public.' || t), 'UPDATE')
          or pg_catalog.has_table_privilege(v_service, pg_catalog.to_regclass('public.' || t), 'DELETE'));
  if v_lista is not null then
    v_falhas := v_falhas || ('service_role altera tabela append-only: ' || v_lista);
  end if;

  if pg_catalog.cardinality(v_falhas) > 0 then
    raise exception using
      message = pg_catalog.format(
        'BASELINE DE SEGURANÇA FALHOU (%s problema(s)):%s',
        pg_catalog.cardinality(v_falhas),
        E'\n  - ' || pg_catalog.array_to_string(v_falhas, E'\n  - ')
      ),
      hint = 'Corrija na migration que criou o objeto. Não afrouxe assert_security_baseline() para ela passar.';
  end if;

  select pg_catalog.count(*) into v_tabelas
    from pg_catalog.pg_class c
   where c.relnamespace = v_public and c.relkind in ('r', 'p');
  select pg_catalog.count(*) into v_funcoes
    from pg_catalog.pg_proc p
   where p.pronamespace = v_public;

  raise notice 'baseline ok: % tabela(s) e % função(ões) em public conferidas', v_tabelas, v_funcoes;
end;
$$;

comment on function public.assert_security_baseline() is
  'Aborta se public/storage/publication fugirem da blindagem (RLS, grants, EXECUTE, policies, default privileges, buckets). Toda migration termina com select public.assert_security_baseline();';

revoke all on function public.assert_security_baseline() from public, anon, authenticated;
grant execute on function public.assert_security_baseline() to service_role;

-- O PostgREST guarda o schema em cache; sem o reload ele segue com o mapa antigo.
notify pgrst, 'reload schema';

select public.assert_security_baseline();
