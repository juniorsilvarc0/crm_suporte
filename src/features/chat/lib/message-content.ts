export type MessageTextEntity =
  | { type: "text"; value: string }
  | { type: "url"; value: string; href: string }
  | { type: "phone"; value: string; phone: string };

export type MessageLinkPreview = {
  url: string;
  siteName: string;
  title?: string;
  description?: string;
  imageUrl?: string;
};

const URL_PATTERN = /https?:\/\/[^\s<>"']+/giu;
const PHONE_PATTERN = /(^|[^\p{L}\p{N}])(\+?\d[\d\s().-]{7,}\d)(?=$|[^\p{L}\p{N}])/gu;
const MAX_PREVIEW_IMAGE_BASE64 = 160_000;
const SAFE_DATA_IMAGE_PATTERN =
  /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/u;

function safeWebUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function trimUrlEnd(value: string): string {
  let url = value.replace(/[.,!?;:]+$/u, "");
  while (url.endsWith(")")) {
    const opens = (url.match(/\(/g) ?? []).length;
    const closes = (url.match(/\)/g) ?? []).length;
    if (closes <= opens) break;
    url = url.slice(0, -1);
  }
  return url;
}

function splitPhones(value: string): MessageTextEntity[] {
  const entities: MessageTextEntity[] = [];
  let cursor = 0;

  for (const match of value.matchAll(PHONE_PATTERN)) {
    const boundary = match[1] ?? "";
    const candidate = match[2] ?? "";
    const start = (match.index ?? 0) + boundary.length;
    const digits = candidate.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) continue;

    if (start > cursor) entities.push({ type: "text", value: value.slice(cursor, start) });
    entities.push({ type: "phone", value: candidate, phone: candidate });
    cursor = start + candidate.length;
  }

  if (cursor < value.length) entities.push({ type: "text", value: value.slice(cursor) });
  return entities.length > 0 ? entities : [{ type: "text", value }];
}

/** Divide texto cru sem alterar nenhum caractere visível. URL tem precedência. */
export function splitMessageEntities(value: string): MessageTextEntity[] {
  const entities: MessageTextEntity[] = [];
  let cursor = 0;

  for (const match of value.matchAll(URL_PATTERN)) {
    const raw = match[0];
    const start = match.index ?? 0;
    const visible = trimUrlEnd(raw);
    const href = safeWebUrl(visible);
    if (!href) continue;

    if (start > cursor) entities.push(...splitPhones(value.slice(cursor, start)));
    entities.push({ type: "url", value: visible, href });
    cursor = start + visible.length;
  }

  if (cursor < value.length) entities.push(...splitPhones(value.slice(cursor)));
  return entities.length > 0 ? entities : [{ type: "text", value }];
}

function recordOf(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.startsWith("{") || trimmed.length > 500_000) return null;
    try {
      return recordOf(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function previewRecords(raw: unknown): Record<string, unknown>[] {
  const root = recordOf(raw);
  if (!root) return [];
  const records = [root];
  for (const key of [
    "content",
    "message",
    "extendedTextMessage",
    "linkPreview",
    "preview",
    "sendPayload",
  ]) {
    const nested = recordOf(root[key]);
    if (nested) records.push(nested);
  }
  const message = recordOf(root.message);
  const extended = recordOf(message?.extendedTextMessage);
  if (extended) records.push(extended);
  const content = recordOf(root.content);
  const contentExtended = recordOf(content?.extendedTextMessage);
  if (contentExtended) records.push(contentExtended);
  return records;
}

function firstString(records: Record<string, unknown>[], keys: string[]): string | null {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return null;
}

function previewImage(records: Record<string, unknown>[]): string | null {
  const remote = firstString(records, [
    "thumbnailUrl",
    "imageUrl",
    "linkPreviewImage",
    "previewImage",
  ]);
  if (remote) {
    if (
      remote.length <= MAX_PREVIEW_IMAGE_BASE64 &&
      SAFE_DATA_IMAGE_PATTERN.test(remote)
    ) {
      return remote;
    }
    const safe = safeWebUrl(remote);
    if (safe) return safe;
  }

  const thumbnail = firstString(records, ["jpegThumbnail"]);
  if (
    thumbnail &&
    thumbnail.length <= MAX_PREVIEW_IMAGE_BASE64 &&
    /^[A-Za-z0-9+/]+={0,2}$/u.test(thumbnail)
  ) {
    return `data:image/jpeg;base64,${thumbnail}`;
  }
  return null;
}

/** Preview persistível: usa a URL do texto e só enriquece com dados do provedor. */
export function buildMessageLinkPreview(
  text: string | null | undefined,
  raw?: unknown
): MessageLinkPreview | null {
  if (!text) return null;
  const urlEntity = splitMessageEntities(text).find(
    (entity): entity is Extract<MessageTextEntity, { type: "url" }> =>
      entity.type === "url"
  );
  if (!urlEntity) return null;

  const records = previewRecords(raw);
  const url = urlEntity.href;
  const siteName = new URL(url).hostname.replace(/^www\./u, "");
  const title = firstString(records, ["title", "linkPreviewTitle"]);
  const description = firstString(records, [
    "description",
    "linkPreviewDescription",
  ]);
  const imageUrl = previewImage(records);

  return {
    url,
    siteName,
    ...(title ? { title: title.slice(0, 180) } : {}),
    ...(description ? { description: description.slice(0, 320) } : {}),
    ...(imageUrl ? { imageUrl } : {}),
  };
}
