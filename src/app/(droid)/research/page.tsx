import { Suspense } from "react";
import ResearchHub from "@/droid/screens/ResearchHub";

export const metadata = { title: "Research — Bullion Droid" };

export default function Page() {
  return (
    <Suspense>
      <ResearchHub />
    </Suspense>
  );
}
