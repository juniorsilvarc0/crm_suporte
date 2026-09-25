"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  indexTagsByConversation,
  mergeTagAssignment,
  removeTagEverywhere,
  type ConversationTagPair,
  type TagsByConversation,
} from "@/features/chat/lib/conversation-tags";
import type { ColorName } from "@/features/tags/schemas/colors";
import type { Tag } from "@/features/tags/types";

type State = {
  tags: Tag[];
  byConversation: TagsByConversation;
  loading: boolean;
  failed: boolean;
};

const INITIAL: State = {
  tags: [],
  byConversation: new Map(),
  loading: true,
  failed: false,
};

function sortByName(tags: Tag[]): Tag[] {
  return [...tags].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/**
 * Etiquetas do chat: catálogo, vínculos e as escritas.
 *
 * Dono único do estado de etiqueta, montado uma vez no `ChatShell` e descido
 * para quem precisa. Uma instância por superfície buscaria a mesma coisa três
 * vezes e as três divergiriam na primeira escrita.
 *
 * Toda escrita é **otimista com reversão**: etiquetar é gesto de meio de
 * atendimento, e esperar a rede para o chip aparecer faz a interface parecer
 * quebrada. Se a rota recusar, o estado volta exatamente ao que era.
 */
export function useConversationTags() {
  const [state, setState] = useState<State>(INITIAL);
  const [attempt, setAttempt] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch("/api/chat/conversations/tags", {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(String(response.status));
        const data = (await response.json()) as {
          tags: Tag[];
          pairs: ConversationTagPair[];
        };
        if (!alive.current) return;
        setState({
          tags: data.tags ?? [],
          byConversation: indexTagsByConversation(data.pairs ?? [], data.tags ?? []),
          loading: false,
          failed: false,
        });
      } catch (err) {
        if (controller.signal.aborted || !alive.current) return;
        console.error("[useConversationTags]", err);
        setState({ ...INITIAL, loading: false, failed: true });
      }
    }

    void load();
    return () => {
      alive.current = false;
      controller.abort();
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setState(INITIAL);
    setAttempt((current) => current + 1);
  }, []);

  /** Vincula ou desvincula, pintando antes e desfazendo se a rota recusar. */
  const assign = useCallback(
    async (conversationId: string, tag: Tag, assigned: boolean): Promise<boolean> => {
      let reverted: TagsByConversation | null = null;
      setState((current) => {
        const next = mergeTagAssignment(current.byConversation, conversationId, tag, assigned);
        if (next === current.byConversation) return current;
        reverted = current.byConversation;
        return { ...current, byConversation: next };
      });

      try {
        const response = await fetch(`/api/chat/conversations/${conversationId}/tags`, {
          method: assigned ? "POST" : "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tag_id: tag.id }),
        });
        const payload = (await response.json().catch(() => null)) as { ok?: boolean } | null;
        if (!response.ok || !payload?.ok) throw new Error(String(response.status));
        return true;
      } catch (err) {
        console.error("[useConversationTags] assign", err);
        if (alive.current && reverted) {
          const restore = reverted;
          setState((current) => ({ ...current, byConversation: restore }));
        }
        return false;
      }
    },
    []
  );

  /** Cria no catálogo. Quem chama decide se aplica na conversa em seguida. */
  const createTag = useCallback(
    async (name: string, color: ColorName): Promise<Tag | null> => {
      try {
        const response = await fetch("/api/tags", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, color }),
        });
        const payload = (await response.json().catch(() => null)) as {
          ok?: boolean;
          tag?: Tag;
        } | null;
        if (!response.ok || !payload?.ok || !payload.tag) return null;

        const created = payload.tag;
        if (alive.current) {
          setState((current) => ({ ...current, tags: sortByName([...current.tags, created]) }));
        }
        return created;
      } catch (err) {
        console.error("[useConversationTags] createTag", err);
        return null;
      }
    },
    []
  );

  const updateTag = useCallback(
    async (id: string, patch: { name?: string; color?: ColorName }): Promise<boolean> => {
      try {
        const response = await fetch(`/api/tags/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const payload = (await response.json().catch(() => null)) as { ok?: boolean } | null;
        if (!response.ok || !payload?.ok) return false;

        if (alive.current) {
          // Reindexa os vínculos com o catálogo novo: o chip mostra nome e cor,
          // e sem isto ele continuaria com o rótulo antigo até recarregar.
          setState((current) => {
            const tags = sortByName(
              current.tags.map((tag) => (tag.id === id ? { ...tag, ...patch } : tag))
            );
            const pairs: ConversationTagPair[] = [];
            for (const [conversationId, list] of current.byConversation) {
              for (const tag of list) {
                pairs.push({ conversation_id: conversationId, tag_id: tag.id });
              }
            }
            return { ...current, tags, byConversation: indexTagsByConversation(pairs, tags) };
          });
        }
        return true;
      } catch (err) {
        console.error("[useConversationTags] updateTag", err);
        return false;
      }
    },
    []
  );

  const deleteTag = useCallback(async (id: string): Promise<boolean> => {
    try {
      const response = await fetch(`/api/tags/${id}`, { method: "DELETE" });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean } | null;
      if (!response.ok || !payload?.ok) return false;

      if (alive.current) {
        // O banco apaga os vínculos em cascata; aqui só espelhamos, senão o chip
        // de uma etiqueta que já não existe ficaria na tela até recarregar.
        setState((current) => ({
          ...current,
          tags: current.tags.filter((tag) => tag.id !== id),
          byConversation: removeTagEverywhere(current.byConversation, id),
        }));
      }
      return true;
    } catch (err) {
      console.error("[useConversationTags] deleteTag", err);
      return false;
    }
  }, []);

  return {
    tags: state.tags,
    tagsByConversation: state.byConversation,
    loading: state.loading,
    failed: state.failed,
    assign,
    createTag,
    updateTag,
    deleteTag,
    retry,
  };
}

export type ConversationTagsController = ReturnType<typeof useConversationTags>;
