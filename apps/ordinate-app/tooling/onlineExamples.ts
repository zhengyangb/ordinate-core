import { readFile, readdir } from "node:fs/promises";
import type { Plugin } from "vite";
import catalog from "../../../examples/catalog.json";
import { resolvePresentationFromText } from "../../../packages/core-ts/src/presentation";

/** Build and development use the same authoritative workbooks and preview engine. */
export async function buildExampleAssets() {
  const directory = new URL("../../../examples/", import.meta.url);
  const files = (await readdir(directory)).filter(file => file.endsWith(".ord")).sort();
  if (JSON.stringify(files) !== JSON.stringify(catalog.map(item => item.file).sort())) throw new Error("Example catalog does not match root workbooks");
  if (new Set(catalog.map(item => item.id)).size !== catalog.length) throw new Error("Duplicate example ID");
  const assets = new Map<string, string>();
  const previews = await Promise.all(catalog.map(async item => {
    const source = await readFile(new URL(item.file, directory), "utf8");
    assets.set(`examples/${item.file}`, source);
    const sheets = resolvePresentationFromText(source).sheets;
    const first = sheets[0];
    if (!first) throw new Error(`Empty example: ${item.file}`);
    return {...item, sheets: sheets.length, preview: {
      headers: first.headerDisplayRows.at(-1)?.slice(0, 5) ?? [],
      rows: first.cells.slice(0, 5).map(row => row.slice(0, 5).map(cell => cell.displayText)),
    }};
  }));
  assets.set("examples/catalog.json", JSON.stringify(previews));
  return assets;
}

export function onlineExamples(): Plugin {
  return {
    name: "ordinate-online-examples",
    async configureServer(server) {
      let assets = buildExampleAssets();
      server.watcher.add(new URL("../../../examples/", import.meta.url).pathname);
      server.watcher.on("change", filename => { if (filename.includes("/examples/")) assets = buildExampleAssets(); });
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url!, "http://localhost").pathname;
        const prefix = `${server.config.base}examples/`;
        if (!pathname.startsWith(prefix)) { next(); return; }
        try {
          const name = `examples/${pathname.slice(prefix.length)}`;
          const source = (await assets).get(name);
          if (source === undefined) { response.statusCode = 404; response.end("Example not found"); return; }
          response.setHeader("Content-Type", name.endsWith(".json") ? "application/json" : "text/plain; charset=utf-8");
          response.end(source);
        } catch (error) { next(error as Error); }
      });
    },
    async generateBundle() {
      for (const [fileName, source] of await buildExampleAssets()) this.emitFile({type:"asset", fileName, source});
    },
  };
}
