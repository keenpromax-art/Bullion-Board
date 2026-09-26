import { Suspense } from "react";
import AIScreen from "@/droid/screens/AIScreen";

export const metadata = { title: "Ask Bullion Droid" };

export default function Page() {
  return (
    <Suspense>
      <AIScreen />
    </Suspense>
  );
}
