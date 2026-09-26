import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { TicketPriorityBadge } from "@/features/tickets/components/ticket-priority-badge";
import type { TicketPriority } from "@/features/tickets/types";

describe("TicketPriorityBadge", () => {
  it.each<[TicketPriority, string, string]>([
    ["baixa", "Baixa", "text-gray-600"],
    ["media", "Média", "text-slate-600"],
    ["alta", "Alta", "text-orange-700"],
    ["critica", "Crítica", "text-red-700"],
  ])("%s mostra o rótulo \"%s\" com a cor da prioridade", (priority, label, colorClass) => {
    render(<TicketPriorityBadge priority={priority} />);

    const badge = screen.getByText(label).parentElement;
    expect(badge).toHaveAttribute("title", label);
    expect(badge).toHaveClass(colorClass, "max-w-full");
  });
});
