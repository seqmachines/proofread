import { HarnessPage } from "@/components/HarnessPage";

export default async function Harness({ searchParams }: { searchParams: Promise<{ source?: string }> }) {
  const { source } = await searchParams;
  return <HarnessPage initialSource={source === "fixture" ? "fixture" : "backend"} />;
}
