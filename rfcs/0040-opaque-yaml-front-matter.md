# RFC-0040: Opaque YAML Front Matter

- Status: Draft (TypeScript implemented; format marker specified by RFC 0054)
- Extends: RFC-0002 and RFC-0011

## Purpose

An `.ord` document may begin with YAML front matter. This reserves an envelope
for document metadata and lets readers open and edit files that carry that
envelope. This RFC does not define individual fields; RFC 0054 reserves the
first content line for `ord-format`.

```text
---
future-key: any value
---

# Sheet
| Item || Value |
| ---- || ----- |
| Cash || 10    |
```

## Envelope syntax

- There is at most one front-matter block, at the beginning of the file, before
  any sheets. An optional leading UTF-8 BOM is accepted and omitted on output.
- The first line is `---`, in column zero. Trailing spaces/tabs are allowed.
  Leading whitespace or blank lines do not introduce front matter.
- The block ends at the next column-zero line containing only `---` or `...`,
  with optional trailing spaces/tabs. Indented delimiters do not end it.
- The block may be empty. LF and CRLF are supported.
- An opening delimiter without a closing delimiter is a document parse error
  with code `front_matter_unterminated`. Parsing stops; it does not attempt to
  recover sheets from inside the unterminated block.
- Only a file-leading block receives this interpretation. Delimiter lines
  inside an ordinary sheet retain their existing sheet-block behavior.
- The envelope alone is not a valid Ordinate document: the existing sheet and
  table requirements still apply to the body.

## Opaque contents

Apart from the RFC 0054 format marker, contents are not parsed as YAML. They are not used for
validation, evaluation, references, formatting defaults, or editing behavior.
Unknown fields, YAML comments, nested structures, tags, anchors, and text that
resembles Ordinate headings or tables are preserved without interpretation.
Even a payload that would fail a YAML parser is opaque to this reader.

In particular, a field named `version` has no special meaning. The first-line
`ord-format` field has the exact syntax and compatibility behavior of RFC 0054.
No YAML library,
object construction, tag resolution, or external resource loading is involved.
Future RFCs may define YAML validation and the meaning of specific fields.

## Model and round trip

`ParsedDocument`, `DocumentIR`, and `DocumentState` have a document-level
`frontMatter: string | null`. The string is the complete original block,
including its delimiters, but excluding the closing line's line ending and the
optional file BOM. `null` means absent; an empty block remains present.

Formatting preserves the block verbatim. Serialization preserves its other
contents but inserts the canonical `ord-format` first content line if absent.
This includes internal
line endings, indentation, comments, trailing spaces, and closing delimiter.
When a body follows, canonical output places one blank LF line between the block
and the first sheet. Normal canonical formatting applies only to the body.
Formatting must be idempotent. Saving after edits, evaluation, undo, redo, or
sheet lifecycle operations must retain the other front-matter contents. Files
without front matter gain the RFC 0054 envelope when Core serializes them.

Front-matter editing is not a new core edit operation or dedicated UI control.
An existing whole-source editor may change it by reparsing the document.

## Verification

Contract tests cover opaque headings/tables within the block; nested and
multiline YAML-shaped contents; both closing markers; empty/absent blocks;
BOM and CRLF; unterminated blocks; existing body validation; format/serialize
idempotence; evaluation isolation; and preservation through edit/undo/redo.
