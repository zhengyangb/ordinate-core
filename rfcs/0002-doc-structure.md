# RFC-0002: Document Structure and Header Marking

- Status: Draft
- Project: Ordinate

## Summary

This RFC defines the basic plain-text structure of an Ordinate document and the first concrete rules for marking Header Rows and Header Columns.

Ordinate should look familiar to people who already read Markdown tables.

## Goals

This RFC defines:

- how sheets are separated
- how basic tables are written
- how Header Rows are marked
- how Header Columns are marked
- how simple multi-level headers are represented

## Non-Goals

This RFC does not define:

- formula syntax
- reference syntax
- section semantics
- evaluation rules
- caching or recalculation

## Sheet Structure

RFC-0040 allows an optional opaque YAML front-matter block before the first
sheet. Its contents are excluded from sheet and table parsing.

A sheet begins with a level-1 heading.

Example:

```md
# Revenue
| Item || Jan | Feb |
| ---- || --- | --- |
| Cash || 10  | 12  |

# Costs
| Item || Jan |
| ---- || --- |
| Rent || 5   |
```

Current rule:



- \# starts a new sheet
- content belongs to that sheet until the next # or end of file
- each sheet must contain exactly one table

## **Basic Table Form**

A table uses a pipe-based plain-text form.

Example:

```
| A | B | C |
| 1 | 2 | 3 |
| 4 | 5 | 6 |
```

A table is rectangular. Each row must have the same logical number of cells.

Blank cells are allowed.

Example:

```
| A | B | C |
| 1 |   | 3 |
|   | 5 | 6 |
```

## **Header Rows**

Header Rows are marked using a separator row, similar to Markdown table syntax.

Example:

```
| Item | Jan | Feb |
| ---- | --- | --- |
| Cash | 10  | 12  |
| Debt | 5   | 6   |
```

Rule:

- if a separator row exists
- then the rows immediately above it are Header Rows
- the rows below it are body rows

### **Multi-level Header Rows**

Multiple rows above the separator row are allowed.

Example:

```
|      | Expense | Expense | Revenue |
| Item | COGS    | D&A     | Sales   |
| ---- | ------- | ------- | ------- |
| Cash | 10      | 2       | 30      |
```

Current rule:

- all consecutive rows above the separator row are Header Rows
- detailed semantics of multi-level headers are deferred to a later RFC

## **Header Columns**

Header Columns are marked using || as a boundary marker.

Example:

```
| Item || Jan | Feb |
| Cash || 10  | 12  |
| Debt || 5   | 6   |
```

Rule:

- || divides each row into two regions
- columns to the left of || are Header Columns
- columns to the right of || are data columns

### **Header Row and Header Column Together**

Example:

```
| Item || Jan | Feb |
| ---- || --- | --- |
| Cash || 10  | 12  |
| Debt || 5   | 6   |
```

This table has:

- one Header Row
- one Header Column

### **Multiple Header Columns**

Example:

```
| Category | Item || Jan | Feb |
| Assets   | Cash || 10  | 12  |
| Assets   | Debt || 5   | 6   |
```

This table has:

- two Header Columns
- no Header Row

### **Multi-level Header Rows with Header Columns**

Example:

```
|          || Expense | Expense | Revenue |
| Item     || COGS    | D&A     | Sales   |
| -------- || ------- | ------- | ------- |
| Cash     || 10      | 2       | 30      |
| Inventory|| 20      | 3       | 40      |
```

This table has:

- two Header Rows
- one Header Column

## **Consistency Rules**

Current working assumptions:



- if || appears in one row of a table, it must appear in all rows of that table
- || must appear at the same logical boundary in all rows
- a separator row, if present, must match the same column structure as the rest of the table

## **Notes**

This RFC only defines document shape and header marking.

It does not yet define:

- whether Header Rows create referenceable column names
- whether Header Columns create referenceable row names
- how multi-level headers become paths
- how Sections are represented


Those questions are left to later RFCs.

## **Cell Wire Escaping**

`.ord` is pipe-delimited at the table layer, so cell text is serialized with table-layer escaping.

Current rule:

- literal `|` in cell text is serialized as `\|`
- literal `\` in cell text is serialized as `\\`
- parser decodes `\| -> |` and `\\ -> \` when reading table rows
- unknown backslash sequences are preserved literally
- dangling trailing `\` in a row is invalid

This escaping is a table-wire concern. It is separate from formula/literal semantics inside a cell.

## **Open Questions**


- should prose be allowed around the table inside a sheet
- should || be the final Header Column marker
- how strict should Markdown compatibility be
