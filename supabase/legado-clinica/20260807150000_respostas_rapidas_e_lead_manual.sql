-- Respostas rápidas compartilhadas pela equipe e consistência do lead manual.
--
-- A tabela segue o modelo server-only do CRM: RLS habilitada, sem policy para
-- anon/authenticated. A aplicação acessa pelo service_role depois de validar a
-- sessão própria do dashboard.

create table if not exists public.quick_replies (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null,
  shortcut           text not null,
  content            text not null,
  is_active          boolean not null default true,
  created_by_user_id uuid references public.app_users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint quick_replies_title_not_blank check (btrim(title) <> ''),
  constraint quick_replies_title_length check (char_length(title) <= 80),
  constraint quick_replies_shortcut_format check (shortcut ~ '^[a-z0-9_-]{1,40}$'),
  constraint quick_replies_content_not_blank check (btrim(content) <> ''),
  constraint quick_replies_content_length check (char_length(content) <= 4000)
);

create unique index if not exists quick_replies_shortcut_lower_uidx
  on public.quick_replies (lower(shortcut));

create index if not exists quick_replies_active_title_idx
  on public.quick_replies (is_active, lower(title));

create index if not exists quick_replies_created_by_user_id_idx
  on public.quick_replies (created_by_user_id);

alter table public.quick_replies enable row level security;
revoke all on public.quick_replies from anon, authenticated;

drop trigger if exists trg_quick_replies_set_updated_at on public.quick_replies;
create trigger trg_quick_replies_set_updated_at
  before update on public.quick_replies
  for each row execute function public.set_updated_at();

-- O upsert manual pode reencontrar uma linha antiga. O trigger anterior só
-- cobria INSERT; ao promover `imported` para false, esse lead podia continuar
-- sem card. A nova versão garante exatamente um card inicial quando ainda não
-- existe oportunidade alguma para o contato.
create or replace function public.create_initial_deal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.imported, false) = false
     and not exists (
       select 1 from public.deals d where d.lead_id = new.id
     ) then
    insert into public.deals (lead_id, stage, tipo_ensaio, valor, source)
    values (new.id, new.status, new.tipo_ensaio, new.valor_estimado, 'lead')
    on conflict (lead_id) where source = 'lead' do nothing;
  end if;
  return new;
end;
$$;

revoke execute on function public.create_initial_deal() from public, anon, authenticated;

drop trigger if exists trg_leads_create_initial_deal on public.leads;
create trigger trg_leads_create_initial_deal
  after insert or update of imported on public.leads
  for each row execute function public.create_initial_deal();
