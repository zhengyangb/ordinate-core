import { DocumentState, validateDocument } from "@ordinate/core";
import { FORMATS } from "../interchange/contracts";
import { validateDocumentName } from "../platform/documentName";

export type RemoteWorkbook = { url: string; name: string; hostname: string };
const APPROVAL_PREFIX = "ordinate:online:url-approval:";
const FETCH_TIMEOUT_MS = 30_000;
const INVALID_WORKBOOK = "This file is not a valid Ordinate workbook.";
const FILE_UNAVAILABLE = "The file could not be opened. Check the link or open a downloaded copy.";

function decodeWorkbookText(decoder: TextDecoder, chunk?: Uint8Array): string {
  try { return decoder.decode(chunk, { stream: chunk !== undefined }); }
  catch (cause) { throw new Error(INVALID_WORKBOOK, { cause }); }
}

/** A suffix is a display hint; workbook content is validated after download. */
export function hasOrdFileExtension(url: URL): boolean {
  return /\.ord$/i.test(url.pathname);
}

/** A file URL is data, not a command, script, login flow or writable adapter. */
export function remoteWorkbook(input: string, editorOrigin: string): RemoteWorkbook {
  let url: URL;
  try { url = new URL(input.trim()); }
  catch { throw new Error("Enter a complete file URL."); }
  // Same-origin assets include shipped examples and HTTP development servers.
  // This is not permission to fetch other localhost ports or private hosts.
  const sameOrigin = (url.protocol === "https:" || url.protocol === "http:") && url.origin === editorOrigin;
  if (!sameOrigin && url.protocol !== "https:") throw new Error("The file link must use HTTPS, unless hosted on this editor's own origin.");
  if (url.username || url.password) throw new Error("File links must not contain a username or password.");
  if (url.hash) throw new Error("Use a direct download link.");
  const host = url.hostname;
  const octets = host.split(".").map(Number);
  const privateIPv4 = octets.length === 4 && octets.every(Number.isInteger) && (
    octets[0] === 0 || octets[0] === 10 || octets[0] === 127 || octets[0] >= 224 ||
    (octets[0] === 169 && octets[1] === 254) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127));
  // Cross-origin links must be public. This rejects literal local targets; it is
  // not a DNS firewall. Browser CORS and explicit consent remain necessary.
  if (!sameOrigin && (!host.includes(".") || host.endsWith(".localhost") || host.endsWith(".local") || privateIPv4)) {
    throw new Error("Use a public HTTPS file link, not a local network address.");
  }
  // Download endpoints and root URLs can have no filename. The imported copy
  // uses the usual untitled label; URL permissions still use the complete URL.
  const name = decodeURIComponent(url.pathname.split("/").at(-1)!) || "Untitled";
  validateDocumentName(name);
  return { url: url.href, name, hostname: host };
}

/** Decode exactly once; embedded query separators belong to the file URL. */
export function remoteUrlFromFragment(hash: string, editorOrigin: string): RemoteWorkbook | null {
  if (!hash.startsWith("#url=")) return null;
  try { return remoteWorkbook(decodeURIComponent(hash.slice(5)), editorOrigin); }
  catch (cause) {
    if (cause instanceof URIError) throw new Error("This file link is invalid.", { cause });
    throw cause;
  }
}

export function createRemoteApprovalStore(storage: Pick<Storage, "getItem" | "setItem">) {
  return {
    has: (url: string) => {
      const value = storage.getItem(APPROVAL_PREFIX + url);
      if (value !== null && value !== "allowed") throw new Error("The saved link approval is invalid.");
      return value === "allowed";
    },
    approve: (url: string) => storage.setItem(APPROVAL_PREFIX + url, "allowed"),
  };
}

export async function readRemoteWorkbook(remote: RemoteWorkbook, signal: AbortSignal,
  fetchFile: typeof fetch = fetch): Promise<string> {
  if (signal.aborted) throw signal.reason;
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  if (signal.aborted) cancel();
  signal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("Opening the file timed out. Try again.")), FETCH_TIMEOUT_MS);
  try {
    // No cookies, referrer, proxy or opaque no-cors fallback. Redirects require
    // the user to supply the final URL, so consent stays tied to one endpoint.
    let response: Response;
    try {
      response = await fetchFile(remote.url, { cache: "no-store", mode: "cors", credentials: "omit", referrerPolicy: "no-referrer",
        redirect: "error", signal: controller.signal });
    } catch (cause) {
      if (cause instanceof TypeError) throw new Error(FILE_UNAVAILABLE, { cause });
      throw cause;
    }
    if (!response.ok) throw new Error(response.status === 404 ? "The file could not be found." : FILE_UNAVAILABLE);
    if (!response.body) throw new Error(INVALID_WORKBOOK);
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let size = 0;
    let text = "";
    try {
      for (;;) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try { chunk = await reader.read(); }
        catch (cause) { throw new Error(FILE_UNAVAILABLE, { cause }); }
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > FORMATS.ord.maxInput) throw new Error("This file is too large to open (maximum 16 MiB).");
        text += decodeWorkbookText(decoder, chunk.value);
      }
      text += decodeWorkbookText(decoder);
    } catch (cause) {
      // Cleanup must not replace the actionable failure with a stream diagnostic.
      try { await reader.cancel(); }
      finally { throw cause; }
    }
    finally { reader.releaseLock(); }
    // Core diagnostics are useful in source editing, but a downloaded file
    // needs a format-level error rather than parser or workbook structure detail.
    let valid: boolean;
    try { valid = DocumentState.fromText(text).sheets.length > 0 && validateDocument(text).errors.length === 0; }
    catch (cause) { throw new Error(INVALID_WORKBOOK, { cause }); }
    if (!valid) throw new Error(INVALID_WORKBOOK);
    return text;
  } catch (cause) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw cause;
  } finally { clearTimeout(timer); signal.removeEventListener("abort", cancel); }
}
