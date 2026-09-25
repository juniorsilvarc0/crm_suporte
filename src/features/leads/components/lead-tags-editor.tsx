"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckIcon, Loader2Icon, PlusIcon, TagIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { ColorSwatchPicker } from "@/components/forms/color-swatch-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getColorStyle, type ColorName } from "@/features/leads/schemas/colors";
import type { Tag } from "@/features/leads/types";
import { cn } from "@/lib/utils";

export function LeadTagsEditor({
  leadId,
  leadTags,
  allTags,
}: {
  leadId: string;
  leadTags: Tag[];
  allTags: Tag[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<ColorName>("violet");

  const assignedIds = new Set(leadTags.map((t) => t.id));

  async function toggle(tag: Tag, assigned: boolean) {
    setPending(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/tags`, {
        method: assigned ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag_id: tag.id }),
      });
      const result = (await res.json()) as { ok: boolean; message?: string };
      if (!res.ok || !result.ok) {
        toast.error(result.message ?? "Não foi possível atualizar a tag.");
        return;
      }
      router.refresh();
    } catch {
      toast.error("Não foi possível atualizar a tag.");
    } finally {
      setPending(false);
    }
  }

  async function createAndAssign() {
    const name = newName.trim();
    if (!name) {
      toast.error("Informe o nome da tag.");
      return;
    }
    setPending(true);
    try {
      const res = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color: newColor }),
      });
      const result = (await res.json()) as { ok: boolean; message?: string; tag?: Tag };
      if (!res.ok || !result.ok || !result.tag) {
        toast.error(result.message ?? "Não foi possível criar a tag.");
        return;
      }
      // já atribui ao lead
      await fetch(`/api/leads/${leadId}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag_id: result.tag.id }),
      });
      setNewName("");
      toast.success("Tag criada e adicionada.");
      router.refresh();
    } catch {
      toast.error("Não foi possível criar a tag.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {leadTags.map((tag) => {
        const s = getColorStyle(tag.color);
        return (
          <Badge
            key={tag.id}
            variant="outline"
            className={cn("rounded-sm border px-1.5 py-0 text-[11px] font-medium", s.badge)}
          >
            <span className={cn("size-1.5 rounded-full", s.dot)} aria-hidden />
            {tag.name}
            <button
              type="button"
              aria-label={`Remover tag ${tag.name}`}
              onClick={() => toggle(tag, true)}
              disabled={pending}
              className="ml-0.5 rounded-full opacity-70 transition-opacity hover:opacity-100"
            >
              <XIcon className="size-3" />
            </button>
          </Badge>
        );
      })}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button variant="outline" size="xs" className="h-6 gap-1 border-dashed" />
          }
        >
          <TagIcon data-icon="inline-start" />
          Tag
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 gap-2 p-2">
          <div className="px-1 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Tags
          </div>
          <div className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
            {allTags.length === 0 ? (
              <p className="px-1 py-2 text-xs text-muted-foreground">
                Nenhuma tag ainda. Crie a primeira abaixo.
              </p>
            ) : (
              allTags.map((tag) => {
                const assigned = assignedIds.has(tag.id);
                const s = getColorStyle(tag.color);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    disabled={pending}
                    onClick={() => toggle(tag, assigned)}
                    className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors hover:bg-muted focus-visible:bg-muted"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={cn("size-2.5 shrink-0 rounded-full", s.dot)} aria-hidden />
                      <span className="truncate">{tag.name}</span>
                    </span>
                    {assigned ? <CheckIcon className="size-4 shrink-0 text-primary" /> : null}
                  </button>
                );
              })
            )}
          </div>

          <div className="grid gap-2 border-t border-border/70 pt-2">
            <div className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Nova tag
            </div>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nome da tag"
              maxLength={30}
              className="h-9"
            />
            <ColorSwatchPicker value={newColor} onChange={setNewColor} />
            <Button size="sm" onClick={createAndAssign} disabled={pending} className="w-full">
              {pending ? (
                <Loader2Icon className="animate-spin" data-icon="inline-start" />
              ) : (
                <PlusIcon data-icon="inline-start" />
              )}
              Criar e adicionar
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
