-- ============================================================================
-- BASELINE 6/6 — Storage (mídia do chat, foto de perfil) e Realtime do chat.
--
-- Porta de:
--   · 20260706150000_chat_media_and_realtime.sql — bucket `chat-media` e as
--     duas tabelas de chat na publication `supabase_realtime`;
--   · 20260713150000_app_user_roles_and_profiles.sql:239-250 — bucket
--     `profile-avatars` (5 MB, png/jpeg/webp), sem mudança;
--   · 20260819120000_blindagem_anon.sql:140-165 — grant de SELECT a
--     `authenticated` e a policy por `app_role`, literal.
--
-- O que muda em relação à origem:
--   · `chat-media` nasce PRIVADO (plano, seção B). Na origem era público porque
--     a UI, a uazapi e a transcrição liam a URL direto; qualquer um com o link
--     via a foto do cliente. Agora a mídia sai por URL assinada emitida pelo
--     servidor.
--   · `chat-media` ganha teto de tamanho e lista de tipos.
--
-- Depende de 20260925120000_fundacao.sql (assert_security_baseline) e de
-- 20260925120400_chat.sql (chat_conversations, chat_messages).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Buckets.
--
-- Quem cria o schema `storage` é o storage-api ao subir, não uma migration.
-- Sem ele o bloco avisa e segue, porque nada mais do baseline depende de
-- bucket. ⚠️ O livro-razão não reaplica migration: se o storage subir DEPOIS,
-- este bloco precisa ser rodado à mão. No fluxo local isso não acontece:
-- `scripts/db-local-apply.sh` se recusa a rodar sem `storage.buckets`.
--
-- `on conflict do update` converge para o estado desta migration: bucket que
-- alguém deixou público volta a ser privado.
--
-- Teto de 50 MB = `FILE_SIZE_LIMIT` do storage-api no docker-compose.yml. O
-- limite efetivo é o MENOR dos dois (storage-api, uploader.js), então declarar
-- mais aqui não valeria nada.
--
-- Tipos:
--   · o storage-api compara `tipo/subtipo` LITERAL (uploader.js,
--     validateMimeType): `audio/ogg; codecs=opus` NÃO casa com `audio/ogg`.
--     Quem grava (put-media.ts) precisa tirar os parâmetros antes do upload;
--   · fica de fora o que o navegador EXECUTA ao abrir o arquivo pela URL
--     assinada: text/html, image/svg+xml, application/xhtml+xml, xml e
--     javascript (XML com namespace XHTML roda script). put-media.ts grava
--     esses, e qualquer tipo fora da lista, como `application/octet-stream`,
--     que o navegador baixa em vez de renderizar. O XML de NF-e do cliente
--     continua guardado; o tipo real fica em `chat_messages.media_mime_type`.
--
-- `profile-avatars` segue público, como na origem: `app_users.avatar_url` é
-- URL pública usada em todo `<img>` da equipe, a rota confere a assinatura
-- real dos bytes (avatar/route.ts) e o caminho só leva o id do usuário.
-- É a única exceção que assert_security_baseline() aceita.
-- ----------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise warning
      'schema storage ausente: buckets chat-media e profile-avatars NÃO foram criados. Suba o storage-api e rode à mão o bloco 1 de 20260925120500_storage_realtime.sql (o livro-razão não reaplica a migration).';
    return;
  end if;

  -- Sem estas colunas o bucket aceitaria qualquer tipo e tamanho. Melhor
  -- parar do que criar o bucket aberto.
  if (select count(*)
        from pg_catalog.pg_attribute
       where attrelid = 'storage.buckets'::regclass
         and attname in ('file_size_limit', 'allowed_mime_types')
         and not attisdropped) <> 2 then
    raise exception
      'storage.buckets sem file_size_limit/allowed_mime_types: storage-api antigo demais para os limites deste baseline';
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'chat-media',
    'chat-media',
    false,
    52428800,
    array[
      -- imagem: put-media converte para webp; os outros ficam para quando o
      -- sharp falha ou a figurinha é animada
      'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
      -- vídeo
      'video/mp4', 'video/3gpp', 'video/quicktime', 'video/webm', 'video/mpeg',
      -- áudio: a uazapi entrega mp3; o gravador do navegador, webm ou mp4
      'audio/mpeg', 'audio/ogg', 'audio/opus', 'audio/mp4', 'audio/x-m4a',
      'audio/aac', 'audio/amr', 'audio/webm', 'audio/wav',
      -- documento
      'application/pdf', 'text/plain', 'text/csv', 'application/rtf', 'application/json',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.oasis.opendocument.text',
      'application/vnd.oasis.opendocument.spreadsheet',
      'application/vnd.oasis.opendocument.presentation',
      'application/zip', 'application/x-zip-compressed',
      'application/vnd.rar', 'application/x-rar-compressed', 'application/x-7z-compressed',
      -- o resto: baixado, nunca renderizado
      'application/octet-stream'
    ]
  )
  on conflict (id) do update
    set public             = excluded.public,
        file_size_limit    = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'profile-avatars',
    'profile-avatars',
    true,
    5242880,
    array['image/png', 'image/jpeg', 'image/webp']
  )
  on conflict (id) do update
    set public             = excluded.public,
        file_size_limit    = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;
end
$$;

-- ----------------------------------------------------------------------------
-- 2. Publication `supabase_realtime`.
--
-- Sem ela o Realtime não emite nada, e em silêncio (armadilha herdada, ver
-- PROGRESS). A imagem supabase/postgres 17.6.1.140 já a cria vazia (conferido
-- em container limpo) e docker/db-init.sql garante de novo, junto com o
-- schema `_realtime`, que é do serviço e não desta migration. Aqui só criamos
-- a publication se faltar, para nenhum ambiente depender dos dois.
--
-- ⚠️ Nunca `for all tables`: toda tabela nova entraria sozinha no Realtime.
-- A publication lista tabela por tabela; se alguém a criou assim, paramos.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  if (select puballtables from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    raise exception
      'publication supabase_realtime está FOR ALL TABLES: recrie-a vazia (como em docker/db-init.sql) antes deste baseline';
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 3. O chat ao vivo: leitura para quem opera o chat e as duas tabelas na
--    publication.
--
-- O navegador só alcança o banco com o JWT curto de supabase-token.ts (role
-- `authenticated` + claim `app_role`): REST em chat_conversations
-- (use-conversations.ts, forward-dialog.tsx) e Realtime nas duas
-- (use-chat-realtime.ts). Nada mais.
--
-- Porte literal de 20260819120000_blindagem_anon.sql:140-165:
--   · `using (true)` para authenticated TRANSFERE o furo em vez de fechar:
--     todo usuário logado recebe o mesmo papel de banco. A policy repete no
--     banco a regra de papel do app (admin|member);
--   · `request.jwt.claims`, e não `auth.jwt()`: não há GoTrue. O schema `auth`
--     que a imagem traz só tem uid()/role()/email(), que leem os GUCs legados
--     `request.jwt.claim.*` — o PostgREST não os preenche (compose:
--     PGRST_DB_USE_LEGACY_GUCS=false) e eles voltariam null.
--     `request.jwt.claims` é preenchido pelo PostgREST a cada request e pelo
--     Realtime em realtime.apply_rls antes de avaliar a policy (conferido na
--     imagem 17.6.1.140 com realtime v2.102.3).
--
-- Revoga tudo e devolve só o SELECT, como na blindagem: o que não está
-- escrito aqui fica fechado, mesmo que um default privilege tenha aberto.
-- Não há policy para service_role: ele tem BYPASSRLS.
--
-- Tabela publicada que recebe UPDATE precisa de identidade de réplica (a PK);
-- sem ela, todo UPDATE do chat falharia depois do `add table`. Conferimos
-- antes.
-- ----------------------------------------------------------------------------

-- Sem USAGE no schema, o SELECT abaixo não alcança nada. A imagem já concede;
-- repetimos para o chat não depender disso (blindagem, bloco 2).
grant usage on schema public to authenticated;

do $$
declare
  t text;
  rel regclass;
begin
  foreach t in array array['chat_conversations', 'chat_messages'] loop
    rel := to_regclass('public.' || t);
    if rel is null then
      raise exception 'public.% não existe: aplique 20260925120400_chat.sql antes desta migration', t;
    end if;

    if not exists (select 1 from pg_catalog.pg_index where indrelid = rel and indisprimary) then
      raise exception
        'public.% sem chave primária: publicada no Realtime, todo UPDATE nela falharia por falta de identidade de réplica', t;
    end if;

    -- A RLS já vem ligada de 20260925120400_chat.sql. Repetir é inócuo e
    -- garante que a policy abaixo nunca vire enfeite.
    execute format('alter table public.%I enable row level security', t);

    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);

    execute format('drop policy if exists chat_operacao_read on public.%I', t);
    execute format($sql$
      create policy chat_operacao_read on public.%I
        for select to authenticated
        using (
          coalesce(
            nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'app_role',
            ''
          ) in ('admin', 'member')
        )
    $sql$, t);

    if not exists (
      select 1
        from pg_catalog.pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;

-- ----------------------------------------------------------------------------
-- 4. ASSERÇÕES desta migration. As gerais ficam em assert_security_baseline().
--
-- Mesma lição da blindagem (bloco 5): migration de segurança que "passa" sem
-- ter feito o que prometeu gera confiança falsa, e "fechado" não pode
-- significar "chat quebrado".
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
  sobra text;
begin
  -- 4.1 O caminho legítimo continua aberto.
  if not has_schema_privilege('authenticated', 'public', 'USAGE') then
    raise exception 'STORAGE/REALTIME FALHOU: authenticated sem USAGE no schema public, o chat quebraria';
  end if;

  foreach t in array array['chat_conversations', 'chat_messages'] loop
    if not has_table_privilege('authenticated', 'public.' || t, 'SELECT') then
      raise exception 'STORAGE/REALTIME FALHOU: authenticated sem SELECT em public.%, o chat quebraria', t;
    end if;

    if not exists (
      select 1
        from pg_catalog.pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = t
    ) then
      raise exception 'STORAGE/REALTIME FALHOU: public.% fora da publication, o Realtime não emitiria nada', t;
    end if;
  end loop;

  -- 4.2 Policies permissivas se somam (OR): uma sobra com `using (true)` ao
  -- lado da nossa reabriria o chat para qualquer token. Em public só pode
  -- existir a do chat.
  select string_agg(format('%I.%I', tablename, policyname), ', ')
    into sobra
    from pg_catalog.pg_policies
   where schemaname = 'public'
     and not (tablename in ('chat_conversations', 'chat_messages')
              and policyname = 'chat_operacao_read');

  if sobra is not null then
    raise exception 'STORAGE/REALTIME FALHOU: policy inesperada em public: %', sobra;
  end if;

  -- 4.3 Buckets, quando o storage existe.
  if to_regclass('storage.buckets') is not null then
    if not exists (select 1 from storage.buckets where id = 'chat-media' and public = false) then
      raise exception 'STORAGE/REALTIME FALHOU: chat-media ausente ou público';
    end if;
    if not exists (select 1 from storage.buckets where id = 'profile-avatars' and public = true) then
      raise exception 'STORAGE/REALTIME FALHOU: profile-avatars ausente ou privado';
    end if;
  end if;

  -- 4.4 Bucket privado não vale nada se uma policy em storage.objects deixar
  -- anon/authenticated ler: o storage-api consulta com o papel do JWT de quem
  -- chama. Hoje não há policy lá (só o service_role, com BYPASSRLS, alcança
  -- os objetos), e tem que continuar assim.
  if to_regclass('storage.objects') is not null then
    select string_agg(policyname, ', ')
      into sobra
      from pg_catalog.pg_policies
     where schemaname = 'storage'
       and tablename = 'objects'
       and roles && array['public', 'anon', 'authenticated']::name[];

    if sobra is not null then
      raise exception 'STORAGE/REALTIME FALHOU: policy em storage.objects alcança o navegador: %', sobra;
    end if;
  end if;

  raise notice 'storage e realtime do chat: ok';
end
$$;

-- O PostgREST guarda o schema em cache; sem o reload ele segue com o mapa
-- antigo até reiniciar.
notify pgrst, 'reload schema';

select public.assert_security_baseline();
