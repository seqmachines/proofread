import { BenchmarkPage } from "@/components/BenchmarkPage";
import type { GroupBy } from "@/lib/benchmark";

const GROUPS = new Set<string>(["run", "protocol", "executor", "version"]);

export default async function Benchmark({ searchParams }: { searchParams: Promise<{ source?: string; group_by?: string }> }) {
  const { source, group_by } = await searchParams;
  return (
    <BenchmarkPage
      initialSource={source === "fixtures" ? "fixtures" : "backend"}
      initialGroup={group_by && GROUPS.has(group_by) ? (group_by as GroupBy) : "run"}
    />
  );
}
