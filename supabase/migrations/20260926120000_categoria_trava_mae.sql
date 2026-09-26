-- ============================================================================
-- Fase 4 · Categoria: a leitura da mãe trava, e categoria de fila arquivada não
-- volta.
--
-- Achado da revisão do PR 3 (corrida R6, PROGRESS 2026-09-26): o trigger lia a
-- mãe com SELECT simples. Arquivar a mãe (NO KEY UPDATE) e, ao mesmo tempo,
-- criar uma filha (a FK só pega KEY SHARE, compatível) ou reativar uma filha
-- (a FK nem roda) não se esperavam: cada lado conferia a regra no snapshot de
-- antes do outro, e ficava subcategoria ATIVA sob mãe arquivada — estado que
-- nenhuma ordem em série produz, e que o "Novo ticket" ofereceria.
--
-- Agora a mãe é lida FOR SHARE nos dois caminhos: conflita com o NO KEY UPDATE
-- de quem arquiva, então o 2º espera o 1º e relê a versão commitada (422 em
-- vez de passar). O ramo de arquivar a mãe não muda: o UPDATE só chega ao
-- trigger depois de pegar a linha, e o EXISTS das filhas já vê a filha
-- commitada.
--
-- Também: reativar categoria de fila arquivada passa a ser PRODUCT_ARCHIVED,
-- como criar já era. Arquivar a fila não arquiva as categorias dela (o
-- catálogo as esconde); reativá-las ali só faria sentido com a fila ativa.
--
-- CREATE OR REPLACE preserva o trigger e os privilégios (EXECUTE só do
-- service_role). Depende de 20260925120900_tickets.sql.
-- ============================================================================

do $$
begin
  if to_regprocedure('public.guard_ticket_category()') is null then
    raise exception 'CATEGORIA: aplique 20260925120900_tickets antes';
  end if;
end
$$;

create or replace function public.guard_ticket_category()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent public.ticket_categories%rowtype;
begin
  if tg_op = 'INSERT' then
    if new.product_id is not null and exists (
      select 1 from public.products p where p.id = new.product_id and p.archived_at is not null
    ) then
      raise exception 'PRODUCT_ARCHIVED';
    end if;
    if new.parent_id is not null then
      select * into v_parent from public.ticket_categories c where c.id = new.parent_id for share;
      if found then -- inexistente: a FK responde 23503 logo depois
        if v_parent.parent_id is not null then
          raise exception 'CATEGORY_TOO_DEEP' using detail = 'Categoria tem no máximo dois níveis.';
        end if;
        if v_parent.archived_at is not null then
          raise exception 'CATEGORY_ARCHIVED';
        end if;
        if v_parent.product_id is distinct from new.product_id then
          raise exception 'CATEGORY_PRODUCT_MISMATCH'
            using detail = 'A subcategoria é da mesma fila da categoria.';
        end if;
      end if;
    end if;
    return new;
  end if;

  if old.archived_at is null and new.archived_at is not null and exists (
    select 1 from public.ticket_categories c where c.parent_id = new.id and c.archived_at is null
  ) then
    raise exception 'CATEGORY_HAS_ACTIVE_CHILDREN';
  end if;
  if old.archived_at is not null and new.archived_at is null then
    if new.product_id is not null and exists (
      select 1 from public.products p where p.id = new.product_id and p.archived_at is not null
    ) then
      raise exception 'PRODUCT_ARCHIVED';
    end if;
    if new.parent_id is not null then
      select * into v_parent from public.ticket_categories c where c.id = new.parent_id for share;
      if v_parent.archived_at is not null then
        raise exception 'CATEGORY_ARCHIVED';
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_ticket_category() from public, anon, authenticated;

select public.assert_security_baseline();
