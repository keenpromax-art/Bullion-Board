import { NextResponse } from "next/server";
import { fredKey } from "@/lib/fred";

export async function GET() {
  return NextResponse.json({ hasServerKey: !!fredKey(null) });
}
