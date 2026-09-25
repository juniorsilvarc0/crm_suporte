-- ============================================================================
-- Recarrega o cache de schema do PostgREST.
--
-- POR QUE ISTO EXISTE: a tela de Início passou a ler o sexo e o nascimento do
-- paciente por embed (`leads(name, patients(sex))`). Embed depende de o
-- PostgREST CONHECER a foreign key `leads.patient_id` — e ele guarda o schema
-- em cache. Se a migration `20260818120000_pacientes.sql` for aplicada sem um
-- reload, toda consulta com esse embed responde PGRST200, as duas leituras da
-- home caem no `catch` e a tela mostra "Nenhuma pessoa ainda" e "Nenhum
-- atendimento nesta semana" — duas frases falsas, que é exatamente o estado
-- fabricado que o AGENTS §0.2.6 proíbe.
--
-- `notify` é idempotente e não altera dado nenhum: pode rodar quantas vezes for.
-- Mesma prática das migrations 20260809110000, 20260809111000 e 20260810160000.
-- ============================================================================

notify pgrst, 'reload schema';
