import { NextResponse } from "next/server";

import { leadsToCsv } from "@/features/leads/lib/leads-to-csv";
import { getLeads } from "@/features/leads/queries/get-leads";
import { hasDashboardSession } from "@/lib/auth/require-dashboard-session";
import { toAppDateKey } from "@/lib/formatters/date";

export const runtime = "nodejs";

export async function GET() {
  if (!(await hasDashboardSession())) {
    return NextResponse.json({ ok: false, message: "Sessão inválida." }, { status: 401 });
  }

  const leads = await getLeads();
  const csv = leadsToCsv(leads);
  // BOM (﻿) para o Excel reconhecer UTF-8 e não quebrar acentuação.
  const body = `﻿${csv}`;
  const filename = `leads-${toAppDateKey(new Date())}.csv`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
