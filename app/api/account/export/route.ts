import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/app/(auth)/auth";
import { getUserDataExport } from "@/lib/account/export";
import { checkIpRateLimitFor } from "@/lib/ratelimit";

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const headerStore = await headers();
  const ip = headerStore.get("x-forwarded-for")?.split(",")[0]?.trim();
  const allowed = await checkIpRateLimitFor({
    ip,
    key: "account-export",
    limit: 10,
    windowSeconds: 60 * 60,
  });

  if (!allowed) {
    return NextResponse.json(
      { error: "Too many export requests. Try again later." },
      { status: 429 }
    );
  }

  const data = await getUserDataExport(session.user.id);

  if (!data) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  const date = new Date().toISOString().slice(0, 10);

  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="spire-data-${date}.json"`,
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
