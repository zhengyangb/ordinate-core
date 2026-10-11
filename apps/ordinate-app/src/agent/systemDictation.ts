import type { AgentBridge } from "./contracts";

type DictationBridge = Pick<AgentBridge, "startSystemDictation" | "stopSystemDictation">;

export class SystemDictationSession {
  private started = false;

  constructor(private readonly bridge: DictationBridge) {}

  async start() {
    await this.bridge.startSystemDictation();
    this.started = true;
  }

  async stop() {
    if (!this.started) return;
    await this.bridge.stopSystemDictation();
    this.started = false;
  }
}
