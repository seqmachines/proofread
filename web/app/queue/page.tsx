import { QueuePage } from "@/components/QueuePage";

export default async function Queue({ searchParams }: { searchParams: Promise<{ source?: string }> }) {
  const { source } = await searchParams;
  return <QueuePage initialSource={source === "fixtures" ? "fixtures" : "backend"} />;
}
