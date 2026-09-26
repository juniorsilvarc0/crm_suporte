import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import type { HomeNotes } from "@/features/home/types";
import type { TicketQueue } from "@/features/tickets/types";

// A página é fina: confere quem é, lê as notas e a fila DELE e entrega cada
// leitura ao seu painel. As consultas e os painéis viram marcadores.
const { viewerMock, notesMock, queueMock, queuePanelMock, notesPanelMock } = vi.hoisted(() => ({
  viewerMock: vi.fn(),
  notesMock: vi.fn(),
  queueMock: vi.fn(),
  queuePanelMock: vi.fn<(props: { queue: TicketQueue | null }) => null>(() => null),
  notesPanelMock: vi.fn<(props: { initial: HomeNotes }) => null>(() => null),
}));

vi.mock("@/lib/auth/require-dashboard-session", () => ({ getDashboardViewer: viewerMock }));
vi.mock("@/features/home/queries/get-notes", () => ({ getNotes: notesMock }));
vi.mock("@/features/tickets/queries/get-ticket-queue", () => ({ getTicketQueue: queueMock }));
vi.mock("@/features/tickets/components/ticket-queue-panel", () => ({
  TicketQueuePanel: queuePanelMock,
}));
vi.mock("@/features/home/components/notes-panel", () => ({ NotesPanel: notesPanelMock }));
vi.mock("@/features/home/components/floating-chat-button", () => ({ FloatingChatButton: () => null }));
vi.mock("@/components/layout/page-header", () => ({ PageHeader: () => null }));

import HomePage from "@/app/(dashboard)/app/page";

const VIEWER_ID = "5b0e0c2a-1d3f-4c55-9a77-0c1d2e3f4a5b";

const NOTES: HomeNotes = { quick: { content: "Ligar para a padaria", updatedAt: null }, stickies: [] };

const QUEUE: TicketQueue = {
  mine: { items: [], total: 0, failed: false },
  unassigned: { items: [], total: 0, failed: false },
  fetchedAt: "2026-09-26T15:00:00.000Z",
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("Início", () => {
  it("lê a fila e as notas de quem está logado e entrega cada leitura ao seu painel", async () => {
    viewerMock.mockResolvedValue({ id: VIEWER_ID });
    notesMock.mockResolvedValue(NOTES);
    queueMock.mockResolvedValue(QUEUE);

    render(await HomePage());

    expect(queueMock).toHaveBeenCalledWith(VIEWER_ID);
    expect(notesMock).toHaveBeenCalledWith(VIEWER_ID);
    expect(queuePanelMock.mock.calls[0]![0]).toEqual({ queue: QUEUE });
    expect(notesPanelMock.mock.calls[0]![0]).toEqual({ initial: NOTES });
  });

  it("sem usuário confirmado, não consulta: a fila vai nula (a falha, nunca \"nenhum ticket\")", async () => {
    viewerMock.mockResolvedValue(null);

    render(await HomePage());

    expect(queueMock).not.toHaveBeenCalled();
    expect(notesMock).not.toHaveBeenCalled();
    expect(queuePanelMock.mock.calls[0]![0]).toEqual({ queue: null });
  });
});
