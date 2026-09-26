import type { ChatMessage } from "@/features/chat/types";
import { formatBytes } from "@/lib/formatters/bytes";

export type DocumentMessagePresentation = {
  fileName: string;
  extension: string | null;
  sizeLabel: string | null;
  caption: string | null;
};

const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  "application/pdf": "pdf",
  "application/json": "json",
  "application/msword": "doc",
  "application/vnd.ms-excel": "xls",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/zip": "zip",
  "text/csv": "csv",
  "text/plain": "txt",
};

const DOCUMENT_EXTENSION_PATTERN =
  /[.](?:7z|csv|docx?|json|od[st]|pdf|pptx?|rar|rtf|txt|xlsx?|xml|zip)$/iu;

type DocumentSource = Pick<
  ChatMessage,
  "content" | "media_mime_type" | "media_url" | "metadata"
>;

export function getDocumentMessagePresentation(
  message: DocumentSource
): DocumentMessagePresentation {
  const metadataName = metadataString(message.metadata, [
    "fileName",
    "filename",
    "file_name",
    "docName",
  ]);
  const content = message.content?.trim() || null;
  const contentName = content && looksLikeDocumentName(content)
    ? normalizeFileName(content)
    : null;
  const explicitName = metadataName ? normalizeFileName(metadataName) : contentName;
  const extension =
    extensionFromName(explicitName) ??
    normalizeExtension(metadataString(message.metadata, ["fileExtension", "extension"])) ??
    extensionFromMime(message.media_mime_type) ??
    extensionFromUrl(message.media_url);
  const fileName = explicitName
    ? extension && !extensionFromName(explicitName)
      ? `${explicitName}.${extension}`
      : explicitName
    : extension
      ? `Documento.${extension}`
      : "Documento";
  const metadataCaption = metadataString(message.metadata, ["caption"]);
  const caption = metadataCaption ?? resolveContentCaption(content, explicitName);
  const size = metadataNumber(message.metadata, ["fileSize", "file_size", "size"]);

  return {
    fileName,
    extension: extension?.toUpperCase() ?? null,
    sizeLabel: size === null ? null : formatBytes(size),
    caption,
  };
}

function resolveContentCaption(content: string | null, fileName: string | null): string | null {
  if (!content || /^https?:\/\//iu.test(content)) return null;
  if (fileName && normalizeFileName(content).toLowerCase() === fileName.toLowerCase()) {
    return null;
  }
  return looksLikeDocumentName(content) ? null : content;
}

function looksLikeDocumentName(value: string): boolean {
  return value.length <= 255 && !value.includes("\n") && DOCUMENT_EXTENSION_PATTERN.test(value);
}

function normalizeFileName(value: string): string {
  const decoded = safeDecode(value).split(/[?#]/u)[0] ?? value;
  const name = decoded.split(/[\\/]/u).at(-1)?.trim() || decoded.trim();

  return name
    .replace(
      /[.]vnd[.]openxmlformats-officedocument[.]spreadsheetml(?:[.]sheet)?$/iu,
      ".xlsx"
    )
    .replace(
      /[.]vnd[.]openxmlformats-officedocument[.]wordprocessingml(?:[.]document)?$/iu,
      ".docx"
    )
    .replace(
      /[.]vnd[.]openxmlformats-officedocument[.]presentationml(?:[.]presentation)?$/iu,
      ".pptx"
    )
    .replace(/[.]vnd[.]ms-excel$/iu, ".xls");
}

function extensionFromName(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/[.]([a-z0-9]{1,8})$/iu);
  return normalizeExtension(match?.[1] ?? null);
}

function extensionFromMime(value: string | null): string | null {
  if (!value) return null;
  return EXTENSION_BY_MIME[value.split(";", 1)[0]?.trim().toLowerCase() ?? ""] ?? null;
}

function extensionFromUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    return extensionFromName(safeDecode(new URL(value).pathname));
  } catch {
    return null;
  }
}

function normalizeExtension(value: string | null): string | null {
  const extension = value?.replace(/^[.]/u, "").trim().toLowerCase();
  return extension && /^[a-z0-9]{1,8}$/u.test(extension) ? extension : null;
}

function metadataString(metadata: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function metadataNumber(metadata: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = metadata[key];
    const parsed = typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
