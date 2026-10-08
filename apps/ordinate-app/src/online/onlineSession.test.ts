import { describe, expect, it, vi } from "vitest";
import { ONLINE_SESSION_KEY, openOnlineSession } from "./onlineSession";

const a = "00000000-0000-4000-8000-000000000001", b = "00000000-0000-4000-8000-000000000002";
function harness(previous: string | null = null) {
  const records = new Map<string, string>(previous ? [[ONLINE_SESSION_KEY, previous]] : []);
  return { records, storage: { getItem: (key: string) => records.get(key) ?? null, setItem: (key: string, value: string) => { records.set(key, value); } },
    createId: vi.fn(() => b), claim: vi.fn(async () => true), fork: vi.fn(async () => {}) };
}

describe("Online tab ownership", () => {
  it("starts an independent session without consulting any global last document", async () => {
    const deps = harness();
    expect(await openOnlineSession(deps)).toBe(b);
    expect(deps.records.get(ONLINE_SESSION_KEY)).toBe(b);
    expect(deps.fork).not.toHaveBeenCalled();
  });
  it("retains its ID on refresh or restored tab when no other tab owns it", async () => {
    const deps = harness(a);
    expect(await openOnlineSession(deps)).toBe(a);
    expect(deps.createId).not.toHaveBeenCalled();
    expect(deps.fork).not.toHaveBeenCalled();
  });
  it("forks copied sessionStorage into an independent recovery namespace", async () => {
    const deps = harness(a); deps.claim.mockResolvedValueOnce(false);
    expect(await openOnlineSession(deps)).toBe(b);
    expect(deps.claim.mock.calls).toEqual([[a], [b]]);
    expect(deps.fork).toHaveBeenCalledWith(a, b);
    expect(deps.records.get(ONLINE_SESSION_KEY)).toBe(b);
  });
  it("never changes the pointer when a fork fails", async () => {
    const deps = harness(a); deps.claim.mockResolvedValueOnce(false); deps.fork.mockRejectedValueOnce(new Error("Quota exceeded"));
    await expect(openOnlineSession(deps)).rejects.toThrow("Quota exceeded");
    expect(deps.records.get(ONLINE_SESSION_KEY)).toBe(a);
  });
  it("does not fall back to a shared session on a lease failure", async () => {
    const deps = harness(); deps.claim.mockRejectedValueOnce(new Error("Locks unavailable"));
    await expect(openOnlineSession(deps)).rejects.toThrow("Locks unavailable");
    expect(deps.records.has(ONLINE_SESSION_KEY)).toBe(false);
  });
  it("fails a UUID collision without sharing its records", async () => {
    const deps = harness(); deps.claim.mockResolvedValueOnce(false);
    await expect(openOnlineSession(deps)).rejects.toThrow("unique");
    expect(deps.fork).not.toHaveBeenCalled();
  });
  it("reports blocked session storage rather than silently disabling recovery", async () => {
    const deps = harness(); deps.storage.getItem = () => { throw new Error("Storage blocked"); };
    await expect(openOnlineSession(deps)).rejects.toThrow("Storage blocked");
    expect(deps.claim).not.toHaveBeenCalled();
  });
  it("reports an unwritable session pointer", async () => {
    const deps = harness(); deps.storage.setItem = () => { throw new Error("Storage blocked"); };
    await expect(openOnlineSession(deps)).rejects.toThrow("Storage blocked");
  });
  it.each(["browser-untitled", "", "not-a-uuid"])("rejects corrupt ownership %s", async value => {
    const deps = harness(); deps.records.set(ONLINE_SESSION_KEY, value);
    await expect(openOnlineSession(deps)).rejects.toThrow("invalid");
    expect(deps.claim).not.toHaveBeenCalled();
  });
});
