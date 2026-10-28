// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendNoticeMock, integrationMock, adminState } = vi.hoisted(() => ({
  sendNoticeMock: vi.fn(),
  integrationMock: vi.fn(),
  adminState: {
    settings: { data: null as unknown, error: null as unknown },
    conversation: { data: null as unknown, error: null as unknown },
    ticket: { data: null as unknown, error: null as unknown },
  },
}));

// O provedor e o banco são de mentira: nenhum teste fala com o WhatsApp.
vi.mock("@/features/chat/lib/senders/uazapi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/chat/lib/senders/uazapi")>()),
  sendUazapiNotice: sendNoticeMock,
}));
vi.mock("@/features/chat/lib/connection/integration", () => ({ getUazapiIntegration: integrationMock }));
vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: () => true,
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      const result =
        table === "app_settings"
          ? adminState.settings
          : table === "chat_conversations"
            ? adminState.conversation
            : adminState.ticket;
      const query = { select: () => query, eq: () => query, maybeSingle: async () => result };
      return query;
    },
  }),
}));

import {
  appLink,
  handoffAlertText,
  notifyTeamOfHandoff,
  sendHandoffAlert,
} from "@/features/chat/lib/handoff-alert";
import { UazapiHttpError } from "@/features/chat/lib/senders/uazapi";

const INTEGRATION = { id: "i1", apiUrl: "https://inst.uazapi.com", token: "tok", phone_number: null };
const GROUP = "120363000000000001@g.us";
const CONVERSATION_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const TICKET_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

beforeEach(() => {
  vi.stubEnv("APP_PUBLIC_URL", "https://suporte.exemplo.com/");
  sendNoticeMock.mockResolvedValue({ id: null, messageid: "wa-1" });
  integrationMock.mockResolvedValue(INTEGRATION);
  adminState.settings = { data: { value: { number: "5586999990000", group_jid: GROUP, group_name: "Equipe" } }, error: null };
  adminState.conversation = { data: { contact_name: "maria", contacts: { name: "Maria Souza" } }, error: null };
  adminState.ticket = { data: { number: 1024 }, error: null };
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const silence = () => vi.spyOn(console, "error").mockImplementation(() => undefined);

describe("handoffAlertText", () => {
  it("quem é, o chamado com o motivo, o resumo e o link, cada um numa linha", () => {
    expect(
      handoffAlertText({
        contactName: "Maria Souza",
        phone: "5586999990000",
        protocol: "SUP-1024",
        reason: "[Suporte] Precisa de acesso remoto",
        summary: "PDV não abre\n desde ontem.",
        link: "https://suporte.exemplo.com/app/tickets/1024",
      })
    ).toBe(
      "🔔 *Cliente aguardando analista*\n" +
        "Maria Souza · (86) 99999-0000\n" +
        "SUP-1024 · [Suporte] Precisa de acesso remoto\n" +
        "Resumo: PDV não abre desde ontem.\n" +
        "Abrir: https://suporte.exemplo.com/app/tickets/1024"
    );
  });

  it("sem nome, chamado, resumo e link: só o telefone e o motivo; resumo longo é cortado", () => {
    expect(
      handoffAlertText({ contactName: null, phone: "5586999990000", protocol: null, reason: "Pediu um analista", summary: null, link: null })
    ).toBe("🔔 *Cliente aguardando analista*\n(86) 99999-0000\nPediu um analista");

    const longo = handoffAlertText({
      contactName: null, phone: "5586999990000", protocol: null, reason: "x", summary: "a".repeat(800), link: null,
    });
    expect(longo.split("\n")[3]).toHaveLength("Resumo: ".length + 500);
    expect(longo.endsWith("…")).toBe(true);
  });

  it("o link usa a URL pública do app; sem ela (ou inválida), não há link", () => {
    expect(appLink("/app/tickets/1024")).toBe("https://suporte.exemplo.com/app/tickets/1024");
    vi.stubEnv("APP_PUBLIC_URL", "");
    expect(appLink("/x")).toBeNull();
    vi.stubEnv("APP_PUBLIC_URL", "suporte.exemplo.com");
    expect(appLink("/x")).toBeNull();
  });
});

describe("sendHandoffAlert", () => {
  it("cada canal preenchido recebe, com um trackId (o eco é descartado pelo webhook)", async () => {
    const result = await sendHandoffAlert(INTEGRATION, { number: "5586999990000", groupJid: GROUP }, "oi");

    expect(result).toStrictEqual({ number: "sent", group: "sent" });
    const destinos = sendNoticeMock.mock.calls.map((call) => call[2]);
    expect(destinos.sort()).toStrictEqual([GROUP, "5586999990000"].sort());
    for (const call of sendNoticeMock.mock.calls) {
      expect(call[4]).toStrictEqual({ trackId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    }
  });

  it("canal vazio fica de fora", async () => {
    expect(await sendHandoffAlert(INTEGRATION, { number: null, groupJid: GROUP }, "oi")).toStrictEqual({
      number: "off",
      group: "sent",
    });
    expect(sendNoticeMock).toHaveBeenCalledTimes(1);
  });

  it("falha certa repete uma vez, com o mesmo trackId; a de um canal não impede o outro", async () => {
    silence();
    sendNoticeMock.mockImplementation(async (_u: string, _t: string, to: string) => {
      if (to === GROUP) throw new UazapiHttpError("uazapi /send/text 400: x", 400);
      return { id: null, messageid: "wa-1" };
    });

    const result = await sendHandoffAlert(INTEGRATION, { number: "5586999990000", groupJid: GROUP }, "oi");

    expect(result).toStrictEqual({ number: "sent", group: "failed" });
    const doGrupo = sendNoticeMock.mock.calls.filter((call) => call[2] === GROUP);
    expect(doGrupo).toHaveLength(2);
    expect(doGrupo[0]?.[4]).toStrictEqual(doGrupo[1]?.[4]);
  });

  it("desfecho desconhecido (5xx) não repete: poderia duplicar o aviso; o log não leva o destino", async () => {
    const consoleError = silence();
    sendNoticeMock.mockRejectedValue(new UazapiHttpError("uazapi /send/text 502: 5586999990000", 502));

    const result = await sendHandoffAlert(INTEGRATION, { number: "5586999990000", groupJid: null }, "oi");

    expect(result).toStrictEqual({ number: "failed", group: "off" });
    expect(sendNoticeMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("5586999990000");
  });
});

describe("notifyTeamOfHandoff", () => {
  const input = {
    conversationId: CONVERSATION_ID,
    phone: "5586999784625",
    ticketId: TICKET_ID,
    reason: "[Suporte] Precisa de acesso remoto",
    summary: "PDV não abre.",
  };

  it("monta o aviso com o nome do cadastro, o protocolo e o link do ticket, e manda aos dois canais", async () => {
    const result = await notifyTeamOfHandoff(input);

    expect(result).toStrictEqual({ skipped: false, number: "sent", group: "sent" });
    const text = sendNoticeMock.mock.calls[0]?.[3] as string;
    expect(text).toContain("Maria Souza · (86) 99978-4625");
    expect(text).toContain("SUP-1024 · [Suporte] Precisa de acesso remoto");
    expect(text).toContain("Resumo: PDV não abre.");
    expect(text).toContain("Abrir: https://suporte.exemplo.com/app/tickets/1024");
  });

  it("sem ticket: link da conversa no chat; sem nome no cadastro, o do WhatsApp", async () => {
    adminState.conversation = { data: { contact_name: "maria", contacts: null }, error: null };

    await notifyTeamOfHandoff({ ...input, ticketId: null });

    const text = sendNoticeMock.mock.calls[0]?.[3] as string;
    expect(text).toContain("maria · (86) 99978-4625");
    expect(text).not.toContain("SUP-");
    expect(text).toContain(`Abrir: https://suporte.exemplo.com/app/chat?conversation=${CONVERSATION_ID}`);
  });

  it("sem telefone nem grupo configurados: não envia nada", async () => {
    adminState.settings = { data: null, error: null };

    expect(await notifyTeamOfHandoff(input)).toStrictEqual({ skipped: true, reason: "not_configured" });
    expect(integrationMock).not.toHaveBeenCalled();
    expect(sendNoticeMock).not.toHaveBeenCalled();
  });

  it("sem o WhatsApp do CRM: não envia", async () => {
    integrationMock.mockResolvedValue(null);

    expect(await notifyTeamOfHandoff(input)).toStrictEqual({ skipped: true, reason: "no_whatsapp" });
    expect(sendNoticeMock).not.toHaveBeenCalled();
  });

  it("leitura que falha não lança (o handoff já foi gravado)", async () => {
    silence();
    adminState.settings = { data: null, error: { message: "conexão caiu" } };

    await expect(notifyTeamOfHandoff(input)).resolves.toStrictEqual({ skipped: true, reason: "error" });
    expect(sendNoticeMock).not.toHaveBeenCalled();
  });
});
