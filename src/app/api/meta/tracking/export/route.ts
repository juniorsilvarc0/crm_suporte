import { NextResponse } from "next/server";
import { z } from "zod";
import { requireDashboardTracking } from "@/lib/auth/require-dashboard-session";
import { getMetaTrackingReport, metaReportToCsv } from "@/features/meta/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    campaignId: z.string().max(200).optional(),
    adsetId: z.string().max(200).optional(),
    adId: z.string().max(200).optional(),
  })
  .refine((value) => value.from <= value.to);

export async function GET(request: Request) {
  const auth = await requireDashboardTracking();
  if ("error" in auth) return auth.error;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: "invalid_filters" }, { status: 400 });
  }

  try {
    const report = await getMetaTrackingReport(parsed.data);
    return new Response(`\uFEFF${metaReportToCsv(report)}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="meta-tracking-${parsed.data.from}-${parsed.data.to}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ ok: false, reason: "export_failed" }, { status: 500 });
  }
}
