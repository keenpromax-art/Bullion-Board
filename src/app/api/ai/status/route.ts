import { NextResponse } from "next/server";

// Key status WITHOUT leaking the key. The Config page uses this to show
// whether a server default is active; visitors can still override per-browser.
export async function GET() {
  return NextResponse.json({
    hasServerKey: !!process.env.OPENROUTER_API_KEY,
    model: process.env.OPENROUTER_MODEL || "nvidia/nemotron-3-super-120b-a12b:free",
  });
}
