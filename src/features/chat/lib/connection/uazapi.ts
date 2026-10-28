// Serviço de conexão da instância uazapi. Funções puras (recebem apiUrl+token),
// espelhando o padrão de `senders/`. Toda saída externa passa pelo SSRF guard.
//
// Contrato (header de auth: `token`):
//   POST {base}/instance/connect  body {} | {phone}  -> QR / pairing / connected
//   GET  {base}/instance/status                       -> { status, instance }
//   POST {base}/webhook           body {enabled,url,events}
//
// Os nomes exatos de alguns campos da resposta variam entre versões da uazapi,
// então a leitura é DEFENSIVA (tenta vários caminhos) — confirmar contra a
// instância real logando o payload cru quando necessário.

import { isGroupJid } from "@/features/chat/lib/whatsapp-group";
import { assertSafeUrl, safeBaseUrl } from "@/lib/security/ssrf-guard";

export type ConnectionState = "open" | "connecting" | "close" | "unknown";

export type UazapiConnect = {
  connected: boolean;
  qrcode: string | null; // data URI pronto para <img src>
  pairingCode: string | null;
};

export type UazapiStatusResult = {
  connected: boolean;
  state: ConnectionState;
  owner: string | null; // telefone dono da instância (só dígitos)
  /**
   * Motivo da última desconexão, quando o provedor informa (o nome do campo
   * varia entre versões; ausente = null). Só texto curto: nunca o corpo inteiro
   * da resposta, que traz o token da instância.
   */
  reason: string | null;
};

/** Teto do motivo guardado (o mesmo do check de chat_connection_events.reason). */
const REASON_MAX = 300;

/**
 * Os eventos que o CRM assina no webhook da uazapi (doc oficial, POST /webhook).
 * `connection` avisa na hora quando a sessão cai ou volta, com o motivo
 * (o monitor do worker consulta o status a cada 2 min; o evento chega antes).
 */
export const UAZAPI_WEBHOOK_EVENTS = ["messages", "messages_update", "connection"] as const;

const TIMEOUT_MS = 15000;

// ---- helpers de leitura defensiva -----------------------------------------

function pickPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (cur && typeof cur === "object" && key in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return cur;
}

function firstString(obj: unknown, paths: string[]): string | null {
  for (const p of paths) {
    const v = pickPath(obj, p);
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function readConnected(obj: unknown): boolean {
  for (const p of ["connected", "status.connected", "instance.connected"]) {
    const v = pickPath(obj, p);
    if (typeof v === "boolean") return v;
  }
  // fallback textual: instance.status === 'connected'/'open'
  const s = firstString(obj, ["instance.status", "status.status", "status", "state"]);
  return s === "connected" || s === "open";
}

/** Extrai só os dígitos do telefone de um wid tipo "5511...@s.whatsapp.net". */
function ownerToPhone(owner: string | null): string | null {
  if (!owner) return null;
  const digits = owner.replace(/@.+$/, "").replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

/** Normaliza o QR para um data URI que o <img> renderiza. */
function normalizeQr(value: string | null): string | null {
  if (!value) return null;
  if (value.startsWith("data:")) return value;
  // string base64 crua de imagem -> prefixa como PNG
  return `data:image/png;base64,${value}`;
}

const OPEN_STATUSES = ["connected", "open"];
const CONNECTING_STATUSES = ["connecting", "qr", "qrcode", "pairing", "waiting", "connectingsocket"];
const CLOSED_STATUSES = ["disconnected", "close", "closed", "removed", "banned"];

/**
 * O estado de um status textual da uazapi (do `/instance/status` ou do evento
 * `connection`). `null` = status que não reconhecemos: quem chama decide (o
 * webhook ignora; o status da instância cai na regra de `mapState`).
 */
export function connectionStateFromStatus(status: string | null | undefined): Exclude<ConnectionState, "unknown"> | null {
  const s = (status ?? "").trim().toLowerCase();
  if (OPEN_STATUSES.includes(s)) return "open";
  if (CONNECTING_STATUSES.includes(s)) return "connecting";
  if (CLOSED_STATUSES.includes(s)) return "close";
  return null;
}

/**
 * O motivo da desconexão, como guardamos: texto curto e aparado. O provedor
 * manda `unknown` quando não sabe; isso não é motivo, vira `null`.
 */
export function normalizeDisconnectReason(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  if (!text || text.toLowerCase() === "unknown") return null;
  return text.slice(0, REASON_MAX);
}

function mapState(connected: boolean, instanceStatus: string | null): ConnectionState {
  if (connected) return "open";
  const known = connectionStateFromStatus(instanceStatus);
  if (known === "connecting" || known === "close") return known;
  // sem QR ainda e sem status claro: tratamos como "connecting" para o painel
  // continuar buscando o QR.
  return instanceStatus ? "close" : "connecting";
}

// ---- API -------------------------------------------------------------------

export type UazapiDownloadedMedia = { fileURL: string; mimetype: string | null };

/**
 * Baixa a mídia (já DECRIPTADA e re-hospedada pela uazapi) de uma mensagem pelo
 * id: `POST {base}/message/download { id }` -> `{ fileURL, mimetype }`.
 *
 * Usado sobretudo para mídia de SAÍDA (fromMe enviada pelo agente direto na
 * uazapi): esse caminho NÃO gera o evento `FileDownloaded`, então a mídia não
 * chega pela via normal e o card ficaria eternamente "carregando…". A URL crua
 * (`content.URL`, mmg.whatsapp.net) é criptografada e inútil sem decriptar — este
 * endpoint devolve a versão pronta. Retorna `null` se indisponível.
 */
export async function downloadUazapiMedia(
  apiUrl: string,
  token: string,
  messageId: string
): Promise<UazapiDownloadedMedia | null> {
  try {
    const base = safeBaseUrl(apiUrl);
    const res = await fetch(`${base}/message/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify({ id: messageId }),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as
      | { fileURL?: string; fileUrl?: string; mimetype?: string; mimeType?: string }
      | null;
    const fileURL = data?.fileURL ?? data?.fileUrl ?? null;
    if (!fileURL) return null;
    return { fileURL, mimetype: data?.mimetype ?? data?.mimeType ?? null };
  } catch {
    return null;
  }
}

/**
 * Inicia (ou reinicia) o pareamento e devolve o QR / código de pareamento.
 * ATENÇÃO: cada chamada reinicia o socket de pareamento — chamar com parcimônia
 * (o painel busca no mount e a cada ~25s enquanto não conectado).
 */
export async function connectUazapi(
  apiUrl: string,
  token: string,
  phone?: string
): Promise<UazapiConnect> {
  const base = safeBaseUrl(apiUrl);
  const res = await fetch(`${base}/instance/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token },
    body: JSON.stringify(phone ? { phone } : {}),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new Error(`uazapi connect ${res.status}: ${body.slice(0, 200)}`);
  }
  const json: unknown = await res.json().catch(() => ({}));
  return {
    connected: readConnected(json),
    qrcode: normalizeQr(
      firstString(json, [
        "qrcode",
        "base64",
        "instance.qrcode",
        "instance.base64",
        "instance.qr",
        "qr",
      ])
    ),
    pairingCode: firstString(json, [
      "paircode",
      "pairingCode",
      "instance.paircode",
      "instance.pairingCode",
    ]),
  };
}

/** Estado leve da instância (pode ser consultado com frequência). */
export async function getUazapiStatus(
  apiUrl: string,
  token: string
): Promise<UazapiStatusResult> {
  const base = safeBaseUrl(apiUrl);
  const res = await fetch(`${base}/instance/status`, {
    method: "GET",
    headers: { token },
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new Error(`uazapi status ${res.status}: ${body.slice(0, 200)}`);
  }
  const json: unknown = await res.json().catch(() => ({}));
  const connected = readConnected(json);
  const instanceStatus = firstString(json, ["instance.status", "status.status", "state"]);
  const owner = firstString(json, [
    "instance.owner",
    "instance.wid",
    "instance.jid",
    "owner",
    "wid",
  ]);
  const reason = connected
    ? null
    : firstString(json, [
        "instance.lastDisconnectReason",
        "instance.last_disconnect_reason",
        "instance.disconnectReason",
        "lastDisconnectReason",
        "status.lastDisconnectReason",
        "status.reason",
      ]);
  return {
    connected,
    state: mapState(connected, instanceStatus),
    owner: ownerToPhone(owner),
    reason: normalizeDisconnectReason(reason),
  };
}

export type UazapiGroup = { jid: string; name: string };

/**
 * Os grupos em que a instância está (`GET /group/list`, validado contra a
 * instância real: `{ groups: [{ JID, Name }] }`). Sem `force` a uazapi responde
 * do cache dela; com `force` relê do WhatsApp, mais lento. Só funciona com a
 * instância conectada. Grupo sem nome vira o JID; repetido sai uma vez.
 */
export async function listUazapiGroups(
  apiUrl: string,
  token: string,
  force = false
): Promise<UazapiGroup[]> {
  const base = safeBaseUrl(apiUrl);
  const res = await fetch(`${base}/group/list${force ? "?force=true" : ""}`, {
    method: "GET",
    headers: { token },
    cache: "no-store",
    signal: AbortSignal.timeout(force ? 30000 : TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`uazapi group/list ${res.status}`);
  }
  const json: unknown = await res.json().catch(() => null);
  const raw = Array.isArray(json) ? json : pickPath(json, "groups");
  const groups = new Map<string, UazapiGroup>();
  for (const item of Array.isArray(raw) ? raw : []) {
    const jid = firstString(item, ["JID", "jid", "id"]);
    if (!isGroupJid(jid) || groups.has(jid)) continue;
    const name = firstString(item, ["Name", "name", "subject", "Subject"]);
    groups.set(jid, { jid, name: name?.trim() || jid });
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/**
 * Registra o webhook da instância apontando para a nossa rota de entrada.
 * `webhookUrl` já deve conter o `?s=<secret>`.
 */
export async function registerUazapiWebhook(
  apiUrl: string,
  token: string,
  webhookUrl: string,
  events: readonly string[] = UAZAPI_WEBHOOK_EVENTS
): Promise<void> {
  const base = safeBaseUrl(apiUrl);
  // sanidade: a nossa URL de webhook precisa ser http(s) válida (não SSRF —
  // é a nossa própria origem/túnel, que pode ser pública).
  if (!/^https?:\/\//.test(webhookUrl)) {
    throw new Error("URL de webhook inválida para registro na uazapi.");
  }
  const res = await fetch(`${base}/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token },
    body: JSON.stringify({ enabled: true, url: webhookUrl, events }),
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new Error(`uazapi webhook ${res.status}: ${body.slice(0, 200)}`);
  }
}

/**
 * Desconecta (logout) a instância do WhatsApp. As credenciais continuam válidas
 * — dá pra reconectar escaneando um novo QR (mesma instância → conversas
 * preservadas, pois a linha chat_integrations é a mesma).
 */
export async function disconnectUazapi(apiUrl: string, token: string): Promise<void> {
  const base = safeBaseUrl(apiUrl);
  const res = await fetch(`${base}/instance/disconnect`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token },
    body: "{}",
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new Error(`uazapi disconnect ${res.status}: ${body.slice(0, 200)}`);
  }
}

/** Valida credenciais (usado no persist antes de gravar). Lança se inseguro. */
export function assertUazapiCredentials(apiUrl: string, token: string): void {
  assertSafeUrl(apiUrl);
  if (!token || token.trim().length < 8) {
    throw new Error("Token da uazapi ausente ou muito curto.");
  }
}
