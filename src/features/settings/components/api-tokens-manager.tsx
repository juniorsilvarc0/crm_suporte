"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import {
  CheckIcon,
  CopyIcon,
  KeyRoundIcon,
  Loader2Icon,
  PlusIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/data-display/empty-state";
import { ActiveFilters, DataToolbar, FilterButton, FilterField, ToolbarSearch } from "@/components/data-display/data-toolbar";
import { FormSelect } from "@/components/forms/form-select";
import { ModalFooterActions, ModalShell } from "@/components/layout/modal-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ApiTokenListItem } from "@/features/settings/types";
import { formatDate } from "@/lib/formatters/date";

export function ApiTokensManager({ tokens }: { tokens: ApiTokenListItem[] }) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  // Token em texto puro recém-gerado — só existe em memória, exibido 1x.
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ApiTokenListItem | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "revoked">("all");
  const filteredTokens = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    return tokens.filter((token) => {
      const matchesQuery = !normalized || `${token.name} ${token.token_prefix}`.toLocaleLowerCase("pt-BR").includes(normalized);
      const matchesStatus = statusFilter === "all" || (statusFilter === "active" ? !token.revoked_at : Boolean(token.revoked_at));
      return matchesQuery && matchesStatus;
    });
  }, [query, statusFilter, tokens]);

  function openCreate() {
    setErrors({});
    setCreatedToken(null);
    setCopied(false);
    setCreateOpen(true);
  }

  function handleCreateOpenChange(next: boolean) {
    setCreateOpen(next);
    if (!next) {
      setCreatedToken(null);
      setCopied(false);
      setErrors({});
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrors({});

    const payload = Object.fromEntries(new FormData(event.currentTarget));

    try {
      const res = await fetch("/api/api-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await res.json()) as {
        ok: boolean;
        token?: string;
        message?: string;
        errors?: Record<string, string[]>;
      };

      if (!res.ok || !result.ok || !result.token) {
        setErrors(result.errors ?? {});
        toast.error(result.message ?? "Não foi possível gerar o token.");
        return;
      }

      setCreatedToken(result.token);
      router.refresh();
    } catch {
      toast.error("Não foi possível gerar o token.");
    } finally {
      setPending(false);
    }
  }

  async function copyToken() {
    if (!createdToken) return;
    try {
      await navigator.clipboard.writeText(createdToken);
      setCopied(true);
      toast.success("Token copiado.");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Não foi possível copiar. Selecione e copie manualmente.");
    }
  }

  async function confirmRevoke() {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      const res = await fetch(`/api/api-tokens/${revokeTarget.id}`, {
        method: "DELETE",
      });
      const result = (await res.json()) as { ok: boolean; message?: string };
      if (!res.ok || !result.ok) {
        toast.error(result.message ?? "Não foi possível revogar o token.");
        return;
      }
      toast.success(result.message ?? "Token revogado.");
      setRevokeTarget(null);
      router.refresh();
    } catch {
      toast.error("Não foi possível revogar o token.");
    } finally {
      setRevoking(false);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Tokens de API</h2>
          <p className="text-sm text-muted-foreground">
            Gere um token para integrações externas autorizadas.
            O token aparece uma única vez — guarde-o com segurança.
          </p>
        </div>
        <Button onClick={openCreate}>
          <PlusIcon data-icon="inline-start" />
          Gerar token
        </Button>
      </div>

      <DataToolbar>
        <ToolbarSearch aria-label="Buscar token" placeholder="Buscar token por nome..." value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <FilterButton activeCount={statusFilter === "all" ? 0 : 1}><FilterField label="Status"><FormSelect value={statusFilter} onValueChange={(value) => setStatusFilter((value || "all") as "all" | "active" | "revoked")} aria-label="Filtrar tokens por status" options={[{ value: "all", label: "Todos" }, { value: "active", label: "Ativos" }, { value: "revoked", label: "Revogados" }]} /></FilterField></FilterButton>
          <ActiveFilters count={(statusFilter === "all" ? 0 : 1) + (query ? 1 : 0)} onClear={() => { setQuery(""); setStatusFilter("all"); }} />
        </div>
      </DataToolbar>
      <div className="flex h-10 items-center text-xs text-muted-foreground" aria-live="polite">{filteredTokens.length} de {tokens.length} tokens</div>

      {filteredTokens.length === 0 ? (
        <EmptyState>Nenhum token encontrado.</EmptyState>
      ) : (
        <>
        <div className="hidden overflow-hidden rounded-xl border border-border/60 bg-muted/20 px-2 pb-2 shadow-soft md:block">
          <Table variant="cards">
            <TableHeader>
              <TableRow variant="cards-header">
                <TableHead className="text-xs uppercase tracking-normal text-muted-foreground">
                  Token
                </TableHead>
                <TableHead className="text-xs uppercase tracking-normal text-muted-foreground">
                  Status
                </TableHead>
                <TableHead className="text-xs uppercase tracking-normal text-muted-foreground">
                  Último uso
                </TableHead>
                <TableHead className="text-xs uppercase tracking-normal text-muted-foreground">
                  Criado em
                </TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTokens.map((token) => {
                const revoked = token.revoked_at !== null;
                return (
                  <TableRow key={token.id} variant="card" className={revoked ? "opacity-60" : undefined}>
                    <TableCell>
                      <div className="flex items-center gap-2 font-medium">
                        <KeyRoundIcon className="size-4 text-muted-foreground" />
                        {token.name}
                      </div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {token.token_prefix}…
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={revoked ? "outline" : "default"}>
                        {revoked ? "Revogado" : "Ativo"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {token.last_used_at ? formatDate(token.last_used_at) : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(token.created_at)}
                    </TableCell>
                    <TableCell className="py-1 text-right">
                      {revoked ? null : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setRevokeTarget(token)}
                        >
                          <Trash2Icon data-icon="inline-start" />
                          Revogar
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <div className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border/60 bg-card shadow-soft md:hidden">
          {filteredTokens.map((token) => { const revoked = token.revoked_at !== null; return (
            <article key={token.id} className={revoked ? "p-4 opacity-60" : "p-4"}>
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="flex items-center gap-2 truncate font-medium"><KeyRoundIcon className="size-4 text-muted-foreground" aria-hidden />{token.name}</h3><p className="mt-1 font-mono text-xs text-muted-foreground">{token.token_prefix}…</p></div><Badge variant={revoked ? "outline" : "default"}>{revoked ? "Revogado" : "Ativo"}</Badge></div>
              <div className="mt-3 flex items-end justify-between gap-3"><p className="text-xs text-muted-foreground">Criado em {formatDate(token.created_at)}<br />Último uso: {token.last_used_at ? formatDate(token.last_used_at) : "—"}</p>{revoked ? null : <Button type="button" variant="ghost" size="sm" className="h-11 text-destructive hover:text-destructive" onClick={() => setRevokeTarget(token)}><Trash2Icon data-icon="inline-start" />Revogar</Button>}</div>
            </article>
          ); })}
        </div>
        </>
      )}

      {/* Gerar token — dois estados: formulário e revelação do token */}
      <Dialog open={createOpen} onOpenChange={handleCreateOpenChange}>
        {createdToken ? (
          <ModalShell
            size="medium"
            title="Token gerado"
            description="Copie agora — por segurança, ele não será exibido novamente."
            footer={<ModalFooterActions><Button type="button" onClick={() => handleCreateOpenChange(false)} className="h-11 sm:h-9">Concluir</Button></ModalFooterActions>}
          >
              <div className="grid gap-3">
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
                  <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
                  <span>
                    Guarde este token com segurança. Quem tiver ele pode chamar a
                    sua API. Se vazar, revogue e gere outro.
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 overflow-x-auto rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-xs whitespace-nowrap">
                    {createdToken}
                  </code>
                  <Button type="button" variant="outline" size="icon" onClick={copyToken}>
                    {copied ? (
                      <CheckIcon className="text-emerald-600" />
                    ) : (
                      <CopyIcon />
                    )}
                  </Button>
                </div>
              </div>
          </ModalShell>
        ) : (
          <ModalShell
            size="compact"
            title="Gerar token de API"
            description="Dê um nome para identificar quem usará esta credencial."
            onSubmit={handleCreate}
            footer={<ModalFooterActions><Button type="button" variant="outline" onClick={() => handleCreateOpenChange(false)} className="h-11 sm:h-9">Cancelar</Button><Button type="submit" disabled={pending} className="h-11 sm:h-9">{pending ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : null}Gerar token</Button></ModalFooterActions>}
          >
                <div className="grid gap-1.5">
                  <Label htmlFor="new-token-name">Nome</Label>
                  <Input
                    id="new-token-name"
                    name="name"
                    autoComplete="off"
                    placeholder="Ex.: n8n produção"
                    required
                    aria-invalid={errors.name ? true : undefined}
                    aria-describedby={errors.name ? "new-token-name-err" : undefined}
                  />
                  {errors.name ? (
                    <p id="new-token-name-err" className="text-xs text-destructive">
                      {errors.name[0]}
                    </p>
                  ) : null}
                </div>
          </ModalShell>
        )}
      </Dialog>

      {/* Confirmação de revogação */}
      <Dialog
        open={revokeTarget !== null}
        onOpenChange={(next) => {
          if (!next) setRevokeTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Revogar token</DialogTitle>
            <DialogDescription>
              {revokeTarget
                ? `O token "${revokeTarget.name}" deixará de funcionar imediatamente. Integrações que o usam vão parar de autenticar. Esta ação não pode ser desfeita.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setRevokeTarget(null)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={revoking}
              onClick={confirmRevoke}
            >
              {revoking ? (
                <Loader2Icon className="animate-spin" data-icon="inline-start" />
              ) : null}
              Revogar token
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
