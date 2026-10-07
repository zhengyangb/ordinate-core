/** RFC-0043. Restricted Markdown is document content, never executable input. */
export type SheetNotePosition = "beforeTable" | "afterTable";
export type NoteInline =
  | { kind: "text"; text: string }
  | { kind: "strong" | "emphasis"; children: NoteInline[] };
export type NoteBlock =
  | { kind: "paragraph"; children: NoteInline[] }
  | { kind: "rule" }
  | { kind: "list"; items: NoteInline[][] }
  | { kind: "orderedList"; start: number; items: NoteInline[][] };
export interface SheetNote { blocks: NoteBlock[] }
export interface NoteSourceBlock { kind: "note"; note: SheetNote }
export interface NoteDiagnostic { code: "invalid_sheet_note"; message: string; line: number }
export class SheetNoteError extends Error {
  readonly code = "invalid_sheet_note";
  constructor(message: string, readonly line = 1) { super(message); this.name = "SheetNoteError"; }
}

export function assertNotePosition(position: string): asserts position is SheetNotePosition {
  if (position !== "beforeTable" && position !== "afterTable") throw new SheetNoteError("Expected beforeTable or afterTable.");
}

const punctuation = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;
const listMarkerPattern = String.raw`(?:[-+*]|\d{1,9}[.)])`;
const listItemPattern = new RegExp(String.raw`^(${listMarkerPattern})([ \t]{1,4})(\S.*)?$`);
const unsupportedListPattern = new RegExp(String.raw`^${listMarkerPattern}(?:\s|$)`);
const noteRulePattern = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})$/;

/** Shared parser/editor grammar, including an empty item while it is being typed. */
export function matchNoteListItem(line: string) {
  if (noteRulePattern.test(line)) return null;
  const match = listItemPattern.exec(line);
  return match ? { marker: match[1], spacing: match[2], content: match[3] ?? "" } : null;
}
/** Syntax can become inert text in the note editor; data/structure errors cannot. */
class NoteSyntaxError extends SheetNoteError {}
function parseInline(source: string, line: number, literal: boolean): NoteInline[] {
  let cursor = 0;
  const fail = (message: string): never => { throw new NoteSyntaxError(message, line); };
  function sequence(closing: string | null, marks: string[]): NoteInline[] {
    const nodes: NoteInline[] = [];
    const text = (value: string) => {
      const last = nodes.at(-1);
      if (last?.kind === "text") last.text += value; else nodes.push({ kind: "text", text: value });
    };
    while (cursor < source.length) {
      if (closing && source.startsWith(closing, cursor) && !(closing === "*" && source.startsWith("**", cursor) && !source.startsWith("***", cursor) && !marks.includes("**"))) {
        if (!nodes.length || /\s/.test(source[cursor - 1])) fail("Emphasis must contain text without surrounding whitespace.");
        cursor += closing.length;
        return nodes;
      }
      const char = source[cursor];
      if (char === "\\") {
        const next = source[++cursor];
        if (!next || !punctuation.test(next)) fail("Backslash must escape punctuation.");
        text(next); cursor++; continue;
      }
      if (char === "*") {
        const mark = source.startsWith("**", cursor) ? "**" : "*";
        if (marks.includes(mark)) fail("Repeated or overlapping emphasis is not supported.");
        cursor += mark.length;
        if (cursor === source.length || /\s/.test(source[cursor])) fail("Emphasis must contain text without surrounding whitespace.");
        nodes.push({ kind: mark === "**" ? "strong" : "emphasis", children: sequence(mark, [...marks, mark]) });
        continue;
      }
      if (/[`<>\[\]]/.test(char) || source.startsWith("~~", cursor)) fail("Only bold and italic are supported within note text; escape literal Markdown punctuation.");
      if (char === "_" && (!/\w/.test(source[cursor - 1] ?? "") || !/\w/.test(source[cursor + 1] ?? ""))) fail("Use * for italic, or escape a literal underscore.");
      text(char); cursor++;
    }
    if (closing) fail("Unclosed emphasis in sheet note.");
    return nodes;
  }
  try { return sequence(null, []); }
  catch (error) {
    if (!literal || !(error instanceof NoteSyntaxError)) throw error;
    return [{ kind: "text", text: source }];
  }
}

export function parseSheetNote(markdown: string, options: { unsupportedSyntax: "reject" | "literal" } = { unsupportedSyntax: "reject" }): SheetNote {
  if (typeof markdown !== "string") throw new SheetNoteError("Note Markdown must be a string.");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(markdown)) throw new SheetNoteError("Control characters are not supported in notes.");
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n"), blocks: NoteBlock[] = [];
  const literal = options.unsupportedSyntax === "literal";
  let paragraph: string[] = [], paragraphLine = 1;
  let list: Extract<NoteBlock, { kind: "list" | "orderedList" }> | null = null;
  let listMarker: string | null = null;
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", children: parseInline(paragraph.join(" "), paragraphLine, literal) });
    paragraph = [];
  };
  lines.forEach((raw, index) => {
    const line = index + 1;
    if (!raw.trim()) { flush(); list = null; return; }
    const text = raw.trimEnd();
    // All thematic separators have one meaning. A renderer may use their
    // boundaries for columns, but available width never changes document AST.
    // Rule precedence also prevents * * * from becoming a bullet/emphasis.
    if (noteRulePattern.test(text)) {
      flush(); list = null; blocks.push({ kind: "rule" }); return;
    }
    const item = matchNoteListItem(text);
    const indented = /^\s/.test(raw), hardBreak = / {2,}$/.test(raw);
    const unsupported = /^(?:#{1,6}(?:\s|$)|>|\|)/.test(text) || (unsupportedListPattern.test(text) && !item);
    if (indented || hardBreak || unsupported) {
      if (!literal) throw new NoteSyntaxError(indented || hardBreak
        ? "Indented blocks and hard line breaks are not supported."
        : "Unsupported note block; list items require a nonempty single line. Escape literal structural punctuation.", line);
      // Plain prose uses normal paragraph whitespace, not code/list indentation.
      // Preserve literal punctuation; serialization escapes structural prefixes.
      flush(); list = null;
      blocks.push({ kind: "paragraph", children: [{ kind: "text", text: raw.trim() }] });
      return;
    }
    if (item) {
      flush();
      const ordered = /^\d/.test(item.marker);
      const marker = ordered ? item.marker.at(-1)! : item.marker;
      if (!list || listMarker !== marker) {
        list = ordered ? { kind: "orderedList", start: Number(item.marker.slice(0, -1)), items: [] } : { kind: "list", items: [] };
        listMarker = marker;
        blocks.push(list);
      }
      list.items.push(parseInline(item.content, line, literal));
    } else {
      if (list) {
        if (!literal) throw new NoteSyntaxError("Separate a paragraph from a list with a blank line.", line);
        list = null;
      }
      if (!paragraph.length) paragraphLine = line;
      paragraph.push(text);
    }
  });
  flush();
  return { blocks };
}

function renderInline(nodes: NoteInline[], marks: string[] = []): string {
  if (!Array.isArray(nodes) || !nodes.length) throw new SheetNoteError("Note inline content must be nonempty.");
  return nodes.map(node => {
    if (node.kind === "text") {
      if (typeof node.text !== "string" || !node.text.length || /[\r\n\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(node.text)) throw new SheetNoteError("Note text must be a nonempty single line without control characters.");
      return node.text.replace(/[\\*_`<>\[\]~|#]/g, "\\$&");
    }
    if (node.kind !== "strong" && node.kind !== "emphasis") throw new SheetNoteError("Unsupported inline note kind.");
    if (marks.includes(node.kind)) throw new SheetNoteError("Repeated emphasis is not supported.");
    const mark = node.kind === "strong" ? "**" : "*";
    const content = renderInline(node.children, [...marks, node.kind]);
    if (content.trim() !== content) throw new SheetNoteError("Emphasis cannot have surrounding whitespace.");
    return `${mark}${content}${mark}`;
  }).join("");
}

export function serializeSheetNote(note: SheetNote): string {
  if (!note || !Array.isArray(note.blocks)) throw new SheetNoteError("Expected structured note blocks.");
  const line = (children: NoteInline[]) => {
    const content = renderInline(children);
    if (content.trim() !== content || !content) throw new SheetNoteError("Note lines cannot have surrounding whitespace.");
    return content;
  };
  return note.blocks.map(block => {
    if (block.kind === "paragraph") return line(block.children).replace(/^([-+](?:\s|$)|-{3,}$|\d+([.)])(?:\s|$))/, (match, _prefix, dot) => dot ? match.replace(dot, `\\${dot}`) : `\\${match}`);
    if (block.kind === "rule") return "---";
    if ((block.kind !== "list" && block.kind !== "orderedList") || !Array.isArray(block.items) || !block.items.length) throw new SheetNoteError("Expected a paragraph, rule or nonempty list.");
    if (block.kind === "orderedList" && (!Number.isInteger(block.start) || block.start < 0 || block.start > 999999999)) throw new SheetNoteError("An ordered list start must be a nonnegative number of at most nine digits.");
    // Markdown ignores subsequent source numbers. Repeat the start marker so
    // canonical source stays within the grammar even at its nine-digit limit.
    const marker = block.kind === "orderedList" ? `${block.start}.` : "-";
    return block.items.map(item => `${marker} ${line(item)}`).join("\n");
  }).join("\n\n");
}

export function noteBlockLines(block: NoteSourceBlock): string[] {
  return ["", ...serializeSheetNote(block.note).split("\n"), ""];
}
