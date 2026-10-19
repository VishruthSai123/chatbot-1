/**
 * Base URL of the tool API, for client components.
 *
 * Every tool family shares one serverless function (see
 * `app/api/tools/[family]/route.ts`) so the Hobby function budget is not spent on
 * routing. The family is a path segment; the action stays in the JSON body.
 */
export function toolEndpoint(family: string): string {
  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/tools/${family}`;
}

export const IMAGE_TOOL_ENDPOINT = toolEndpoint("image");
