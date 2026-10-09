import { describe, expect, it } from "vitest";

import {
  FOLLOWUP_KINDS,
  followupKindColor,
  followupKindLabel,
  followupKindOptions,
  isFollowupKind,
} from "@/features/followups/lib/followup-kind";

describe("followup-kind", () => {
  it("tem os três tipos de retorno", () => {
    expect([...FOLLOWUP_KINDS]).toEqual(["retorno", "verificacao", "cobranca"]);
  });

  it("isFollowupKind aceita só os válidos", () => {
    expect(isFollowupKind("verificacao")).toBe(true);
    expect(isFollowupKind("outro")).toBe(false);
    expect(isFollowupKind(null)).toBe(false);
  });

  it("todo tipo tem rótulo e cor; as opções cobrem os tipos", () => {
    for (const kind of FOLLOWUP_KINDS) {
      expect(followupKindLabel[kind]).toBeTruthy();
      expect(followupKindColor[kind]).toBeTruthy();
    }
    expect(followupKindOptions.map((option) => option.value)).toEqual([...FOLLOWUP_KINDS]);
  });
});
