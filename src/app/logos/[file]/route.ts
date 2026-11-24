import { getLogoFile } from "@/db/queries/logos";
import { getWebDb } from "@/db/web";

/**
 * Serves a cached company logo (D72). Only a stored, unblocked logo whose id,
 * hash and extension all match is served, with its type as the probe found
 * it from the bytes. Anything else is a 404.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
): Promise<Response> {
  const { file } = await params;
  const logo = await getLogoFile(getWebDb(), file);
  if (!logo) {
    return new Response("Not found", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  }
  return new Response(new Uint8Array(logo.bytes), {
    status: 200,
    headers: {
      "Content-Type": logo.mime,
      "Content-Length": String(logo.bytes.byteLength),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
      "Cross-Origin-Resource-Policy": "same-origin",
      // The address changes with the image, so it can be cached for a year.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
