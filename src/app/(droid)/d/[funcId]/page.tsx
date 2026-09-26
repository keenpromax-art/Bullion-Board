import DeskBridge from "@/droid/screens/DeskBridge";

export const metadata = { title: "Desk — Bullion Droid" };

export default function Page({
  params,
  searchParams,
}: {
  params: { funcId: string };
  searchParams: { symbol?: string };
}) {
  const symbol = searchParams.symbol ? decodeURIComponent(searchParams.symbol) : undefined;
  return <DeskBridge funcId={decodeURIComponent(params.funcId)} initialSymbol={symbol} />;
}
