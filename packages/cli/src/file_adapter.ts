import * as fs from "node:fs/promises";
import { dirname, basename, resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import type { Readable } from "node:stream";
import { WORKBOOK_LIMITS, type CandidateSource } from "ordinate-core";
export class CliError extends Error {
  constructor(readonly kind: "usage" | "io" | "conflict" | "internal" | "interrupted", readonly code: string, message: string, readonly path?: string) { super(message); }
}
export type WriteState = {
  status: "not_requested" | "not_written" | "written" | "unchanged" | "unknown";
  path: string | null;
  revision: string | null;
};
export type Destination = {
  kind: "inplace";
} | {
  kind: "file";
  path: string;
} | undefined;
function errno(e: unknown): string | undefined { return e instanceof Error && "code" in e ? String(e.code) : undefined; }
function io(e: unknown, code: string, path?: string): never {
  if (e instanceof CliError)
    throw e;
  if (!errno(e))
    throw e;
  throw new CliError("io", code, e instanceof Error ? e.message : String(e), path);
}
export function decodeUtf8(bytes: Uint8Array, path?: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  }
  catch (e) {
    if (e instanceof TypeError)
      throw new CliError("io", "invalid_utf8", "Input is not valid UTF-8.", path);
    throw e;
  }
}
export function checkInterrupted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new CliError("interrupted", "interrupted", "Command interrupted.");
}
export async function readStream(stream: Readable, limit: number, signal?: AbortSignal): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  checkInterrupted(signal);
  const abort = () => stream.destroy(new CliError("interrupted", "interrupted", "Command interrupted."));
  signal?.addEventListener("abort", abort, { once: true });
  try {
    for await (const raw of stream) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      size += chunk.length;
      if (size > limit)
        throw new CliError("usage", "input_limit_exceeded", `Input exceeds ${limit} bytes.`);
      chunks.push(chunk);
    }
  }
  catch (e) {
    io(e, "read_failed");
  }
  finally {
    signal?.removeEventListener("abort", abort);
  }
  return Buffer.concat(chunks, size);
}
export async function readFileLimited(path: string, limit: number): Promise<Buffer> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile())
      throw new CliError("io", "read_failed", "Input must be a regular file.", path);
    if (stat.size > limit)
      throw new CliError("usage", "input_limit_exceeded", `Input exceeds ${limit} bytes.`, path);
    return await readStream(handle.createReadStream({ autoClose: false }), limit);
  }
  catch (e) {
    return io(e, "read_failed", path);
  }
  finally {
    await handle?.close();
  }
}
function sameFile(a: Stats, b: Stats): boolean { return a.dev === b.dev && a.ino === b.ino; }
function uncertainPublication(e: unknown): boolean { return ["EIO", "ESTALE", "ETIMEDOUT"].includes(errno(e) ?? ""); }
/** Shared commit adapter for edit and evaluation; owns only its own lock/temp files. */
export class FileAdapter {
  readonly write: WriteState;
  private lockPath?: string;
  private temporary?: string;
  private snapshot?: Buffer;
  private identity?: Stats;
  private canonicalSource?: string;
  private phase: "initial" | "reading" | "ready" | "publishing" | "closed" = "initial";
  constructor(readonly sourcePath: string | null, readonly destination: Destination, readonly signal?: AbortSignal) {
    this.write = { status: destination ? "not_written" : "not_requested", path: destination?.kind === "inplace" ? sourcePath : destination?.kind === "file" ? resolve(destination.path) : null, revision: null };
    if (destination?.kind === "file" && this.write.path === sourcePath)
      throw new CliError("usage", "invalid_arguments", "Use --write to replace the source file.", sourcePath ?? undefined);
  }
  async read(stdin: Readable): Promise<string> {
    return decodeUtf8(await this.readBytes(stdin, WORKBOOK_LIMITS.sourceBytes), this.sourcePath ?? undefined);
  }
  async readBytes(stdin: Readable, limit: number): Promise<Buffer> {
    if (this.phase !== "initial")
      throw new CliError("internal", "invalid_adapter_state", "Source may only be read once per command.");
    this.phase = "reading";
    checkInterrupted(this.signal);
    if (this.destination?.kind === "inplace") {
      if (!this.sourcePath)
        throw new CliError("usage", "invalid_arguments", "--write requires a source file.");
      try {
        const parent = await fs.realpath(dirname(this.sourcePath));
        this.canonicalSource = join(parent, basename(this.sourcePath));
        const lock = join(parent, `.${basename(this.sourcePath)}.ordinate.lock`);
        let owner: fs.FileHandle;
        try {
          owner = await fs.open(lock, "wx", 0o600);
        }
        catch (e) {
          if (errno(e) === "EEXIST")
            throw new CliError("conflict", "lock_conflict", "Another writer owns this lock; inspect it before removing it.", lock);
          throw e;
        }
        this.lockPath = lock;
        await owner.close();
        const stat = await fs.lstat(this.canonicalSource);
        if (!stat.isFile() || stat.nlink !== 1)
          throw new CliError("io", "unsupported_write_target", "In-place writes require a regular, non-symlink file with one hard link.", this.sourcePath);
        this.identity = stat;
      }
      catch (e) {
        io(e, "read_failed", this.sourcePath);
      }
    }
    this.snapshot = this.sourcePath ? await readFileLimited(this.canonicalSource ?? this.sourcePath, limit) : await readStream(stdin, limit, this.signal);
    checkInterrupted(this.signal);
    this.phase = "ready";
    return this.snapshot;
  }
  private async checkSnapshot(): Promise<void> {
    const path = this.canonicalSource!;
    try {
      const stat = await fs.lstat(path);
      if (!stat.isFile() || stat.nlink !== 1 || !sameFile(stat, this.identity!) || !(await readFileLimited(path, WORKBOOK_LIMITS.sourceBytes)).equals(this.snapshot!))
        throw new CliError("conflict", "write_conflict", "Source changed during the command.", path);
    }
    catch (e) {
      if (errno(e) === "ENOENT")
        throw new CliError("conflict", "write_conflict", "Source disappeared during the command.", path);
      io(e, "read_failed", path);
    }
  }
  async publish(candidate: CandidateSource): Promise<void> {
    if (this.phase !== "ready")
      throw new CliError("internal", "invalid_adapter_state", "Publish requires a successful read and may only be attempted once.");
    this.phase = "publishing";
    checkInterrupted(this.signal);
    if (!this.destination)
      return;
    const inplace = this.destination.kind === "inplace";
    const target = inplace ? this.canonicalSource! : this.write.path!;
    const bytes = Buffer.from(candidate.source, "utf8");
    if (inplace && bytes.equals(this.snapshot!)) {
      await this.checkSnapshot();
      this.write.status = "unchanged";
      this.write.revision = candidate.revision;
      return;
    }
    const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.ordinate.tmp`);
    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(temporary, "wx", 0o600);
      this.temporary = temporary;
      await handle.writeFile(bytes);
      if (inplace)
        await handle.chmod(this.identity!.mode & 0o7777);
      await handle.sync();
      await handle.close();
      handle = undefined;
      if (inplace) {
        await this.checkSnapshot();
        checkInterrupted(this.signal);
        try {
          await fs.rename(temporary, target);
        }
        catch (e) {
          if (uncertainPublication(e))
            this.write.status = "unknown";
          throw e;
        }
        this.temporary = undefined;
      }
      else {
        checkInterrupted(this.signal);
        try {
          await fs.link(temporary, target);
        }
        catch (e) {
          if (uncertainPublication(e))
            this.write.status = "unknown";
          if (errno(e) === "EEXIST")
            throw new CliError("io", "output_exists", "Output already exists; choose a new file.", target);
          throw e;
        }
      }
      this.write.status = "written";
      this.write.revision = candidate.revision;
    }
    catch (e) {
      io(e, "write_failed", target);
    }
    finally {
      await handle?.close();
    }
  }
  async close(): Promise<void> {
    this.phase = "closed";
    let failure: unknown;
    for (const path of [this.temporary, this.lockPath]) {
      if (!path)
        continue;
      try {
        await fs.unlink(path);
      }
      catch (e) {
        if (!failure)
          failure = new CliError("io", "cleanup_failed", e instanceof Error ? e.message : String(e), path);
      }
    }
    this.temporary = undefined;
    this.lockPath = undefined;
    if (failure)
      throw failure;
  }
}
