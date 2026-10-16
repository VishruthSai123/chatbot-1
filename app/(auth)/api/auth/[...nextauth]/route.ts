import { type NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { GET as nextAuthGet, signIn } from "@/app/(auth)/auth";
import { isDevelopmentEnvironment } from "@/lib/constants";

export { POST } from "@/app/(auth)/auth";

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ nextauth: string[] }> }
) {
  const { nextauth } = await props.params;

  if (nextauth?.length === 1 && nextauth[0] === "guest") {
    const { searchParams } = new URL(request.url);
    const rawRedirect = searchParams.get("redirectUrl") || "/";
    const redirectUrl =
      rawRedirect.startsWith("/") && !rawRedirect.startsWith("//")
        ? rawRedirect
        : "/";

    const token = await getToken({
      req: request,
      secret: process.env.AUTH_SECRET,
      secureCookie: !isDevelopmentEnvironment,
    });

    if (token) {
      const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
      return NextResponse.redirect(new URL(`${base}/`, request.url));
    }

    return signIn("guest", { redirect: true, redirectTo: redirectUrl });
  }

  return nextAuthGet(request);
}
