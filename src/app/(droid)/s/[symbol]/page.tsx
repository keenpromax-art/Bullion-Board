import Security from "@/droid/screens/Security";

export const metadata = { title: "Security — Bullion Droid" };

export default function Page({
  params,
  searchParams,
}: {
  params: { symbol: string };
  searchParams: { tab?: string; symbol?: string };
}) {
  const symbol = decodeURIComponent(params.symbol);
  return <Security symbol={symbol} initialTab={searchParams.tab} />;
}
