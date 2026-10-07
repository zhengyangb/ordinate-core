import { randomUUID } from "node:crypto";
import { open, realpath, rename, unlink, stat, access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { validateExport, validateImport, type ExportFile, type InterchangeTransport } from "../src/interchange/contracts.js";

export function createNativeInterchange(dialogs: {
  open(): Promise<string | null>;
  save(file: Pick<ExportFile, "name" | "format">): Promise<string | null>;
  checkDestination(filename: string): Promise<void>;
}): InterchangeTransport {
  return {
    pickImport: async () => {
      const filename = await dialogs.open();
      if (filename === null) return null;
      const name = path.basename(filename);
      const handle = await open(filename, "r");
      try {
        const info = await handle.stat();
        if (!info.isFile()) throw new Error("Choose a file, not a folder.");
        validateImport(name, info.size);
        // Read at most the observed size + 1: a concurrently growing file must
        // not bypass preflight and allocate an unbounded renderer IPC payload.
        const buffer = new Uint8Array(info.size + 1);
        let count = 0;
        while (count < buffer.length) {
          const next = await handle.read(buffer, count, buffer.length - count, count);
          if (!next.bytesRead) break;
          count += next.bytesRead;
        }
        if (count !== info.size) throw new Error("The file changed while it was being read. Try importing again.");
        return { name, bytes: buffer.slice(0, count) };
      } finally { await handle.close(); }
    },
    saveExport: async file => {
      validateExport(file);
      const selected = await dialogs.save({ name: file.name, format: file.format });
      if (selected === null) return null;
      if (path.extname(selected).toLowerCase() !== `.${file.format}`) throw new Error(`Choose a .${file.format} filename.`);
      let destination: string;
      try { destination = await realpath(selected); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        destination = path.join(await realpath(path.dirname(selected)), path.basename(selected));
      }
      await dialogs.checkDestination(destination);
      let mode = 0o600;
      try { mode = (await stat(destination)).mode & 0o777; await access(destination, constants.W_OK); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${randomUUID()}.tmp`);
      const handle = await open(temporary, "wx", mode);
      let committed = false;
      try {
        try { await handle.writeFile(file.bytes); await handle.sync(); }
        finally { await handle.close(); }
        await dialogs.checkDestination(destination);
        await rename(temporary, destination);
        committed = true;
        return "saved";
      } finally { if (!committed) await unlink(temporary); }
    },
  };
}
