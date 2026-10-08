import { afterEach, describe, expect, it, vi } from "vitest";
import { createRemoteApprovalStore, hasOrdFileExtension, readRemoteWorkbook, remoteUrlFromFragment, remoteWorkbook } from "./remoteWorkbook";
import { FORMATS } from "../interchange/contracts";

const url = "https://models.example/Plan.ord?version=2&download=1";
const editorOrigin = "https://ordinate.example";
const remote = remoteWorkbook(url, editorOrigin);
const document = "# Plan\n| Input | Result |\n| 21 | = A2 * 2 |";
const signal = () => new AbortController().signal;
const fetchResult = (response: Response) => vi.fn<typeof fetch>().mockResolvedValue(response);
afterEach(() => vi.useRealTimers());

describe("remote file links", () => {
  it("normalizes a public HTTPS URL and preserves its embedded query", () => {
    expect(remoteWorkbook("  https://MODELS.example:443/Plan.ord?version=2&download=1  ", editorOrigin)).toEqual(remote);
    expect(remoteWorkbook("https://models.example/%E8%AE%A1%E5%88%92.ORD", editorOrigin).name).toBe("计划.ORD");
  });
  it.each(["http://models.example/plan.ord", "file:///tmp/plan.ord", "javascript:alert(1)", "//models.example/plan.ord", "", "https://a:b@models.example/plan.ord",
    "https://models.example/p%2Flan.ord", "https://models.example/plan.ord#secret",
    "https://localhost/plan.ord", "https://machine.local/plan.ord", "https://127.0.0.1/plan.ord", "https://0x7f000001/plan.ord", "https://10.0.1.1/plan.ord",
    "https://192.168.1.1/plan.ord", "https://172.16.1.1/plan.ord", "https://[::1]/plan.ord"])("rejects unsupported target %s", input => {
    expect(() => remoteWorkbook(input, editorOrigin)).toThrow();
  });
  it.each(["http://127.0.0.1:5190", "http://localhost:5190", "https://machine.local", "http://[::1]:5190"])("allows a direct workbook on the editor's own origin %s", origin => {
    const url = origin + "/examples/00-getting-started.ord";
    expect(remoteWorkbook(url, origin).url).toBe(url);
    expect(remoteUrlFromFragment("#url=" + encodeURIComponent(url), origin)?.url).toBe(url);
  });
  it.each(["http://127.0.0.1:5191/Plan.ord", "http://localhost:5190/Plan.ord", "https://127.0.0.1:5190/Plan.ord",
    "http://10.0.0.1/Plan.ord", "http://models.example/Plan.ord", "file:///tmp/Plan.ord"])("does not extend same-origin permission to %s", input => {
    expect(() => remoteWorkbook(input, "http://127.0.0.1:5190")).toThrow();
  });
  it.each(["file:///tmp/Plan.ord", "javascript:alert(1)", "http://a:b@127.0.0.1:5190/Plan.ord",
    "http://127.0.0.1:5190/Plan.ord#fragment"])("keeps native-file validation on same-origin links %s", input => {
    expect(() => remoteWorkbook(input, "http://127.0.0.1:5190")).toThrow();
  });
  it("decodes the fragment exactly once, with no query-string interpretation", () => {
    expect(remoteUrlFromFragment("#url=" + encodeURIComponent(url), editorOrigin)).toEqual(remote);
    const escaped = "https://models.example/Plan%20%25%20%2B.ord?tag=a%26b&plus=+";
    expect(remoteUrlFromFragment("#url=" + encodeURIComponent(escaped), editorOrigin)?.url).toBe(escaped);
    expect(remoteUrlFromFragment("#section", editorOrigin)).toBeNull();
    expect(remoteUrlFromFragment("#url", editorOrigin)).toBeNull();
    expect(() => remoteUrlFromFragment("#url=%invalid", editorOrigin)).toThrow("This file link is invalid.");
    expect(() => remoteUrlFromFragment("#url=", editorOrigin)).toThrow();
  });
  it.each([
    ["https://models.example/download?file=plan", "download"],
    ["https://models.example/share/123", "123"],
    ["https://models.example/plan.txt", "plan.txt"],
    ["https://models.example/plan.xlsx", "plan.xlsx"],
    ["https://models.example/", "Untitled"],
    ["https://models.example/download/", "Untitled"],
  ])("allows unknown extensions as input, without assuming content format: %s", (url, name) => {
    expect(remoteWorkbook(url, editorOrigin).name).toBe(name);
    expect(remoteUrlFromFragment("#url=" + encodeURIComponent(url), editorOrigin)?.url).toBe(url);
    expect(hasOrdFileExtension(new URL(url))).toBe(false);
  });
  it("uses only the URL path as the suffix hint", () => {
    expect(hasOrdFileExtension(new URL("https://models.example/PLAN.ORD?download=1"))).toBe(true);
    expect(hasOrdFileExtension(new URL("https://models.example/download?file=plan.ord"))).toBe(false);
  });
  it("keeps approvals explicit and scoped to the exact normalized URL", () => {
    const values = new Map<string, string>();
    const approval = createRemoteApprovalStore({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } });
    expect(approval.has(remote.url)).toBe(false);
    approval.approve(remote.url);
    expect(approval.has(remote.url)).toBe(true);
    expect(approval.has("https://models.example/Other.ord")).toBe(false);
    expect(approval.has(remote.url + "2")).toBe(false);
    const key = [...values.keys()][0];
    values.set(key, "corrupt");
    expect(() => approval.has(remote.url)).toThrow("invalid");
  });
});

describe("remote workbook transport", () => {
  it("accepts valid workbook content from an extensionless endpoint", async () => {
    const endpoint = remoteWorkbook("https://models.example/download?id=123", editorOrigin);
    expect(await readRemoteWorkbook(endpoint, signal(), fetchResult(new Response(document)))).toBe(document);
  });
  it("rejects HTML from an extensionless endpoint by content", async () => {
    const endpoint = remoteWorkbook("https://models.example/share/123", editorOrigin);
    await expect(readRemoteWorkbook(endpoint, signal(), fetchResult(new Response("<!doctype html><html>Sharing page</html>")))).rejects.toThrow("This file is not a valid Ordinate workbook.");
  });
  it("reads and validates the native workbook with a bounded, credential-free CORS request", async () => {
    const fetchFile = fetchResult(new Response(document));
    expect(await readRemoteWorkbook(remote, signal(), fetchFile)).toBe(document);
    expect(fetchFile).toHaveBeenCalledWith(url, expect.objectContaining({ cache: "no-store", mode: "cors", credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", signal: expect.any(AbortSignal) }));
  });
  it("decodes UTF-8 across chunk boundaries", async () => {
    const text = "# 计划\n| 你好 | 42 |";
    const bytes = new TextEncoder().encode(text);
    const body = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
    expect(await readRemoteWorkbook(remote, signal(), fetchResult(new Response(body)))).toBe(text);
  });
  it.each(["<!doctype html><html><script>alert(1)</script></html>", "", "# No table\njust a page"])("rejects non-workbook data", async text => {
    await expect(readRemoteWorkbook(remote, signal(), fetchResult(new Response(text)))).rejects.toMatchObject({ message: "This file is not a valid Ordinate workbook." });
  });
  it("does not convert malformed UTF-8 into replacement characters", async () => {
    await expect(readRemoteWorkbook(remote, signal(), fetchResult(new Response(Uint8Array.of(255))))).rejects.toMatchObject({ message: "This file is not a valid Ordinate workbook." });
  });
  it("reports HTTP failures without parsing the error page", async () => {
    await expect(readRemoteWorkbook(remote, signal(), fetchResult(new Response(document, { status: 404 })))).rejects.toThrow("The file could not be found.");
  });
  it("reports network/CORS/redirect failure without retrying or using a proxy", async () => {
    const fetchFile = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(readRemoteWorkbook(remote, signal(), fetchFile)).rejects.toThrow("The file could not be opened. Check the link or open a downloaded copy.");
    expect(fetchFile).toHaveBeenCalledTimes(1);
  });
  it("reports an interrupted download without leaking the stream error", async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new TypeError("internal stream failure")); } });
    await expect(readRemoteWorkbook(remote, signal(), fetchResult(new Response(body)))).rejects.toMatchObject({
      message: "The file could not be opened. Check the link or open a downloaded copy.",
    });
  });
  it("enforces the actual streamed bytes even when Content-Length lies", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(FORMATS.ord.maxInput + 1)); }, cancel });
    await expect(readRemoteWorkbook(remote, signal(), fetchResult(new Response(body, { headers: { "Content-Length": "1" } })))).rejects.toThrow("16 MiB");
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("cancels an in-flight fetch and releases its timeout", async () => {
    const controller = new AbortController();
    const fetchFile = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason));
    }));
    const result = readRemoteWorkbook(remote, controller.signal, fetchFile);
    controller.abort(new Error("cancelled"));
    await expect(result).rejects.toThrow("cancelled");
  });
  it("does not start an already cancelled request", async () => {
    const controller = new AbortController(); controller.abort(new Error("cancelled"));
    const fetchFile = vi.fn<typeof fetch>();
    await expect(readRemoteWorkbook(remote, controller.signal, fetchFile)).rejects.toThrow("cancelled");
    expect(fetchFile).not.toHaveBeenCalled();
  });
  it("times out a slow request", async () => {
    vi.useFakeTimers();
    const fetchFile = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason));
    }));
    const result = readRemoteWorkbook(remote, signal(), fetchFile);
    const failed = expect(result).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(30_000);
    await failed;
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("one-shot URL imports", () => {
  it("reads the URL again and returns current server input on every open", async () => {
    const updated = "# Updated Plan\n| 99 |";
    const fetchFile = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(document)).mockResolvedValueOnce(new Response(updated));
    expect(await readRemoteWorkbook(remote, signal(), fetchFile)).toBe(document);
    expect(await readRemoteWorkbook(remote, signal(), fetchFile)).toBe(updated);
    expect(fetchFile).toHaveBeenCalledTimes(2);
    for (const [target, options] of fetchFile.mock.calls) {
      expect(target).toBe(url); expect(options?.cache).toBe("no-store");
    }
  });
});
