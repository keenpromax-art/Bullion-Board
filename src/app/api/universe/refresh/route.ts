import { NextResponse } from "next/server";
import { refreshUniverse } from "@/lib/universe";

export const dynamic = "force-dynamic";

// Trigger a full rebuild of the world-universe index. Expensive (~minutes);
// run once, then the cached snapshot is served for 24h.
export async function POST() {
  try {
    const idx = await refreshUniverse();
    return NextResponse.json({ builtAt: idx.builtAt, discovered: idx.discovered });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "crawl failed" }, { status: 502 });
  }
}
