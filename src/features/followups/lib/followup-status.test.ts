import { describe, expect, it } from "vitest";

import {
  FOLLOWUP_STATUSES,
  followupStatusColor,
  followupStatusLabel,
  isFollowupStatus,
} from "@/features/followups/lib/followup-status";

describe("followup-status", () => {
  it("tem pendente → concluido, ou cancelado", () => {
    expect([...FOLLOWUP_STATUSES]).toEqual(["pendente", "concluido", "cancelado"]);
  });

  it("isFollowupStatus aceita só os válidos", () => {
    expect(isFollowupStatus("concluido")).toBe(true);
    expect(isFollowupStatus("enviado")).toBe(false);
    expect(isFollowupStatus(undefined)).toBe(false);
  });

  it("todo estado tem rótulo e cor", () => {
    for (const status of FOLLOWUP_STATUSES) {
      expect(followupStatusLabel[status]).toBeTruthy();
      expect(followupStatusColor[status]).toBeTruthy();
    }
  });
});
