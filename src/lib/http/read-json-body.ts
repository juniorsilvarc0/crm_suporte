export async function readJsonBody(request: Request) {
  try {
    return { data: await request.json(), error: null };
  } catch {
    return { data: null, error: "invalid_json" as const };
  }
}
