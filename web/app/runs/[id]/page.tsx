import { Workbench } from "@/components/Workbench";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Workbench key={id} runId={id} />;
}
