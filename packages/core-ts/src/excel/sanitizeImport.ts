import { ExcelFailure, type ExcelReport } from "./contracts";

export const isExternalDataPart = (name: string): boolean =>
  /^xl\/(?:externalLinks\/|queryTables\/|connections\.xml$)/i.test(name);
export const isExternalDataType = (type: string): boolean => /externalLink|connections|queryTable/i.test(type);
export const isExecutablePart = (name: string): boolean => /(?:vbaProject\.bin|vbaData\.xml|\/(?:activeX|embeddings|ctrlProps|macrosheets)\/)/i.test(name);
export const isExecutableType = (type: string): boolean => /vbaProject|vbaData|oleObject|activeX|ctrlProp|\/control$|macrosheet/i.test(type);
export const isMacroWorkbookType = (type: string): boolean => /^application\/vnd\.ms-excel\.(?:sheet|template)\.macroEnabled\.main\+xml$/i.test(type);

const decodeXml = (data: Uint8Array): string => {
  const encoding = data[0] === 0xff && data[1] === 0xfe || data[0] === 0x3c && data[1] === 0 ? "utf-16le"
    : data[0] === 0xfe && data[1] === 0xff || data[0] === 0 && data[1] === 0x3c ? "utf-16be" : "utf-8";
  return new TextDecoder(encoding, { fatal: true }).decode(data);
};
const relationshipOwner = (name: string): string => name === "_rels/.rels" ? "" : name.replace(/(^|\/)\_rels\//, "$1").replace(/\.rels$/, "");
const resolvePart = (owner: string, target: string): string => {
  const parts: string[] = [];
  for (const part of (target.startsWith("/") ? target.slice(1) : owner.slice(0, owner.lastIndexOf("/") + 1) + target).split("/")) {
    if (part === "..") parts.pop(); else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
};

const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\r/g, "&#13;");
const address = (value: string) => {
  const match = /^([A-Z]+)([1-9]\d*)$/.exec(value);
  if (!match) throw new ExcelFailure("invalid_workbook", "Invalid cell coordinate during import preparation.");
  return { row: Number(match[2]), column: [...match[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) };
};

/** Called only after bounded, streaming validation of every original ZIP/XML part.
 * Produces a detached package for the decoder. Never reads a relationship target.
 * No value/formula coordinates are shifted, and source bytes are not modified. */
export async function sanitizeXlsxImport(
  bytes: Uint8Array,
  dimensions: ReadonlyMap<string, { rows: number; columns: number }>,
  report: ExcelReport,
): Promise<Uint8Array> {
  const { unzipSync, zipSync, strToU8 } = await import("fflate");
  const { SaxesParser } = await import("saxes");
  const files = unzipSync(bytes);
  let externalRemoved = false, trailingRemoved = false, executableRemoved = false;
  const removedParts = new Set(Object.keys(files).filter(name => isExternalDataPart(name) || isExecutablePart(name)));
  const removedIds = new Map<string, Set<string>>();
  const relationships: { owner: string; id: string; type: string; external: boolean; target: string }[] = [];
  // Resolve package relationships before rewriting owners, independent of ZIP order.
  for (const [name, data] of Object.entries(files)) {
    if (!name.endsWith(".rels") && name !== "[Content_Types].xml") continue;
    const owner = relationshipOwner(name), parser = new SaxesParser({ xmlns: false });
    parser.on("opentag", tag => {
      const local = tag.name.split(":").pop();
      if (name === "[Content_Types].xml" && local === "Override") {
        const type = String(tag.attributes.ContentType ?? "");
        if (isExternalDataType(type) || isExecutableType(type)) {
          removedParts.add(String(tag.attributes.PartName).replace(/^\//, ""));
          if (isExecutableType(type)) executableRemoved = true; else externalRemoved = true;
        }
      }
      if (local !== "Relationship") return;
      const attrs = tag.attributes, type = String(attrs.Type ?? "");
      const external = attrs.TargetMode === "External";
      const target = resolvePart(owner, String(attrs.Target ?? ""));
      relationships.push({ owner, id: String(attrs.Id), type, external, target });
      if (!external && (isExternalDataType(type) || isExecutableType(type))) removedParts.add(target);
    });
    parser.write(decodeXml(data)).close();
  }
  for (const { owner, id, type, external, target } of relationships) {
    if (!isExternalDataType(type) && !isExecutableType(type) && !(external && !type.endsWith("/hyperlink")) && !removedParts.has(target)) continue;
    const ids = removedIds.get(owner) ?? new Set<string>();
    ids.add(id); removedIds.set(owner, ids);
    if (isExecutableType(type) || isExecutablePart(target)) executableRemoved = true; else externalRemoved = true;
  }
  for (const [name, data] of Object.entries(files)) {
    if (removedParts.has(name) || (name.endsWith(".rels") && removedParts.has(relationshipOwner(name)))) {
      if (isExecutablePart(name)) executableRemoved = true; else if (isExternalDataPart(name)) externalRemoved = true;
      delete files[name]; continue;
    }
    if (!/\.(?:xml|rels)$/i.test(name)) continue;
    const extent = dimensions.get(name);
    const xml = new SaxesParser({ xmlns: false });
    const output: string[] = [];
    let skip = 0;
    xml.on("doctype", () => { throw new ExcelFailure("unsupported_feature", "XML document types are not supported."); });
    xml.on("opentag", tag => {
      if (skip) { skip++; return; }
      const local = tag.name.split(":").pop();
      const attrs = { ...tag.attributes };
      const type = String(attrs.Type ?? attrs.ContentType ?? "");
      if (local === "Override" && isMacroWorkbookType(type)) {
        attrs.ContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
        executableRemoved = true;
      }
      const ownerIds = removedIds.get(name);
      if ((local === "Relationship" && removedIds.get(relationshipOwner(name))?.has(String(attrs.Id)))
        || (local === "Override" && removedParts.has(String(attrs.PartName).replace(/^\//, "")))
        || (["Relationship", "Override", "Default"].includes(local!) && (isExternalDataType(type) || isExecutableType(type)))
        || Object.entries(attrs).some(([key, value]) => key.includes(":") && /^(id|embed|link)$/.test(key.split(":").pop()!) && ownerIds?.has(String(value)))
        || (name === "xl/workbook.xml" && local === "externalReferences")
        || (extent && local === "queryTableParts")) {
        if (isExecutableType(type)) executableRemoved = true;
        if (isExternalDataType(type) || local === "externalReferences" || local === "queryTableParts") externalRemoved = true;
        skip = 1; return;
      }
      if (extent) {
        if (local === "dimension") { skip = 1; return; } // Decoder derives its range from actual cells.
        if (local === "row" && Number(attrs.r) > extent.rows) { trailingRemoved = true; skip = 1; return; }
        if (local === "c") {
          const at = address(String(attrs.r));
          if (at.row > extent.rows || at.column > extent.columns) { trailingRemoved = true; skip = 1; return; }
        }
        if (local === "col") {
          if (Number(attrs.min) > extent.columns) { trailingRemoved = true; skip = 1; return; }
          if (Number(attrs.max) > extent.columns) { trailingRemoved = true; attrs.max = String(extent.columns); }
        }
        if (local === "mergeCell") {
          const end = address(String(attrs.ref).split(":").at(-1)!);
          if (end.row > extent.rows || end.column > extent.columns) { trailingRemoved = true; skip = 1; return; }
        }
      }
      output.push(`<${tag.name}${Object.entries(attrs).map(([key, value]) => ` ${key}="${escapeXml(String(value))}"`).join("")}>`);
    });
    xml.on("closetag", tag => { if (skip) skip--; else output.push(`</${tag.name}>`); });
    xml.on("text", value => { if (!skip) output.push(escapeXml(value)); });
    xml.on("cdata", value => { if (!skip) output.push(escapeXml(value)); });
    xml.write(decodeXml(data)).close();
    files[name] = strToU8(output.join(""));
  }
  if (externalRemoved) report.warn("external_content_removed", "External connections and linked content are removed. No external source is accessed or refreshed.");
  if (executableRemoved) report.warn("import_content_omitted", "Macros, embedded objects and controls are removed, not preserved in the imported document. No code is executed.");
  if (trailingRemoved) report.warn("import_content_omitted", "Trailing empty formatting and merge extents are omitted; cells with values or formulas keep their coordinates.");
  return zipSync(files);
}
