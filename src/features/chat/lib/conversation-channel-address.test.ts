import { describe, expect, it } from "vitest";

import { resolveConversationChannelAddress } from "@/features/chat/lib/conversation-channel-address";

describe("resolveConversationChannelAddress", () => {
  it("usa a identidade original do canal mesmo se o telefone canônico estiver formatado", () => {
    expect(
      resolveConversationChannelAddress({
        external_id: "5586999999999",
        contact_phone: "+55 (86) 99999-9999",
      })
    ).toBe("5586999999999");
  });

  it("mantém fallback para conversa legada durante o rollout", () => {
    expect(
      resolveConversationChannelAddress({
        external_id: "",
        contact_phone: " 5586999999999 ",
      })
    ).toBe("5586999999999");
  });

  it("devolve vazio quando a conversa não tem nenhum endereço", () => {
    expect(
      resolveConversationChannelAddress({ external_id: null, contact_phone: null })
    ).toBe("");
  });
});
