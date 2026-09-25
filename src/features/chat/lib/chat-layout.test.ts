import { describe, expect, it } from "vitest";

import { CHAT_COLUMN_CLASS } from "@/features/chat/lib/chat-layout";

describe("CHAT_COLUMN_CLASS", () => {
  it("mantém a coluna fluida sem limitar monitores largos a 1024 px", () => {
    expect(CHAT_COLUMN_CLASS).toContain("w-full");
    expect(CHAT_COLUMN_CLASS).not.toMatch(/(?:^|\s)max-w-/u);
  });

  it("preserva gutters progressivos do celular ao monitor largo", () => {
    expect(CHAT_COLUMN_CLASS).toContain("px-2");
    expect(CHAT_COLUMN_CLASS).toContain("sm:px-5");
    expect(CHAT_COLUMN_CLASS).toContain(
      "lg:px-[clamp(2rem,3vw,4.5rem)]"
    );
  });
});
