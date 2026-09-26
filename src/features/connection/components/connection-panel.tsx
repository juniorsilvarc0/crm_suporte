"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2Icon,
  KeyRoundIcon,
  LogOutIcon,
  RefreshCwIcon,
  SmartphoneIcon,
  Trash2Icon,
  TriangleAlertIcon,
  WifiOffIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Spinner } from "@/components/kibo-ui/spinner";
import { cn } from "@/lib/utils";

type ConnectionState = "open" | "connecting" | "close" | "unknown";

// Estado é leve → pode pollar com frequência.
const STATE_POLL_MS = 3000;
// O QR da uazapi rotaciona ~30s. Buscamos um novo um pouco antes disso.
// IMPORTANTE: cada busca de QR chama /instance/connect, que reinicia o socket de
// pareamento — buscar com pouca frequência evita abortar o scan em andamento.
const QR_TTL_MS = 25000;

const stateMeta: Record<
  ConnectionState,
  { label: string; dot: string; badge: string }
> = {
  open: {
    label: "Conectado",
    dot: "bg-emerald-500",
    badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  connecting: {
    label: "Conectando",
    dot: "bg-amber-500 animate-pulse",
    badge: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  close: {
    label: "Desconectado",
    dot: "bg-rose-500",
    badge: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
  unknown: {
    label: "Indisponível",
    dot: "bg-muted-foreground/60",
    badge: "border-border bg-muted text-muted-foreground",
  },
};

export function ConnectionPanel() {
  const [state, setState] = useState<ConnectionState>("unknown");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [instance, setInstance] = useState<string | null>(null);
  const [qrcode, setQrcode] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [webhookWarning, setWebhookWarning] = useState<string | null>(null);
  // URL atual (para pré-preencher ao "Trocar credenciais") e o modo de edição
  // forçada do formulário mesmo com uma integração já configurada.
  const [currentApiUrl, setCurrentApiUrl] = useState<string | null>(null);
  const [editingCredentials, setEditingCredentials] = useState(false);

  // Desconectar / limpar chat
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [wipeChat, setWipeChat] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [disconnecting, setDisconnecting] = useState(false);

  // Fluxo quando configurado e não conectado: "auto" (default do carregamento),
  // "qr" (mostrar QR para (re)conectar) ou "choice" (tela de escolha: reconectar
  // a mesma instância × excluir para conectar outra).
  const [flow, setFlow] = useState<"auto" | "qr" | "choice">("auto");
  const flowRef = useRef<"auto" | "qr" | "choice">("auto");

  // Excluir instância do CRM (para conectar uma nova)
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  const qrInFlight = useRef(false);
  const stateRef = useRef<ConnectionState>("unknown");
  const configuredRef = useRef<boolean | null>(null);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    configuredRef.current = configured;
  }, [configured]);
  useEffect(() => {
    flowRef.current = flow;
  }, [flow]);

  // Busca o estado (leve). NÃO dispara /instance/connect.
  const loadState = useCallback(async () => {
    try {
      const res = await fetch("/api/connection/state", { cache: "no-store" });
      const json = await res.json();
      setConfigured(json?.configured === true);
      setState((json?.state as ConnectionState) ?? "unknown");
      setCurrentApiUrl((json?.apiUrl as string) ?? null);
      if (json?.instance) setInstance(json.instance);
      if (json?.ok === false && json?.message) setErrorMsg(json.message as string);
      else setErrorMsg(null);
    } catch {
      setState("unknown");
      setErrorMsg("Sem conexão com o servidor.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Busca um QR novo (chama /instance/connect). Usar com parcimônia.
  const loadQr = useCallback(async (manual = false) => {
    if (configuredRef.current !== true) return;
    if (qrInFlight.current) return;
    qrInFlight.current = true;
    if (manual) setRefreshing(true);
    try {
      const res = await fetch("/api/connection/qr", { cache: "no-store" });
      const json = await res.json();
      setQrcode((json?.qrcode as string) ?? null);
      setPairingCode((json?.pairingCode as string) ?? null);
    } catch {
      setQrcode(null);
    } finally {
      if (manual) setRefreshing(false);
      qrInFlight.current = false;
    }
  }, []);

  // Poll do estado a cada 3s; pausa com a aba oculta.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = () => void loadState();
    const start = () => {
      if (!timer) timer = setInterval(tick, STATE_POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        tick();
        start();
      } else {
        stop();
      }
    };
    const kickoff = setTimeout(tick, 0);
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearTimeout(kickoff);
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loadState]);

  // QR: busca ao montar e renova a cada ~25s ENQUANTO configurado e não conectado.
  // Quando conecta (open) para de buscar — assim não chamamos connect durante o
  // handshake do scan (o que abortaria o pareamento).
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const refresh = () => {
      if (
        configuredRef.current === true &&
        stateRef.current !== "open" &&
        flowRef.current === "qr"
      )
        void loadQr();
    };
    const kickoff = setTimeout(refresh, 0);
    timer = setInterval(refresh, QR_TTL_MS);
    return () => {
      clearTimeout(kickoff);
      if (timer) clearInterval(timer);
    };
  }, [loadQr]);

  // Ao entrar no fluxo de QR (ex.: logo após salvar credenciais) busca o QR
  // imediatamente, sem esperar o próximo tick do intervalo (~25s).
  useEffect(() => {
    if (
      configured === true &&
      stateRef.current !== "open" &&
      flowRef.current === "qr"
    )
      void loadQr();
  }, [configured, loadQr]);

  const meta = stateMeta[state];
  const connected = state === "open";
  // Mostra o formulário quando não há integração (configured===false) OU quando o
  // usuário pediu para "Trocar credenciais" (editingCredentials) — reeditar sem
  // precisar excluir a instância (que apagaria o chat).
  const showForm = !loading && (configured === false || editingCredentials);
  // `configured !== false` cobre também o cold-start (configured===null) quando a
  // 1ª chamada de estado falha — senão o erro é engolido e o QR fica eterno.
  const showError =
    !connected && configured !== false && state === "unknown" && errorMsg !== null;

  const onManualRefresh = () => {
    void loadState();
    void loadQr(true);
  };

  // Salva credenciais e registra o webhook; ao concluir, dispara o polling.
  const onSubmitCredentials = useCallback(
    async (apiUrl: string, token: string) => {
      const res = await fetch("/api/connection/persist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiUrl, token }),
      });
      const json = await res.json();
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error ?? "Falha ao salvar as credenciais.");
      }
      setWebhookWarning(
        json?.webhookRegistered === false
          ? `Credenciais salvas, mas o webhook não foi registrado (${
              json?.webhookError ?? "erro desconhecido"
            }). O recebimento de mensagens pode não funcionar até registrar a URL: ${
              json?.webhookUrl ?? ""
            }`
          : null
      );
      setConfigured(true);
      configuredRef.current = true;
      setEditingCredentials(false); // sai do modo edição ao salvar com sucesso
      setFlow("qr");
      flowRef.current = "qr";
      await loadState();
      void loadQr(true);
    },
    [loadState, loadQr]
  );

  // Desconecta (logout) e, opcionalmente, apaga todo o chat. Ao concluir, mostra a
  // tela de escolha (reconectar × trocar de instância) — não vai direto ao QR.
  const onDisconnect = useCallback(async () => {
    setDisconnecting(true);
    try {
      const res = await fetch("/api/connection/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wipe: wipeChat }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error ?? "Falha ao desconectar.");
      }
      toast.success(
        wipeChat
          ? `Instância desconectada e chat apagado (${json?.wiped ?? 0} conversas).`
          : "Instância desconectada. Reconecte ou troque de instância."
      );
      setDisconnectOpen(false);
      setWipeChat(false);
      setConfirmText("");
      // Tela de escolha: reconectar a mesma OU excluir para conectar outra.
      setFlow("choice");
      flowRef.current = "choice";
      setQrcode(null);
      setPairingCode(null);
      await loadState();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao desconectar.");
    } finally {
      setDisconnecting(false);
    }
  }, [wipeChat, loadState]);

  // Reconecta a MESMA instância (mesmas credenciais) → gera QR. As conversas são
  // preservadas (a linha chat_integrations é a mesma).
  const onReconnect = useCallback(() => {
    setFlow("qr");
    flowRef.current = "qr";
    void loadState();
    void loadQr(true);
  }, [loadState, loadQr]);

  // Exclui a instância do CRM (apaga chat + credenciais) → volta ao formulário
  // para conectar uma instância nova.
  const onDeleteIntegration = useCallback(async () => {
    setDeleting(true);
    try {
      const res = await fetch("/api/connection/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deleteIntegration: true }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error ?? "Falha ao excluir a instância.");
      }
      toast.success(
        `Instância excluída (${json?.wiped ?? 0} conversas removidas). Conecte uma nova instância.`
      );
      setDeleteOpen(false);
      setDeleteConfirm("");
      setQrcode(null);
      setPairingCode(null);
      setInstance(null);
      setConfigured(false);
      configuredRef.current = false;
      setFlow("auto");
      flowRef.current = "auto";
      await loadState();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao excluir a instância.");
    } finally {
      setDeleting(false);
    }
  }, [loadState]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      {/* Cabeçalho de status + atualizar */}
      <div className="flex items-center justify-between gap-3">
        <Badge
          variant="outline"
          className={cn("rounded-full border px-2.5 py-0.5 text-xs font-medium", meta.badge)}
        >
          <span className={cn("size-1.5 rounded-full", meta.dot)} aria-hidden />
          {meta.label}
        </Badge>
        <Button
          variant="outline"
          size="sm"
          onClick={onManualRefresh}
          disabled={refreshing || loading}
          className="h-9"
        >
          {refreshing ? (
            <Spinner variant="ring" className="size-4" data-icon="inline-start" />
          ) : (
            <RefreshCwIcon data-icon="inline-start" />
          )}
          Atualizar
        </Button>
      </div>

      {webhookWarning ? (
        <Alert variant="destructive" className="text-left">
          <TriangleAlertIcon />
          <AlertTitle>Webhook não registrado</AlertTitle>
          <AlertDescription className="break-all">{webhookWarning}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="overflow-hidden">
        <CardContent className="flex flex-col items-center gap-5 px-5 py-7 text-center">
          {loading ? (
            <LoadingBlock />
          ) : showForm ? (
            <CredentialsForm
              onSubmit={onSubmitCredentials}
              initialUrl={editingCredentials ? currentApiUrl ?? "" : ""}
              onCancel={editingCredentials ? () => setEditingCredentials(false) : undefined}
            />
          ) : connected ? (
            <ConnectedBlock
              instance={instance}
              onDisconnect={() => setDisconnectOpen(true)}
            />
          ) : showError ? (
            <ErrorBlock
              message={errorMsg ?? undefined}
              onRetry={onManualRefresh}
              onEditCredentials={() => setEditingCredentials(true)}
            />
          ) : flow === "qr" ? (
            <QrBlock qrcode={qrcode} pairingCode={pairingCode} />
          ) : (
            <DisconnectedBlock
              instance={instance}
              onReconnect={onReconnect}
              onDelete={() => setDeleteOpen(true)}
              onEditCredentials={() => setEditingCredentials(true)}
            />
          )}
        </CardContent>
      </Card>

      {/* Rodapé: indicador de tempo real (só durante o QR) */}
      {!loading && configured && !connected && !showForm && flow === "qr" ? (
        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/60" />
            <span className="relative inline-flex size-2 rounded-full bg-primary" />
          </span>
          Verificando a conexão em tempo real
        </p>
      ) : null}

      {/* Diálogo de desconexão (com opção de limpar todo o chat) */}
      <Dialog
        open={disconnectOpen}
        onOpenChange={(o) => {
          if (disconnecting) return;
          setDisconnectOpen(o);
          if (!o) {
            setWipeChat(false);
            setConfirmText("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Desconectar instância</DialogTitle>
            <DialogDescription>
              O WhatsApp será desconectado. Você poderá reconectar escaneando o QR
              novamente — as conversas continuam as mesmas.
            </DialogDescription>
          </DialogHeader>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-left">
            <input
              type="checkbox"
              checked={wipeChat}
              onChange={(e) => {
                setWipeChat(e.target.checked);
                setConfirmText("");
              }}
              className="mt-0.5 size-4 accent-rose-600"
            />
            <span className="grid gap-0.5 text-sm">
              <span className="flex items-center gap-1 font-medium text-rose-700 dark:text-rose-300">
                <Trash2Icon className="size-3.5" /> Também apagar todo o chat
              </span>
              <span className="text-muted-foreground">
                Remove todas as conversas e mensagens. Os leads não são afetados.
                Esta ação não pode ser desfeita.
              </span>
            </span>
          </label>

          {wipeChat ? (
            <div className="grid gap-1.5 text-left">
              <Label htmlFor="wipe-confirm">
                Digite <span className="font-semibold text-rose-600">excluir</span>{" "}
                para confirmar
              </Label>
              <Input
                id="wipe-confirm"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="excluir"
                autoComplete="off"
                autoCapitalize="none"
              />
            </div>
          ) : null}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDisconnectOpen(false)}
              disabled={disconnecting}
            >
              Cancelar
            </Button>
            <Button
              variant={wipeChat ? "destructive" : "default"}
              onClick={() => void onDisconnect()}
              disabled={
                disconnecting ||
                (wipeChat && confirmText.trim().toLowerCase() !== "excluir")
              }
            >
              {disconnecting ? (
                <Spinner variant="ring" className="size-4" data-icon="inline-start" />
              ) : (
                <LogOutIcon data-icon="inline-start" />
              )}
              {wipeChat ? "Desconectar e apagar" : "Desconectar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo de exclusão da instância (para conectar uma nova) */}
      <Dialog
        open={deleteOpen}
        onOpenChange={(o) => {
          if (deleting) return;
          setDeleteOpen(o);
          if (!o) setDeleteConfirm("");
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Excluir instância do CRM</DialogTitle>
            <DialogDescription>
              Remove as credenciais desta instância e apaga todo o chat (conversas e
              mensagens). Os leads não são afetados. Depois você poderá conectar uma
              instância nova. Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-1.5 text-left">
            <Label htmlFor="delete-confirm">
              Digite <span className="font-semibold text-rose-600">excluir</span> para
              confirmar
            </Label>
            <Input
              id="delete-confirm"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="excluir"
              autoComplete="off"
              autoCapitalize="none"
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={deleting}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => void onDeleteIntegration()}
              disabled={deleting || deleteConfirm.trim().toLowerCase() !== "excluir"}
            >
              {deleting ? (
                <Spinner variant="ring" className="size-4" data-icon="inline-start" />
              ) : (
                <Trash2Icon data-icon="inline-start" />
              )}
              Excluir instância
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LoadingBlock() {
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center gap-3">
      <Spinner variant="ring" className="size-8 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Verificando conexão…</p>
    </div>
  );
}

function CredentialsForm({
  onSubmit,
  initialUrl = "",
  onCancel,
}: {
  onSubmit: (apiUrl: string, token: string) => Promise<void>;
  initialUrl?: string;
  onCancel?: () => void;
}) {
  const [apiUrl, setApiUrl] = useState(initialUrl);
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = onCancel != null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!apiUrl.trim() || !token.trim()) {
      setError("Preencha a URL da instância e o token.");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(apiUrl.trim(), token.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao conectar.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-4 text-left">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <KeyRoundIcon className="size-7" strokeWidth={1.8} />
        </div>
        <h2 className="text-lg font-semibold tracking-tight">Conectar a instância uazapi</h2>
        <p className="text-sm text-muted-foreground">
          Informe a URL do servidor e o token da instância. As credenciais ficam
          guardadas no servidor — o token não é exposto no navegador.
        </p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="uazapi-url">URL do servidor</Label>
        <Input
          id="uazapi-url"
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://sua-instancia.uazapi.com"
          value={apiUrl}
          onChange={(e) => setApiUrl(e.target.value)}
          disabled={submitting}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="uazapi-token">Token da instância</Label>
        <Input
          id="uazapi-token"
          type="password"
          autoComplete="off"
          placeholder="••••••••••••••••"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          disabled={submitting}
        />
        {editing ? (
          <p className="text-xs text-muted-foreground">
            Por segurança o token não é exibido — digite-o de novo para confirmar.
          </p>
        ) : null}
      </div>

      {error ? (
        <Alert variant="destructive" className="text-left">
          <TriangleAlertIcon />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <Button type="submit" disabled={submitting} className="h-10 sm:flex-1">
          {submitting ? (
            <Spinner variant="ring" className="size-4" data-icon="inline-start" />
          ) : (
            <KeyRoundIcon data-icon="inline-start" />
          )}
          {submitting ? "Validando…" : "Salvar e gerar QR Code"}
        </Button>
        {onCancel ? (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={submitting}
            className="h-10"
          >
            Cancelar
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function ConnectedBlock({
  instance,
  onDisconnect,
}: {
  instance: string | null;
  onDisconnect: () => void;
}) {
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center gap-4">
      <div className="flex size-16 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
        <CheckCircle2Icon className="size-9" strokeWidth={1.8} />
      </div>
      <div className="grid gap-1">
        <h2 className="text-lg font-semibold tracking-tight">WhatsApp conectado</h2>
        <p className="text-sm text-muted-foreground">
          A IA está ativa e atendendo
          {instance ? (
            <>
              {" "}
              no número <span className="font-medium text-foreground">{instance}</span>
            </>
          ) : null}
          .
        </p>
      </div>
      <Button
        variant="outline"
        onClick={onDisconnect}
        className="mt-1 h-9 border-rose-500/30 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
      >
        <LogOutIcon data-icon="inline-start" />
        Desconectar
      </Button>
    </div>
  );
}

function DisconnectedBlock({
  instance,
  onReconnect,
  onDelete,
  onEditCredentials,
}: {
  instance: string | null;
  onReconnect: () => void;
  onDelete: () => void;
  onEditCredentials?: () => void;
}) {
  return (
    <div className="flex min-h-[280px] w-full flex-col items-center justify-center gap-4">
      <div className="flex size-16 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
        <WifiOffIcon className="size-9" strokeWidth={1.8} />
      </div>
      <div className="grid gap-1">
        <h2 className="text-lg font-semibold tracking-tight">Instância desconectada</h2>
        <p className="text-sm text-muted-foreground">
          {instance ? (
            <>
              O número <span className="font-medium text-foreground">{instance}</span> foi
              desconectado.{" "}
            </>
          ) : (
            "A instância foi desconectada. "
          )}
          Reconecte para voltar a atender — as conversas continuam as mesmas — ou exclua
          para conectar outra instância.
        </p>
      </div>
      <div className="flex w-full max-w-[260px] flex-col gap-2">
        <Button onClick={onReconnect} className="h-10">
          <RefreshCwIcon data-icon="inline-start" />
          Reconectar
        </Button>
        {onEditCredentials ? (
          <Button variant="outline" onClick={onEditCredentials} className="h-10">
            <KeyRoundIcon data-icon="inline-start" />
            Trocar credenciais
          </Button>
        ) : null}
        <Button
          variant="outline"
          onClick={onDelete}
          className="h-10 border-rose-500/30 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
        >
          <Trash2Icon data-icon="inline-start" />
          Excluir instância
        </Button>
      </div>
    </div>
  );
}

function QrBlock({
  qrcode,
  pairingCode,
}: {
  qrcode: string | null;
  pairingCode: string | null;
}) {
  return (
    <div className="flex w-full flex-col items-center gap-5">
      <div className="grid gap-1">
        <h2 className="text-lg font-semibold tracking-tight">Conectar o WhatsApp</h2>
        <p className="text-sm text-muted-foreground">
          Abra o WhatsApp no celular e escaneie o código abaixo.
        </p>
      </div>

      {/* QR responsivo (quadrado, fundo branco p/ leitura em qualquer tema) */}
      <div className="flex aspect-square w-full max-w-[280px] items-center justify-center rounded-xl border border-border bg-white p-3">
        {qrcode ? (
          // eslint-disable-next-line @next/next/no-img-element -- QR é um data:image base64 da uazapi
          <img
            src={qrcode}
            alt="QR Code para conectar o WhatsApp"
            className="size-full rounded-md object-contain"
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Spinner variant="ring" className="size-6" />
            <span className="text-xs">Gerando QR Code…</span>
          </div>
        )}
      </div>

      {pairingCode ? (
        <div className="grid gap-1">
          <span className="text-xs text-muted-foreground">Ou use o código de pareamento:</span>
          <span className="font-mono text-lg font-semibold tracking-[0.2em] tabular-nums">
            {pairingCode}
          </span>
        </div>
      ) : null}

      <ol className="grid w-full gap-1.5 text-left text-xs text-muted-foreground">
        <li>1. Abra o WhatsApp no celular do suporte.</li>
        <li>2. Toque em Mais opções → Aparelhos conectados.</li>
        <li>3. Toque em Conectar um aparelho e aponte para este código.</li>
      </ol>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground/80">
        <WifiOffIcon className="size-3.5" />O código se renova sozinho a cada ~25s.
      </p>
    </div>
  );
}

function ErrorBlock({
  message,
  onRetry,
  onEditCredentials,
}: {
  message?: string;
  onRetry: () => void;
  onEditCredentials?: () => void;
}) {
  return (
    <div className="flex min-h-[280px] w-full flex-col items-center justify-center gap-4">
      <div className="flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <TriangleAlertIcon className="size-7" strokeWidth={1.8} />
      </div>
      <Alert variant="destructive" className="text-left">
        <SmartphoneIcon />
        <AlertTitle>Não foi possível falar com o servidor</AlertTitle>
        <AlertDescription>
          {message ?? "Tente novamente em instantes."}
          {onEditCredentials ? (
            <span className="mt-1 block">
              Se a URL ou o token estiverem errados, use “Trocar credenciais”.
            </span>
          ) : null}
        </AlertDescription>
      </Alert>
      <div className="flex w-full max-w-[280px] flex-col gap-2">
        {onEditCredentials ? (
          <Button onClick={onEditCredentials} className="h-10">
            <KeyRoundIcon data-icon="inline-start" />
            Trocar credenciais
          </Button>
        ) : null}
        <Button variant="outline" onClick={onRetry} className="h-10">
          <RefreshCwIcon data-icon="inline-start" />
          Tentar de novo
        </Button>
      </div>
    </div>
  );
}
