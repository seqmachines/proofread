import { InviteLanding } from "@/components/InviteLanding";

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ protocol?: string; name?: string }>;
}) {
  const { token } = await params;
  const { protocol, name } = await searchParams;
  return <InviteLanding token={decodeURIComponent(token)} protocolId={protocol ?? null} name={name ?? null} />;
}
