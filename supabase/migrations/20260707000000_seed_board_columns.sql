-- Semeia as etapas do funil (board_columns) com as 8 etapas canônicas, caso a
-- tabela esteja vazia. Sem isso, o app cai no fallback em memória (ids
-- "fallback-<status>"), que NÃO são linhas reais — então reordenar/editar/excluir
-- falha com 400 (id não é UUID). Idempotente: `on conflict (key) do nothing`.
insert into public.board_columns (key, label, color, position) values
  ('novo',           'Novo',           'violet',  0),
  ('em_atendimento', 'Em atendimento', 'blue',    1),
  ('qualificado',    'Qualificado',    'cyan',    2),
  ('agendado',       'Agendado',       'amber',   3),
  ('compareceu',     'Compareceu',     'teal',    4),
  ('cliente',        'Cliente',        'emerald', 5),
  ('recorrente',     'Recorrente',     'fuchsia', 6),
  ('perdido',        'Perdido',        'rose',    7)
on conflict (key) do nothing;
