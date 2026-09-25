-- ---------------------------------------------------------------------------
-- Preenche os snapshots de campanha da atribuição no momento do insert.
--
-- Defeito em 20260711120000_meta_lead_tracking.sql:
--   os snapshots (ad/adset/campaign/account) de meta_attributions só eram
--   escritos dentro de apply_meta_ad_asset_enrichment, e o worker
--   (enrichPendingAssets) só chama esse RPC para assets em 'pending'/'retry'.
--
--   Consequência: o PRIMEIRO lead de um anúncio criava o asset em 'pending', o
--   worker enriquecia e preenchia o snapshot. A partir do SEGUNDO lead do MESMO
--   anúncio o asset já estava 'enriched', saía do lote do worker, e o RPC nunca
--   mais rodava para aquele source_id — a atribuição nova ficava com
--   campaign_name_snapshot NULL de forma permanente, não temporária.
--
--   Observado em produção em 06/08/2026: duas atribuições de um mesmo
--   anúncio; a das 00:20 enriquecida, a das 00:26 nula.
--
-- Correção:
--   1. trigger BEFORE INSERT em meta_attributions copia o que o asset já sabe.
--      Fica no banco, e não no ingest_meta_webhook_message, para cobrir também
--      qualquer outro caminho de escrita;
--   2. backfill único das linhas que já nasceram sem snapshot.
--
-- O caminho inverso continua valendo: se o asset ainda não foi enriquecido, a
-- trigger não faz nada e apply_meta_ad_asset_enrichment preenche depois.
-- ---------------------------------------------------------------------------

create or replace function public.fill_meta_attribution_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_asset public.meta_ad_assets%rowtype;
begin
  -- Sem anúncio de origem, ou já preenchido pelo chamador: nada a fazer.
  if new.source_id is null or new.campaign_id_snapshot is not null then
    return new;
  end if;

  select * into v_asset
  from public.meta_ad_assets
  where source_id = new.source_id
    and enrichment_status in ('enriched', 'partial');

  if not found then
    return new;
  end if;

  new.ad_id_snapshot := coalesce(new.ad_id_snapshot, v_asset.ad_id);
  new.ad_name_snapshot := coalesce(new.ad_name_snapshot, v_asset.ad_name);
  new.adset_id_snapshot := coalesce(new.adset_id_snapshot, v_asset.adset_id);
  new.adset_name_snapshot := coalesce(new.adset_name_snapshot, v_asset.adset_name);
  new.campaign_id_snapshot := coalesce(new.campaign_id_snapshot, v_asset.campaign_id);
  new.campaign_name_snapshot := coalesce(new.campaign_name_snapshot, v_asset.campaign_name);
  new.account_id_snapshot := coalesce(new.account_id_snapshot, v_asset.account_id);

  -- 'partial' também conta como enriquecido: é o mesmo critério que
  -- apply_meta_ad_asset_enrichment usa para carimbar enriched_at.
  new.enriched_at := coalesce(new.enriched_at, now());

  return new;
end;
$$;

drop trigger if exists trg_meta_attributions_fill_snapshot on public.meta_attributions;
create trigger trg_meta_attributions_fill_snapshot
  before insert on public.meta_attributions
  for each row execute function public.fill_meta_attribution_snapshot();

-- Backfill das atribuições que já existem sem snapshot e cujo anúncio já foi
-- resolvido. Idempotente: só toca linha com campaign_id_snapshot nulo.
update public.meta_attributions t
set ad_id_snapshot = coalesce(t.ad_id_snapshot, a.ad_id),
    ad_name_snapshot = coalesce(t.ad_name_snapshot, a.ad_name),
    adset_id_snapshot = coalesce(t.adset_id_snapshot, a.adset_id),
    adset_name_snapshot = coalesce(t.adset_name_snapshot, a.adset_name),
    campaign_id_snapshot = coalesce(t.campaign_id_snapshot, a.campaign_id),
    campaign_name_snapshot = coalesce(t.campaign_name_snapshot, a.campaign_name),
    account_id_snapshot = coalesce(t.account_id_snapshot, a.account_id),
    enriched_at = coalesce(t.enriched_at, now())
from public.meta_ad_assets a
where a.source_id = t.source_id
  and a.enrichment_status in ('enriched', 'partial')
  and t.campaign_id_snapshot is null
  and t.redacted_at is null;
