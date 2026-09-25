export const MAX_ATTACHMENT_BATCH = 10;

export type AttachmentDraft = {
  id: string;
  file: File;
  caption: string;
};

export type AttachmentBatchProgress = {
  current: number;
  total: number;
};

function fileFingerprint(file: File): string {
  return [file.name, file.size, file.type, file.lastModified].join(":");
}

export function appendAttachmentDrafts(
  current: AttachmentDraft[],
  files: File[]
): {
  attachments: AttachmentDraft[];
  duplicateCount: number;
  overflowCount: number;
} {
  const attachments = [...current];
  const fingerprints = new Set(current.map(({ file }) => fileFingerprint(file)));
  let duplicateCount = 0;
  let overflowCount = 0;

  for (const file of files) {
    const fingerprint = fileFingerprint(file);
    if (fingerprints.has(fingerprint)) {
      duplicateCount += 1;
      continue;
    }
    if (attachments.length >= MAX_ATTACHMENT_BATCH) {
      overflowCount += 1;
      continue;
    }

    fingerprints.add(fingerprint);
    attachments.push({
      id: fingerprint,
      file,
      caption: "",
    });
  }

  return { attachments, duplicateCount, overflowCount };
}

export async function sendAttachmentBatch(
  attachments: AttachmentDraft[],
  send: (attachment: AttachmentDraft, index: number) => Promise<boolean>,
  onProgress?: (progress: AttachmentBatchProgress) => void
): Promise<{ sentIds: string[]; failedId: string | null }> {
  const sentIds: string[] = [];

  for (const [index, attachment] of attachments.entries()) {
    onProgress?.({ current: index + 1, total: attachments.length });
    const sent = await send(attachment, index);
    if (!sent) return { sentIds, failedId: attachment.id };
    sentIds.push(attachment.id);
  }

  return { sentIds, failedId: null };
}
