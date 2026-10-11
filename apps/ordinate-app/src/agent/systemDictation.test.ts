import { describe, expect, it, vi } from "vitest";
import { SystemDictationSession } from "./systemDictation";

describe("system Dictation session", () => {
  it("stops a session started by the composer before a message is sent", async () => {
    const startSystemDictation = vi.fn(async () => {});
    const stopSystemDictation = vi.fn(async () => {});
    const session = new SystemDictationSession({ startSystemDictation, stopSystemDictation });
    await session.stop();
    expect(stopSystemDictation).not.toHaveBeenCalled();
    await session.start();
    await session.stop();
    expect(startSystemDictation).toHaveBeenCalledOnce();
    expect(stopSystemDictation).toHaveBeenCalledOnce();
    await session.stop();
    expect(stopSystemDictation).toHaveBeenCalledOnce();
  });

  it("keeps a failed stop retryable and does not mark a failed start active", async () => {
    let startFails = true;
    const startSystemDictation = vi.fn(async () => { if (startFails) throw new Error("start failed"); });
    const stopSystemDictation = vi.fn().mockRejectedValueOnce(new Error("stop failed")).mockResolvedValue(undefined);
    const session = new SystemDictationSession({ startSystemDictation, stopSystemDictation });
    await expect(session.start()).rejects.toThrow("start failed");
    await session.stop();
    expect(stopSystemDictation).not.toHaveBeenCalled();
    startFails = false;
    await session.start();
    await expect(session.stop()).rejects.toThrow("stop failed");
    await session.stop();
    expect(stopSystemDictation).toHaveBeenCalledTimes(2);
  });
});
