// GET /api/fixture[?name=loop] — serves ../fixtures/run_example[_<name>].jsonl (outside web/)
// as NDJSON. run_example.jsonl is the backend's exported real run; run_example_loop.jsonl
// is the synthetic full loop (review → candidate → gate → promotion) kept until the
// backend re-exports a real loop after M7. Both are offline demo fallbacks.
import { readFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const name = new URL(req.url).searchParams.get("name") ?? "";
  if (!/^[a-z0-9_-]{0,40}$/i.test(name)) return new Response("bad fixture name", { status: 400 });
  const file = path.resolve(process.cwd(), "..", "fixtures", name ? `run_example_${name}.jsonl` : "run_example.jsonl");
  try {
    const text = await readFile(file, "utf8");
    return new Response(text, {
      headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
    });
  } catch {
    return new Response(`fixture not found: ${file}`, { status: 404 });
  }
}
