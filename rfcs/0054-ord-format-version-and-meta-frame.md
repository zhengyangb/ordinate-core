# RFC 0054: ORD format version and metadata frame

Status: Accepted

## File format version

Core's canonical `.ord` serialization begins with a front-matter envelope whose
first content line is the quoted string `ord-format: "0.1"`:

```ord
---
ord-format: "0.1"
---

# Sheet
| 1 | 2 | 3 |
```

This is the **ORD file format** version, not the document revision, App/Core/CLI
package version, or an evaluation-cache version. Core owns the single version
constant. It emits the line on every serialization, including imports, edits,
and evaluation writes. Existing front-matter content is preserved, except for
inserting this first content line when absent. `formatDocument` only formats
source text; it is not a serialization operation and does not add a version.

`0.1` is a string, not a decimal number: a future `0.10` is distinct from
`0.1`. Pre-1.0 incompatible format revisions increment this format version
explicitly; a future reader can then migrate a known old version or reject it.
The current reader rejects malformed, duplicate, misplaced, or unsupported
explicit `ord-format` markers. A versionless document remains valid authoring
input for the current syntax and is stamped `0.1` when Core serializes it.
Other front-matter fields remain opaque as specified by RFC 0040.

## Metadata control frame

The nonsemantic table control frame uses `@meta` in its top-left cell. It is
the one frame for axis metadata: the top row holds column defaults and the
left column holds row defaults. Today those cells contain display format and
style metadata; the frame name does not constrain future metadata kinds.
Neither control axis changes semantic coordinates or formula references.

The former `@display` marker is not a second spelling: it is rejected in the
control position so an old document cannot silently become a different table.
This is a deliberate breaking change in format `0.1`. A literal `@` in the
first semantic header cell is not a control marker. A literal `@meta` in the
first cell remains reserved and needs an explicit literal/escape syntax before
it can be used there as data.

Filter and sort view state, if added later, should be modeled by scope rather
than by stacking more control rows. Per-axis metadata belongs in this frame;
table/view-level metadata needs a table/view-level representation.

## Verification

Test canonical emission and round trips with absent, empty, and existing front
matter; malformed and unsupported versions; marker replacement and rejection;
semantic coordinate stability; and representative CLI/App serialization paths.
