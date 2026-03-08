# RFC-0000: RFC Process

- Status: Draft
- Project: Ordinate

## Summary

This RFC defines how Ordinate RFCs are written, numbered, discussed, and updated.

## Purpose

RFCs are used to:

- propose design ideas
- record decisions
- expose tradeoffs
- keep open questions visible

RFCs are not assumed to be final when first written.

## Numbering

RFCs use zero-padded numbers:

- RFC-0000
- RFC-0001
- RFC-0002

## Status

Each RFC should have one of these statuses:

- Draft
- Proposed
- Accepted
- Superseded
- Rejected

## Process

Typical flow:

1. write a draft
2. discuss and revise
3. prototype if needed
4. accept, reject, or keep revising

## Revision Policy

Draft RFCs may change freely.

Accepted RFCs should not be silently changed in a way that alters meaning. Large changes should be made in a new RFC or explicit amendment.

## File Format

RFCs are stored as plain-text Markdown files in the repository.

Example:

rfcs/
- 0000-rfc-process.md
- 0001-core-model.md

## Notes

Ordinate RFCs are intended to be practical. They should define what matters now, not pretend to solve everything at once.
