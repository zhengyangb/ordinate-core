import { FORMATS, IMPORT_FORMATS, validateExport, validateImport, type ImportFile, type InterchangeTransport } from "./contracts";

export async function readImportFile(file: Pick<File, "name" | "size" | "arrayBuffer">): Promise<ImportFile> {
  validateImport(file.name, file.size);
  const bytes = new Uint8Array(await file.arrayBuffer());
  validateImport(file.name, bytes.length);
  return { name: file.name, bytes };
}

export function createBrowserInterchange(): InterchangeTransport {
  return {
    pickImport: () => new Promise((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = IMPORT_FORMATS.map(format => `.${format}`).join(",");
      input.hidden = true;
      document.body.append(input);
      input.addEventListener("cancel", () => { input.remove(); resolve(null); }, { once: true });
      input.addEventListener("change", () => {
        const file = input.files?.[0];
        input.remove();
        if (!file) { resolve(null); return; }
        void readImportFile(file).then(resolve, reject);
      }, { once: true });
      input.click();
    }),
    saveExport: async file => {
      validateExport(file);
      const url = URL.createObjectURL(new Blob([file.bytes.slice().buffer], { type: FORMATS[file.format].mime }));
      const link = document.createElement("a");
      link.href = url; link.download = file.name;
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return "downloaded";
    },
  };
}
