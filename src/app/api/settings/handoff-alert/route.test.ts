// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

// As fronteiras de mentira: auth de admin, o banco (app_settings), a integração
// do WhatsApp e o envio. Nenhum teste fala com o WhatsApp.
const { requireAdminMock, upsertMock, settingsMock, integrationMock, sendAlertMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  upsertMock: vi.fn(),
  settingsMock: vi.fn(),
  integrationMock: vi.fn(),
  sendAlertMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({ requireDashboardAdmin: requireAdminMock }));
vi.mock("@/lib/supabase/admin", () => ({
  hasSupabaseAdminEnv: () => true,
  createSupabaseAdminClient: () => ({ from: () => ({ upsert: upsertMock }) }),
}));
vi.mock("@/features/settings/lib/get-handoff-alert", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/settings/lib/get-handoff-alert")>()),
  readHandoffAlertConfig: settingsMock,
}));
vi.mock("@/features/chat/lib/connection/integration", () => ({ getUazapiIntegration: integrationMock }));
vi.mock("@/features/chat/lib/handoff-alert", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/chat/lib/handoff-alert")>()),
  sendHandoffAlert: sendAlertMock,
}));

import { PATCH } from "@/app/api/settings/handoff-alert/route";
import { POST as sendTest } from "@/app/api/settings/handoff-alert/test/route";
import { HANDOFF_ALERT_TEST_TEXT } from "@/features/chat/lib/handoff-alert";

const GROUP = "120363000000000001@g.us";
const ADMIN = { viewer: { id: "u1", role: "admin" } };

function patch(body: unknown) {
  return new Request("http://x/api/settings/handoff-alert", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/settings/handoff-alert", () => {
  it("não-admin: o erro de auth, sem gravar", async () => {
    requireAdminMock.mockResolvedValue({
      error: NextResponse.json({ ok: false, message: "forbidden" }, { status: 403 }),
    });

    expect((await PATCH(patch({ number: "", group_jid: GROUP }))).status).toBe(403);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("grava o telefone só em dígitos, com o 55, e o grupo com o nome", async () => {
    requireAdminMock.mockResolvedValue(ADMIN);
    upsertMock.mockResolvedValue({ error: null });

    const res = await PATCH(patch({ number: "(86) 99999-0000", group_jid: GROUP, group_name: " Equipe " }));

    expect(res.status).toBe(200);
    expect(upsertMock.mock.calls[0]?.[0]).toMatchObject({
      key: "handoff_alert",
      value: { number: "5586999990000", group_jid: GROUP, group_name: "Equipe" },
    });
    expect(await res.json()).toMatchObject({ ok: true, number: "5586999990000", groupJid: GROUP, groupName: "Equipe" });
  });

  it("os dois vazios desligam o aviso; nome sem grupo não fica", async () => {
    requireAdminMock.mockResolvedValue(ADMIN);
    upsertMock.mockResolvedValue({ error: null });

    await PATCH(patch({ number: "", group_jid: "", group_name: "Sobrou" }));

    expect(upsertMock.mock.calls[0]?.[0].value).toStrictEqual({ number: null, group_jid: null, group_name: null });
  });

  it.each([
    ["telefone curto", { number: "99999-0000", group_jid: "" }, "Telefone inválido"],
    ["JID que não é de grupo", { number: "", group_jid: "5586999990000@s.whatsapp.net" }, "Grupo inválido."],
  ])("%s: 400, sem gravar", async (_label, body, message) => {
    requireAdminMock.mockResolvedValue(ADMIN);

    const res = await PATCH(patch(body));

    expect(res.status).toBe(400);
    expect((await res.json()).message).toContain(message);
    expect(upsertMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/settings/handoff-alert/test", () => {
  it("manda o texto de teste à configuração salva e diz o desfecho de cada canal", async () => {
    requireAdminMock.mockResolvedValue(ADMIN);
    const config = { number: "5586999990000", groupJid: GROUP, groupName: "Equipe" };
    const integration = { id: "i1", apiUrl: "https://inst.uazapi.com", token: "tok", phone_number: null };
    settingsMock.mockResolvedValue(config);
    integrationMock.mockResolvedValue(integration);
    sendAlertMock.mockResolvedValue({ number: "sent", group: "failed" });

    const res = await sendTest();

    expect(await res.json()).toStrictEqual({ ok: true, number: "sent", group: "failed" });
    expect(sendAlertMock).toHaveBeenCalledWith(integration, config, HANDOFF_ALERT_TEST_TEXT);
  });

  it("sem telefone nem grupo salvos: 400; sem WhatsApp: 409; nada é enviado", async () => {
    requireAdminMock.mockResolvedValue(ADMIN);
    settingsMock.mockResolvedValue({ number: null, groupJid: null, groupName: null });
    expect((await sendTest()).status).toBe(400);

    settingsMock.mockResolvedValue({ number: "5586999990000", groupJid: null, groupName: null });
    integrationMock.mockResolvedValue(null);
    expect((await sendTest()).status).toBe(409);
    expect(sendAlertMock).not.toHaveBeenCalled();
  });

  it("não-admin: o erro de auth, sem enviar", async () => {
    requireAdminMock.mockResolvedValue({
      error: NextResponse.json({ ok: false, message: "forbidden" }, { status: 403 }),
    });

    expect((await sendTest()).status).toBe(403);
    expect(sendAlertMock).not.toHaveBeenCalled();
  });
});
