"use client";

import { useEffect, useMemo, useState } from "react";

type TeamUser = { id: string; name: string };

/**
 * Nome de quem é quem na equipe, para o cliente.
 *
 * `app_users` é service-role-only (AGENTS §3.1): o browser não lê a tabela.
 * `/api/app-users` já existe e devolve `{id, name}` das pessoas ativas mais o
 * id de quem está logado, para qualquer sessão — não é rota de admin.
 *
 * O `Map` em vez da lista porque o uso é sempre "quem escreveu esta linha?", e
 * resolver por `find` dentro de uma lista de bolhas seria varredura por render.
 *
 * ⚠️ Isto existe porque a nota interna precisa assinar o autor, e o autor pode
 * chegar pelo realtime — payload cru, sem join. Um `select` com join na rota
 * resolveria a carga inicial e deixaria a mensagem que chega ao vivo sem nome.
 */
export function useTeamDirectory() {
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  // Como as mensagens deste operador são assinadas (`null` = sem assinatura).
  // O chat usa para a bolha otimista já nascer com o texto que vai ao contato.
  const [signature, setSignature] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch("/api/app-users", { signal: controller.signal });
        const result = (await response.json()) as {
          ok?: boolean;
          users?: TeamUser[];
          currentUserId?: string;
          currentUserSignature?: string | null;
        };
        if (!response.ok || !result.ok) return;
        setUsers(result.users ?? []);
        setCurrentUserId(result.currentUserId ?? null);
        setSignature(result.currentUserSignature ?? null);
      } catch {
        // Falhar aqui só tira a assinatura da nota. Não pode derrubar o chat,
        // e um toast por causa disso seria ruído no meio do atendimento.
      }
    })();

    return () => controller.abort();
  }, []);

  const names = useMemo(
    () => new Map(users.map((user) => [user.id, user.name])),
    [users]
  );

  return { names, currentUserId, signature };
}
