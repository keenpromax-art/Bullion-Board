import TerminalPage from "./terminal/page";
import ModeGate from "@/droid/shell/ModeGate";
import ExperienceGate from "./experiences/ExperienceGate";

// `/` ROUTES ON THE READER'S CHOSEN EXPERIENCE:
//   guided -> /g   (modern, visual, mobile-first)
//   hybrid -> /g   (modern cards, terminal command bar kept in reach)
//   pro    -> the terminal workspace, unchanged
//
// The gate is client-side because the experience is a persisted local preference,
// so the server cannot know it. Until that preference resolves, `/` renders the
// terminal: the default experience is Pro, and a reader who never chose anything
// must never be shown a redirect to a face they did not pick.
export default function Home() {
  return (
    <>
      <TerminalPage />
      <ExperienceGate />
      <ModeGate />
    </>
  );
}
