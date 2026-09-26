import TerminalPage from "./terminal/page";
import ModeGate from "@/droid/shell/ModeGate";

// `/` IS the terminal workspace (repurposed per the BBG-terminal brief).
// The classic dashboard lives on as the DIR panel + command line inside it.
// ModeGate (client, desktop no-op) sends phones to /home unless Terminal Mode.
export default function Home() {
  return (
    <>
      <TerminalPage />
      <ModeGate />
    </>
  );
}
