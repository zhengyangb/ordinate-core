# Ordinate Core

The parser, evaluator, and editing library for Ordinate `.ord` workbooks.
It is the same Core used by the Ordinate editor and `ordinate-cli`.

The package exports compiled ESM and TypeScript declarations from `dist/`.
Its public API is exported from `ordinate-core`; no source-repository paths or
TypeScript runtime loader are required by consumers. See the
[repository README](https://github.com/zhengyangb/ordinate-core) for the file
format, examples, and documentation.

The CLI and MCP server are distributed separately as `ordinate-cli`.
