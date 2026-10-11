import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

type Reply = { id: number; result?: unknown; error?: { code: number; message: string } };
type Notice = { method: string; params?: unknown; id?: number };

/** One stdio JSON-RPC connection. No renderer process receives a shell or auth token. */
export class AgentServer {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private nextId = 1;
  private closed = false;
  private readonly ready: Promise<void>;
  onNotification: (method: string, params: unknown) => void = () => {};

  constructor(executable: string, cwd: string, accessToken: string, appVersion: string) {
    if (!accessToken) throw new Error("A ChatGPT access token is required.");
    this.child = spawn(executable, [
      "app-server", "--listen", "stdio://",
      "-c", 'model_provider="openai_chatgpt_plan"',
      "-c", 'model_providers.openai_chatgpt_plan.name="ChatGPT plan"',
      "-c", 'model_providers.openai_chatgpt_plan.base_url="https://api.openai.com/v1"',
      "-c", 'model_providers.openai_chatgpt_plan.env_key="ACCESS_TOKEN"',
      "-c", 'model_providers.openai_chatgpt_plan.wire_api="responses"',
      "-c", "model_providers.openai_chatgpt_plan.requires_openai_auth=false",
      "-c", "model_providers.openai_chatgpt_plan.supports_websockets=false",
    ], {
      cwd, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ACCESS_TOKEN: accessToken, CODEX_DISABLE_UPDATE_CHECK: "1" },
    });
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", line => this.receive(line));
    this.child.on("error", error => this.fail(error));
    this.child.on("exit", (code, signal) => this.fail(new Error(`Codex App Server exited (${signal ?? code}).`)));
    // stderr is diagnostic output, never protocol or user-visible content.
    this.child.stderr.resume();
    this.ready = this.requestRaw("initialize", {
      clientInfo: { name: "ordinate", title: "Ordinate", version: appVersion }, capabilities: null,
    }).then(() => { this.write({ method: "initialized" }); });
  }

  private write(message: object) {
    if (this.closed) throw new Error("Codex App Server is not running.");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private receive(line: string) {
    let value: Reply | Notice;
    try { value = JSON.parse(line) as Reply | Notice; }
    catch { this.fail(new Error("Codex App Server sent invalid JSON.")); return; }
    if (typeof value.id === "number" && "method" in value) {
      // The host has no approval UI. With approvalPolicy=never this is unexpected;
      // explicitly reject rather than silently approve or leave the turn hanging.
      this.write({ id: value.id, error: { code: -32601, message: "Ordinate cannot approve external actions." } });
      return;
    }
    if (typeof value.id === "number") {
      const pending = this.pending.get(value.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(value.id);
      if ("error" in value && value.error) pending.reject(new Error(value.error.message));
      else pending.resolve((value as Reply).result);
      return;
    }
    if ("method" in value) this.onNotification(value.method, value.params);
  }

  private requestRaw(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex App Server did not answer ${method}.`));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  async request<T>(method: string, params: unknown): Promise<T> {
    await this.ready;
    return this.requestRaw(method, params) as Promise<T>;
  }

  private fail(error: Error) {
    if (this.closed) return;
    this.closed = true;
    for (const [, pending] of this.pending) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    this.onNotification("server/disconnected", { message: error.message });
  }

  dispose() {
    this.fail(new Error("Codex App Server closed."));
    this.child.kill();
  }
}
