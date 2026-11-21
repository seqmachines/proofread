import { Workbench } from "@/components/Workbench";
import { notFound, redirect } from "next/navigation";
import { API_URL } from "@/lib/api";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (id === "fixture" || id.startsWith("fixture-")) return <Workbench runId={id} label={id} />;
  const response = await fetch(`${API_URL}/run-links/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error("Could not open this run");
  const { run_id, slug }: { run_id: string; slug: string | null } = await response.json();
  if (slug && slug !== id) redirect(`/runs/${encodeURIComponent(slug)}`);
  return <Workbench key={run_id} runId={run_id} label={slug ?? undefined} />;
}
