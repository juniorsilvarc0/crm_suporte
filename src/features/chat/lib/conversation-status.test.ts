import { describe, expect, it } from "vitest";

import { CONVERSATION_STATUSES, isConversationStatus } from "@/features/chat/lib/conversation-status";

describe("isConversationStatus", () => {
  it("deve aceitar os três donos do atendimento", () => {
    expect(CONVERSATION_STATUSES).toEqual(["bot", "human", "resolved"]);
    for (const status of CONVERSATION_STATUSES) {
      expect(isConversationStatus(status)).toBe(true);
    }
  });

  it("deve recusar o que não é status de conversa", () => {
    for (const value of ["", "BOT", "novo", "closed", null, undefined, 1, ["bot"]]) {
      expect(isConversationStatus(value)).toBe(false);
    }
  });
});
