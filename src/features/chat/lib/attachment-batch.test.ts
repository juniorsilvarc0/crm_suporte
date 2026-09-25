import { describe, expect, it, vi } from "vitest";

import {
  MAX_ATTACHMENT_BATCH,
  appendAttachmentDrafts,
  sendAttachmentBatch,
} from "@/features/chat/lib/attachment-batch";

function file(name: string, lastModified = 1) {
  return new File([name], name, { type: "text/plain", lastModified });
}

describe("appendAttachmentDrafts", () => {
  it("mantém a ordem, ignora duplicados e respeita o limite", () => {
    const first = file("primeiro.txt");
    const files = [first, ...Array.from({ length: 12 }, (_, index) => file(`${index}.txt`))];

    const result = appendAttachmentDrafts([], files);
    const repeated = appendAttachmentDrafts(result.attachments, [first]);

    expect(result.attachments).toHaveLength(MAX_ATTACHMENT_BATCH);
    expect(result.attachments[0]?.file).toBe(first);
    expect(result.overflowCount).toBe(3);
    expect(repeated.attachments).toHaveLength(MAX_ATTACHMENT_BATCH);
    expect(repeated.duplicateCount).toBe(1);
  });
});

describe("sendAttachmentBatch", () => {
  it("envia em série e informa o progresso", async () => {
    const attachments = appendAttachmentDrafts([], [file("a.txt"), file("b.txt")]).attachments;
    const events: string[] = [];

    const result = await sendAttachmentBatch(
      attachments,
      async (attachment) => {
        events.push(`envio:${attachment.file.name}`);
        return true;
      },
      ({ current, total }) => events.push(`progresso:${current}/${total}`)
    );

    expect(events).toEqual([
      "progresso:1/2",
      "envio:a.txt",
      "progresso:2/2",
      "envio:b.txt",
    ]);
    expect(result).toEqual({
      sentIds: attachments.map(({ id }) => id),
      failedId: null,
    });
  });

  it("interrompe na primeira falha e preserva os restantes", async () => {
    const attachments = appendAttachmentDrafts(
      [],
      [file("a.txt"), file("b.txt"), file("c.txt")]
    ).attachments;
    const send = vi.fn(async (_attachment, index: number) => index !== 1);

    const result = await sendAttachmentBatch(attachments, send);

    expect(send).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      sentIds: [attachments[0]?.id],
      failedId: attachments[1]?.id,
    });
  });
});
