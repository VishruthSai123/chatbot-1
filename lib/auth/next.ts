/*
 * Where to go after signing in.
 *
 * The auth pages accept `?next=`, so a guest who was blocked mid-conversation
 * comes back to that conversation instead of the home screen. Only a path on
 * this site is honoured — an absolute URL would make the login page an open
 * redirect.
 */

/** A safe in-app path, or the home page. */
export function safeNextPath(value: string | null | undefined): string {
  if (!value) {
    return "/";
  }

  // "//evil.example" is protocol-relative and leaves the site.
  if (!value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  return value;
}
