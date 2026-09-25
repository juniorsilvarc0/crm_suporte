import { writeFile } from "node:fs/promises";

const endpoint = process.env.META_DISPATCH_URL ?? "http://web:3000/api/internal/meta/dispatch";
const secret = process.env.META_DISPATCH_SECRET;
const intervalMs = 30_000;
const heartbeatPath = "/tmp/meta-dispatcher-heartbeat";
const enabled = (value) => value?.toLowerCase() === "true";

const missing = [];
if (!secret) missing.push("META_DISPATCH_SECRET");
if (
  (enabled(process.env.META_ENRICHMENT_ENABLED) || enabled(process.env.META_CAPI_ENABLED)) &&
  !process.env.META_ACCESS_TOKEN
) {
  missing.push("META_ACCESS_TOKEN");
}
if (enabled(process.env.META_CAPI_ENABLED) && !process.env.META_DATASET_ID) {
  missing.push("META_DATASET_ID");
}
if (enabled(process.env.META_CAPI_ENABLED) && !process.env.META_WABA_ID) {
  missing.push("META_WABA_ID");
}
if (
  process.env.META_CAPI_TEST_EVENT_CODE &&
  process.env.META_DEPLOY_ENV !== "staging"
) {
  missing.push("META_CAPI_TEST_EVENT_CODE_NOT_ALLOWED_OUTSIDE_STAGING");
}
if (
  process.env.META_GRAPH_API_VERSION &&
  !/^v\d+\.\d+$/.test(process.env.META_GRAPH_API_VERSION)
) {
  missing.push("META_GRAPH_API_VERSION");
}

if (missing.length) {
  console.error(
    JSON.stringify({ component: "meta-dispatcher", event: "invalid_configuration", fields: missing })
  );
  process.exit(1);
}

let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});

async function runOnce() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 28_000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "x-meta-dispatch-secret": secret },
      signal: controller.signal,
    });
    await writeFile(heartbeatPath, new Date().toISOString());
    console.log(
      JSON.stringify({
        component: "meta-dispatcher",
        event: response.ok ? "completed" : "http_failure",
        status: response.status,
      })
    );
  } catch {
    console.error(JSON.stringify({ component: "meta-dispatcher", event: "request_failed" }));
  } finally {
    clearTimeout(timeout);
  }
}

while (!stopping) {
  const started = Date.now();
  await runOnce();
  const remaining = Math.max(0, intervalMs - (Date.now() - started));
  if (remaining) await new Promise((resolve) => setTimeout(resolve, remaining));
}
