import GuidedHome from "../experiences/guided/GuidedHome";

export const metadata = { title: "Today — Bullion Board" };

// The Guided home fetches client-side on purpose: it is the first paint on a
// phone, and a static HTML build would ship a skeleton that then re-fetches.
// Forcing dynamic keeps the route segment from being prerendered as a shell.
export const dynamic = "force-dynamic";

export default function Page() {
  return <GuidedHome />;
}