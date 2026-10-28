"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2Icon, RefreshCwIcon, SaveIcon, SendIcon } from "lucide-react";
import { toast } from "sonner";

import { FormSelect } from "@/components/forms/form-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { HandoffAlertConfig } from "@/features/settings/lib/get-handoff-alert";
import { ALERT_NUMBER_RE, normalizeAlertNumber } from "@/features/settings/schemas/handoff-alert";
import { formatPhoneBR } from "@/lib/formatters/phone";

type Group = { jid: string; name: string };
type Outcome = "sent" | "failed" | "off";

const CHANNEL_LABEL = { number: "ao telefone", group: "ao grupo" } as const;

async function fetchGroups(force: boolean): Promise<{ groups: Group[]; message: string | null }> {
  try {
    const res = await fetch(`/api/connection/groups${force ? "?force=1" : ""}`, { cache: "no-store" });
    const body = (await res.json().catch(() => ({}))) as { groups?: Group[]; message?: string };
    return { groups: Array.isArray(body.groups) ? body.groups : [], message: body.message ?? null };
  } catch {
    return { groups: [], message: "Não foi possível listar os grupos agora." };
  }
}

/**
 * Telefone e/ou grupo do WhatsApp que recebem o aviso quando a IA passa um
 * cliente para a equipe. Os grupos vêm do WhatsApp do CRM (os da instância);
 * o salvo continua no select mesmo antes da lista chegar.
 */
export function HandoffAlertSettings({ config }: { config: HandoffAlertConfig }) {
  const router = useRouter();
  const savedNumber = config.number ?? "";
  const savedGroup = config.groupJid ?? "";
  const [number, setNumber] = useState(config.number ? formatPhoneBR(config.number) : "");
  const [groupJid, setGroupJid] = useState(savedGroup);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [groupsMessage, setGroupsMessage] = useState<string | null>(null);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  // Re-sincroniza quando o valor do servidor muda (após salvar/refresh).
  const serverKey = `${savedNumber}|${savedGroup}`;
  const [synced, setSynced] = useState(serverKey);
  if (serverKey !== synced) {
    setSynced(serverKey);
    setNumber(config.number ? formatPhoneBR(config.number) : "");
    setGroupJid(savedGroup);
  }

  // A lista chega sozinha ao abrir (cache da uazapi); "Atualizar" relê do WhatsApp.
  useEffect(() => {
    let active = true;
    void fetchGroups(false).then((result) => {
      if (!active) return;
      setGroups(result.groups);
      setGroupsMessage(result.message);
    });
    return () => {
      active = false;
    };
  }, []);

  async function refreshGroups() {
    setLoadingGroups(true);
    const result = await fetchGroups(true);
    setGroups(result.groups);
    setGroupsMessage(result.message);
    setLoadingGroups(false);
  }

  const normalized = normalizeAlertNumber(number);
  const invalidNumber = normalized !== "" && !ALERT_NUMBER_RE.test(normalized);
  const dirty = normalized !== savedNumber || groupJid !== savedGroup;
  const canSave = dirty && !invalidNumber && !saving;
  const canTest = !dirty && Boolean(savedNumber || savedGroup) && !testing;

  const options = [...(groups ?? [])].map((group) => ({ value: group.jid, label: group.name }));
  if (savedGroup && !options.some((option) => option.value === savedGroup)) {
    options.unshift({ value: savedGroup, label: config.groupName ?? savedGroup });
  }
  const groupName = options.find((option) => option.value === groupJid)?.label ?? "";

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/handoff-alert", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number, group_jid: groupJid, group_name: groupName }),
      });
      const result = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!res.ok || !result.ok) {
        toast.error(result.message ?? "Não foi possível salvar.");
        return;
      }
      toast.success(
        normalized || groupJid
          ? "Aviso de handoff salvo. Use \"Enviar teste\" para conferir."
          : "Aviso de handoff desligado."
      );
      router.refresh();
    } catch {
      toast.error("Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    try {
      const res = await fetch("/api/settings/handoff-alert/test", { method: "POST" });
      const result = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        number?: Outcome;
        group?: Outcome;
      };
      if (!res.ok || !result.ok) {
        toast.error(result.message ?? "Não foi possível enviar o teste.");
        return;
      }
      const channels = (["number", "group"] as const).filter((channel) => result[channel] !== "off");
      const failed = channels.filter((channel) => result[channel] === "failed");
      if (failed.length === 0) {
        toast.success(`Teste enviado ${channels.map((channel) => CHANNEL_LABEL[channel]).join(" e ")}.`);
      } else {
        toast.error(`O teste não saiu ${failed.map((channel) => CHANNEL_LABEL[channel]).join(" nem ")}.`);
      }
    } catch {
      toast.error("Não foi possível enviar o teste.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="handoff-alert-number">Telefone da equipe</Label>
        <Input
          id="handoff-alert-number"
          value={number}
          onChange={(event) => setNumber(event.target.value)}
          inputMode="tel"
          autoComplete="off"
          placeholder="Ex.: (86) 99999-0000"
          aria-invalid={invalidNumber}
          aria-describedby="handoff-alert-number-hint"
          className="h-10"
        />
        <p
          id="handoff-alert-number-hint"
          className={invalidNumber ? "text-xs text-rose-600 dark:text-rose-400" : "text-xs text-muted-foreground"}
        >
          {invalidNumber
            ? "Telefone inválido: use DDD + número."
            : "Se alguém responder ao aviso neste telefone, a resposta vira uma conversa no chat. Para a equipe, prefira o grupo."}
        </p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="handoff-alert-group">Grupo do WhatsApp</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <FormSelect
            id="handoff-alert-group"
            value={groupJid}
            onValueChange={setGroupJid}
            options={options}
            emptyLabel="Nenhum grupo"
            aria-label="Grupo que recebe o aviso"
            aria-describedby="handoff-alert-group-hint"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => void refreshGroups()}
            disabled={loadingGroups || groups === null}
            className="h-10 shrink-0 sm:w-32"
          >
            {loadingGroups ? (
              <Loader2Icon className="animate-spin" data-icon="inline-start" />
            ) : (
              <RefreshCwIcon data-icon="inline-start" />
            )}
            Atualizar
          </Button>
        </div>
        <p id="handoff-alert-group-hint" className="text-xs text-muted-foreground">
          {groups === null
            ? "Carregando os grupos…"
            : (groupsMessage ??
              (groups.length === 0
                ? "O WhatsApp do CRM não está em nenhum grupo."
                : "Os grupos em que o WhatsApp do CRM está."))}
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button onClick={save} disabled={!canSave} className="h-10 sm:w-28">
          {saving ? (
            <Loader2Icon className="animate-spin" data-icon="inline-start" />
          ) : (
            <SaveIcon data-icon="inline-start" />
          )}
          Salvar
        </Button>
        <Button type="button" variant="outline" onClick={sendTest} disabled={!canTest} className="h-10">
          {testing ? (
            <Loader2Icon className="animate-spin" data-icon="inline-start" />
          ) : (
            <SendIcon data-icon="inline-start" />
          )}
          Enviar teste
        </Button>
      </div>
    </div>
  );
}
