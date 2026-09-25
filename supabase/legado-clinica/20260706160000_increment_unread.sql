-- Incremento ATÔMICO do contador de não-lidas. O upsert de mensagem fazia
-- read-modify-write (lê unread_count e grava +1 em duas queries): dois webhooks
-- inbound concorrentes na mesma conversa subcontavam (lost update). Este RPC faz
-- o incremento numa única instrução, eliminando a janela de corrida.

create or replace function public.increment_unread(conv_id uuid)
returns void
language sql
as $$
  update public.chat_conversations
     set unread_count = unread_count + 1
   where id = conv_id;
$$;

grant execute on function public.increment_unread(uuid) to service_role;
