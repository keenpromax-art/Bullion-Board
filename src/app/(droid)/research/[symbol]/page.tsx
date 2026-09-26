import ResearchMode from "@/droid/screens/ResearchMode";

export const metadata = { title: "Research Mode — Bullion Droid" };

export default function Page({ params }: { params: { symbol: string } }) {
  return <ResearchMode symbol={decodeURIComponent(params.symbol)} />;
}
