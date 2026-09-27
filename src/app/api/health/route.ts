import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Liveness probe. Reports configuration presence only, never values. */
export function GET() {
  return NextResponse.json({
    ok: true,
    supabase: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    gemini: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_IMAGE_MODEL),
    video: process.env.VIDEO_PROVIDER ?? "none",
  });
}
