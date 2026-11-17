import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

import { isDevelopmentEnvironment } from "./constants";

/**
 * Reads the Auth.js JWT from either cookie name.
 *
 * Auth.js changes `__Secure-` prefixing based on how it infers HTTPS. Behind a
 * proxy that inference can disagree with the request the middleware sees, and a
 * mismatch turns the guest bootstrap into a redirect loop. Trying the preferred
 * name first and then the other is cheap and removes that whole class of
 * deployment-dependent failures.
 *
 * A malformed token is treated as signed out; it must never crash middleware.
 */
export async function readAuthToken(request: NextRequest) {
  const secret = process.env.AUTH_SECRET;

  if (!secret) {
    return null;
  }

  const preferred = !isDevelopmentEnvironment;
  const decode = (secureCookie: boolean) =>
    getToken({
      req: request,
      secret,
      secureCookie,
    }).catch(() => null);

  return (await decode(preferred)) ?? (await decode(!preferred));
}
