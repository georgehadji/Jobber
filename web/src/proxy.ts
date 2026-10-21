import { NextResponse, type NextRequest } from "next/server";
import { checkRequest } from "@/lib/core/request-guard";

// Single guard in front of every /api route (Next 16 "proxy", successor of middleware).
export function proxy(req: NextRequest) {
  const reason = checkRequest(
    {
      method: req.method,
      host: req.headers.get("host"),
      origin: req.headers.get("origin"),
      secFetchSite: req.headers.get("sec-fetch-site"),
      contentType: req.headers.get("content-type"),
    },
    req.nextUrl.pathname,
    process.env.JOBBER_ALLOWED_HOSTS,
  );
  if (reason) return NextResponse.json({ error: reason }, { status: 403 });
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
