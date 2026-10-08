import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SyncContractsButton } from "@/features/customers/components/sync-contracts-button";
import type { ReconcileContractsReport } from "@/features/customers/types";

const { refreshMock, successMock, errorMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  successMock: vi.fn(),
  errorMock: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));
vi.mock("sonner", () => ({ toast: { success: successMock, error: errorMock } }));

const fetchMock = vi.fn();

function report(overrides: Partial<ReconcileContractsReport>): ReconcileContractsReport {
  return {
    processed: 0,
    ok: 0,
    notFound: 0,
    unavailable: 0,
    ambiguous: 0,
    skipped: 0,
    contractsUpserted: 0,
    cursor: null,
    done: true,
    notConfigured: false,
    ...overrides,
  };
}

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  refreshMock.mockReset();
  successMock.mockReset();
  errorMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SyncContractsButton", () => {
  it("roda em levas por cursor até done e recarrega", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, report: report({ processed: 1, ok: 1, contractsUpserted: 2, cursor: "a", done: false }) })
      )
      .mockResolvedValueOnce(
        jsonResponse({ ok: true, report: report({ processed: 1, ok: 1, contractsUpserted: 1, cursor: null, done: true }) })
      );

    render(<SyncContractsButton />);
    await userEvent.click(screen.getByRole("button", { name: "Sincronizar contratos (TCBX)" }));
    await userEvent.click(screen.getByRole("button", { name: "Sincronizar" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    // 1ª leva sem cursor, 2ª com o cursor da anterior.
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toMatchObject({ after: null });
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toMatchObject({ after: "a" });
    expect(successMock).toHaveBeenCalled();
  });

  it("aborta e avisa quando a integração está desligada", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, report: report({ notConfigured: true, done: true }) }));

    render(<SyncContractsButton />);
    await userEvent.click(screen.getByRole("button", { name: "Sincronizar contratos (TCBX)" }));
    await userEvent.click(screen.getByRole("button", { name: "Sincronizar" }));

    await waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
