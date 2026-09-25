import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

import { ContactCard } from "@/features/chat/components/contact-card";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("ContactCard", () => {
  it("verifica o telefone e abre a conversa do contato", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          exists: true,
          conversation: { id: "conversation-1" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ContactCard
        content={"Abner\nPhone: +55 11 99000-0001"}
        isOutbound={false}
      />
    );

    await user.click(screen.getByRole("button", { name: "Conversar" }));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      phone: "+55 11 99000-0001",
      name: "Abner",
    });
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith(
        "/app/chat?conversation=conversation-1"
      );
    });
  });
});
