-- ============================================================================
-- PACIENTES — a segunda identidade de uma pessoa na clínica.
--
-- `leads` continua sendo a entidade de FUNIL: quem chegou pelo WhatsApp, de
-- qual anúncio, em que etapa está. `patients` é a entidade de CADASTRO
-- CLÍNICO: quem a pessoa é para o atendimento (documento, filiação, convênio,
-- alergia). São coisas diferentes e envelhecem diferente — por isso tabelas
-- separadas em vez de mais vinte colunas em `leads`.
--
-- ⚠️ A CHAVE FICA NO LEAD (`leads.patient_id`), não o contrário. Uma pessoa
-- pode voltar por outro número e virar um segundo lead; os dois apontam para o
-- MESMO paciente. Com a chave do outro lado, o segundo lead exigiria um
-- cadastro clínico duplicado.
--
-- Um paciente PODE não ter lead nenhum: cadastro feito na recepção.
--
-- Dado sensível: CPF, filiação, endereço e informação de saúde vivem aqui. RLS
-- ligada e nenhum acesso para anon/authenticated — leitura e escrita só
-- server-side com service role (AGENTS §3.1).
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),

  -- --- Identificação -------------------------------------------------------
  full_name text not null,
  -- Nome social: é por ele que a pessoa é chamada na recepção.
  social_name text,
  birth_date date,
  sex text,
  cpf text,
  rg text,
  marital_status text,
  occupation text,
  nationality text,
  birthplace text,

  -- --- Contato -------------------------------------------------------------
  phone text,
  phone_alt text,
  email text,

  -- --- Endereço (estruturado: dá relatório por bairro/cidade) -------------
  zip_code text,
  street text,
  street_number text,
  complement text,
  district text,
  city text,
  state text,

  -- --- Filiação e responsável ---------------------------------------------
  mother_name text,
  father_name text,
  guardian_name text,
  guardian_phone text,
  guardian_cpf text,
  -- "mãe", "pai", "avó", "tutor"… texto livre porque a realidade é livre.
  guardian_relationship text,

  -- --- Convênio ------------------------------------------------------------
  insurance_name text,
  insurance_plan text,
  insurance_number text,
  insurance_valid_until date,

  -- --- Clínico (o mínimo que evita erro no atendimento) --------------------
  blood_type text,
  allergies text,
  chronic_conditions text,
  medications text,
  notes text,

  -- --- Gestão --------------------------------------------------------------
  -- Arquivar, nunca apagar: histórico clínico e agendamento continuam ligados
  -- ao mesmo id. Mesmo critério de `leads.archived_at`.
  archived_at timestamptz,
  -- Como virou paciente: 'agendamento' (automático), 'manual' (botão),
  -- 'cadastro' (nasceu paciente) ou 'importacao'.
  promotion_source text not null default 'cadastro',
  promoted_at timestamptz not null default now(),
  created_by_user_id uuid references public.app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.patients is
  'Cadastro clínico. Contém dado pessoal sensível (CPF, filiação, endereço, saúde): nunca exponha ao cliente sem filtrar colunas.';

-- O vínculo mora no lead: N leads → 1 paciente.
alter table public.leads
  add column if not exists patient_id uuid references public.patients (id) on delete set null;
alter table public.leads
  add column if not exists converted_at timestamptz;

create index if not exists idx_leads_patient_id
  on public.leads (patient_id)
  where patient_id is not null;

-- --- Restrições --------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'patients_sex_check') then
    alter table public.patients add constraint patients_sex_check
      check (sex is null or sex in ('feminino', 'masculino', 'intersexo', 'nao_informado'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'patients_promotion_source_check') then
    alter table public.patients add constraint patients_promotion_source_check
      check (promotion_source in ('agendamento', 'manual', 'cadastro', 'importacao'));
  end if;

  -- CPF guardado só em dígitos: comparar "123.456.789-00" com "12345678900"
  -- criaria duplicata silenciosa da mesma pessoa.
  if not exists (select 1 from pg_constraint where conname = 'patients_cpf_digits_check') then
    alter table public.patients add constraint patients_cpf_digits_check
      check (cpf is null or cpf ~ '^[0-9]{11}$');
  end if;
end
$$;

-- CPF único entre cadastros vivos. Parcial porque CPF costuma faltar no
-- primeiro contato — cadastro sem documento é normal, duplicado não é.
create unique index if not exists patients_cpf_key
  on public.patients (cpf)
  where cpf is not null and archived_at is null;

create index if not exists idx_patients_full_name on public.patients (lower(full_name));
create index if not exists idx_patients_created_at on public.patients (created_at desc);
create index if not exists idx_patients_archived on public.patients (archived_at);

-- Reusa o gatilho de carimbo que já serve a 5 tabelas (AGENTS §5).
drop trigger if exists trg_patients_set_updated_at on public.patients;
create trigger trg_patients_set_updated_at
  before update on public.patients
  for each row execute function public.set_updated_at();

-- --- Promoção ----------------------------------------------------------------
-- Idempotente: chamada de novo devolve o paciente que já existe, em vez de
-- criar um segundo cadastro da mesma pessoa.
create or replace function public.promote_lead_to_patient(
  p_lead_id uuid,
  p_source text default 'manual',
  p_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_patient_id uuid;
  v_lead record;
begin
  if p_lead_id is null then
    return null;
  end if;

  -- Serializa por lead: dois agendamentos gravados ao mesmo tempo criariam
  -- dois cadastros (ou estourariam a unicidade e derrubariam o agendamento).
  perform pg_advisory_xact_lock(hashtextextended(p_lead_id::text, 0));

  select patient_id, id, name, phone, email
    into v_lead
    from public.leads
   where id = p_lead_id;

  if v_lead.id is null then
    return null;
  end if;

  if v_lead.patient_id is not null then
    return v_lead.patient_id;
  end if;

  insert into public.patients (full_name, phone, email, promotion_source, created_by_user_id)
  values (
    coalesce(nullif(btrim(v_lead.name), ''), 'Sem nome'),
    v_lead.phone,
    v_lead.email,
    case when p_source in ('agendamento', 'manual', 'cadastro', 'importacao') then p_source else 'manual' end,
    p_user_id
  )
  returning id into v_patient_id;

  update public.leads
     set patient_id = v_patient_id,
         converted_at = coalesce(converted_at, now())
   where id = p_lead_id;

  return v_patient_id;
end;
$$;

revoke execute on function public.promote_lead_to_patient(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.promote_lead_to_patient(uuid, text, uuid) to service_role;

-- Marcou consulta → é paciente. A regra vive no banco porque agendamento entra
-- por três caminhos (tela, API de integração e webhook do n8n): na aplicação,
-- cada um teria de lembrar de promover.
--
-- ⚠️ Só promove agendamento que ainda pode acontecer: quem já entra cancelado
-- ou como falta nunca foi atendido e não vira cadastro clínico.
create or replace function public.promote_patient_on_appointment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.lead_id is not null and coalesce(new.status::text, 'agendado') not in ('cancelado', 'faltou') then
    perform public.promote_lead_to_patient(new.lead_id, 'agendamento', new.created_by_user_id);
  end if;
  return new;
end;
$$;

revoke execute on function public.promote_patient_on_appointment()
  from public, anon, authenticated;

drop trigger if exists trg_appointments_promote_patient on public.appointments;
create trigger trg_appointments_promote_patient
  after insert on public.appointments
  for each row execute function public.promote_patient_on_appointment();

-- --- Segurança ---------------------------------------------------------------
alter table public.patients enable row level security;
revoke all on public.patients from anon, authenticated;
grant all on public.patients to service_role;
