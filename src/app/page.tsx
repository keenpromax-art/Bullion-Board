import TerminalPage from "./terminal/page";

// `/` IS the terminal workspace (repurposed per the BBG-terminal brief).
// The classic dashboard lives on as the DIR panel + command line inside it.
export default function Home() {
  return <TerminalPage />;
}
