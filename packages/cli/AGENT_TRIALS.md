# Fresh-context agent trials

Date: 2026-10-08. Model: `gpt-6-luna`. Three separately spawned agents with no
parent conversation, project implementation/RFC reading, or Ordinate skill.
Each received one disposable workbook, a business task, and the CLI executable
path. CLI help and direct source editing were allowed; no payload or coordinate
instructions were supplied. Changes were independently inspected and evaluated
by the parent after the agents finished, rather than trusting their summaries.

These are lightweight development observations, not an automated evaluation,
success-rate claim, or model comparison. Fixtures/results stayed in temporary
directories; production examples were not modified. The table records observed
choices, not methods agents were required to use.

| Task | Observed method | Independently verified result |
| --- | --- | --- |
| Change Q1 revenue/costs and an approval note | Help, direct text patch, CLI validate/evaluate | Revenue 150, costs 45, formula profit 105; Q2 unchanged |
| Add Q3 from Q2 with formulas/formats; duplicate Profit as Forecast check | Inspect, CLI duplicate columns/rows and cell edits, validate/evaluate/inspect | Profit/check 60, 70, 110; Q3 inherited Q2 numeric format; translated formulas and original quarters retained |
| Complete four-quarter forecast and percentage margin | Inspect, direct table/text edits, CLI local format batch, validate/evaluate/inspect | Revenue 100/120/140/160; profit 60/70/80/90; formula margins 60.0/58.3/57.1/56.3%; bold profit, monetary formats, and assumption note retained |

## What we learned

- CLI help was enough to discover the structural edit payloads in the second task.
  The operation schemas/types/decoder/help have one source of truth.
- Direct editing is useful, not a test failure. Agents naturally chose it for
  small textual changes and bulk formula authoring, while using structured edits
  for copies and display metadata. None was forced into a tool-only workflow.
- The forecast agent initially attempted a second metadata control row for row
  percentage formatting. Validation rejected it because that control row requires
  metadata-only cells. The agent recovered using four local format operations.
  Correctness was preserved, but format grammar/defaults need clearer guidance.
- Following that observation, operation help descriptions now explain percentage
  ratio formats, temporal patterns, row defaults, and omitted/null style axes.
  A broad task can still choose text instead of `fill_region`; separate deterministic
  Core/CLI tests verify fill's copy/auto/series behavior. These trials do not prove
  agents will consistently choose fill or the most compact operation sequence.
- A skill is not required to run these commands. A future short authoring skill
  could improve native syntax, named/current references, and format/default choices.
  It should link to tested help/reference material, not duplicate the operation
  schema or make agents believe cached values prove correctness. No skill or
  embedded-agent integration was added in this milestone.

## Repeating manually

Use independent temporary copies. The seed was a Plan sheet with Item as its
label column, Revenue/Costs/Profit rows, Q1 revenue/costs 100/40, Q2 120/50, and
profit formulas `= B2 - B3` and `= C2 - C3`. The structural seed applied a `.2f`
numeric column default and bold Profit row. The forecast seed additionally had
blank Q3/Q4 columns with the same monetary defaults. Notes described a fictional
Acme Manufacturing quarterly plan and said Draft for review.

Give only the requested outcome, workbook path, executable path, and permission
to discover help or edit text. Afterwards independently check inputs, formulas,
styles/defaults, unaffected data, validation, and recomputed values. Record failed
attempts and recoveries as well as final success. A fresh session matters; reusing
the agent that developed the interface would not test discoverability.

## 2026-10-09: multi-step authoring and skill/help comparison

### Protocol

Fourteen fresh `gpt-6-luna` agents ran ten task types: ten with the authoring
skill and four matching CLI-help-only controls. Each agent was spawned with
`fork_turns: none`, a separate original workbook, a business outcome, and the
CLI entrypoint. Controls could query the same language/function/operation help
but were explicitly told not to read skill files. No agent received parent
conversation, implementation/RFC access, expected results, operation payloads,
formula solutions, or assistance after an error. Direct text editing and
structured editing were both allowed. Required output names were supplied to
make independent review unambiguous; method and formula choices were not.

The first fourteen runs used the same skill entrypoint, SHA-256
`0ccc91463f13ecd3d183c0d0647bf3730e8b2b934a0b2bc6ac46531d3ff723d4`.
The baseline skill and CLI bundle were copied before later documentation changes.
A transparent CLI launcher recorded every invocation's arguments, exit status,
and operation names. Consequently the call counts below are observed CLI
process counts, not agents' estimates. They include help, inspection, probes,
validation and evaluation, not just edits. Nonzero calls include failed discovery
and authoring attempts; the atomicity task deliberately requests one failure.
File-edit choices come from agent reports plus the resulting sources and CLI
traces; direct text patch counts and complete tool-call transcripts were not
instrumented. Agents could retry within their turn.

### Main results

All fourteen final submissions passed independent checks. This means eventual
completion of these particular tasks, not error-free first attempts or a
general agent success rate.

| Task with skill | Multi-step requirements | CLI calls | Nonzero calls | Observed authoring method |
| --- | --- | ---: | ---: | --- |
| Closing accounts | Income statement, cash/retained-earnings roll-forward, full balance sheet, real balance check | 13 | 3 | Text |
| Six-month cash plan | Base/downside forecasts, monthly cash roll-forward, comparative summary | 10 | 2 | Text |
| Loan amortization | 12 periods, native payment function, interest/principal/balance roll-forward | 21 | 4 | Text; CLI input probes |
| Sales ledger | 12 orders, catalog lookup, discount/cost/profit, status/SKU filtering | 15 | 5 | Text |
| Structural revision | Insert middle row, rename, duplicate/move column, duplicate row, margins, preserve cross-sheet positional target | 33 | 2 | Structured CLI |
| Inventory | Eight SKUs, nonnegative shortage, order cost and count, central assumptions | 22 | 6 | Text; CLI input probes |
| Service invoices | Eight sessions, native durations, fractional/overnight hours, billable/client summaries | 22 | 2 | Text |
| Department review | Hierarchy and duplicated labels, 36 linked actual cells, department/company variance | 31 | 6 | Text; CLI input probes |
| Monthly extension | Arithmetic series, copied formulas, margins, totals, no cross-month leakage | 11 | 0 | Text; did not choose `fill_region` |
| Atomic workflow | Invalid writing batch, unchanged source hash, valid batch, explicit cache refresh | 15 | 1 expected | Structured CLI |

The structural agents discovered `insert_row`, `duplicate_columns`,
`move_columns`, `duplicate_rows`, cell edits, and display-default operations.
The atomic agent's missing-row batch returned code 5 with identical pre/post
file hashes; the valid batch committed and `evaluate --write` materialized
the correct 105/70 profit caches. No parent fixed an agent's submission.

### Matched help-only controls

| Same task | Skill CLI calls / nonzero | Help-only CLI calls / nonzero | Independent final result |
| --- | ---: | ---: | --- |
| Closing accounts | 13 / 3 | 30 / 1 | Both pass |
| Sales ledger | 15 / 5 | 25 / 3 | Both pass |
| Structural revision | 33 / 2 | 39 / 2 | Both pass |
| Service invoices | 22 / 2 | 21 / 2 | Both pass |

For these four matched tasks, skill runs made 83 CLI calls versus 115 for
controls, and 22 help calls versus 49. However their nonzero calls were 12
versus 8: the skill did not demonstrate fewer errors. One sample per condition,
stochastic agents, different editing/checking choices, and non-equivalent
instruction-reading costs prevent interpreting this as a reliable speed,
token-efficiency, or success-rate improvement. Help-only discovery remained
capable, including the structural task. The skill is complementary context,
not a required tool gateway or a substitute for validation.

### Independent verification and grader sensitivity

The parent revalidated and reevaluated every sheet, then recomputed expected
business values in a separate JavaScript grader (including an independent
annuity calculation and UTC timestamp differences). Derived values had to
remain formulas. Disposable copies were changed and reevaluated without
touching submitted files. Checks covered revenue/dividends, an intentionally
unbalanced asset input, fixed costs/growth, principal/rate, price/status,
Q2 changes after column movement, lead time/receipts, hourly rate/billability,
duplicated-label department inputs/uplift, and a March-only change. The main
round contains 1,568 assertions, including repeated checks across input
variants and composite checks; these are not 1,568 independent agent samples.

Two deliberately corrupted copies established that the grader rejected a
constant `= 0` balance check and a constant `= 160` cash formula even though
both looked correct at baseline. A third copy with poisoned cached results
still passed recomputation, as intended: stored caches were not accepted as
evidence of correctness. Display checks were limited to metadata presence and
selected explicit overrides/defaults; this was not a visual layout, Excel
interoperability, accounting-standard, concurrency, or large-workbook test.

### Findings and changes

Most broad authoring was direct text editing, with the CLI used to discover,
check, format, or probe inputs. Structural target preservation and explicit
transaction testing used structured operations. This supports keeping both
paths available, rather than requiring per-cell tool calls. It does not prove
that a tool is better for every task: the monthly-extension agent authored
the sequence directly instead of choosing the existing fill operation.

Repeated recoverable mistakes involved swapped reference axes, unquoted or
single-quoted labels/sheet names, metadata-frame syntax, and Excel-style
`max(0, amount)` instead of native `max([0, amount])`. One agent also guessed
an insertion gap incorrectly and repaired it. After the frozen main round,
the skill and shared CLI reference were clarified with horizontal-versus-vertical
reference examples, explicit double-quote guidance, a complete same-row ledger,
and the single-view min/max convention. Generated skill references were synced.
All 59 CLI/authoring tests passed, including executable reference examples.
The bundled Python skill validator could not run because PyYAML was unavailable;
YAML front matter was separately parsed with Ruby and package-specific checks
passed. No claim of Python-validator success is made.

Raw tasks, originals, results, CLI traces, grader, baseline snapshot, and
negative controls remain under `/private/tmp/ordinate-agent-trials-M3pbJ8`.
These are deliberately unversioned development artifacts; production examples
and Core runtime were not modified. Only documentation/reference examples and
their existing executable-example tests changed in the repository. Nothing
was committed, published, globally installed, or installed into an agent host.

### Post-clarification cold-context checks

Two additional fresh Luna agents repeated the sales and inventory tasks with
the revised skill (entrypoint SHA-256
`38f56051af63d3ec26216581b8145270d223df40ed6f76e86f4917347d5e9ab6`).
These were separate follow-ups, not part of the frozen four-pair comparison.

| Task | First turn's final submission | Final independent checks | CLI calls / nonzero |
| --- | --- | --- | ---: |
| Inventory | Pass, after recovering from selector/help errors | 62/62 pass | 27 / 3 |
| Sales | Fail: delivered invalid unquoted SKU references before completing checks | 157/157 pass after one continuation | 17 / 6 including continuation |

The sales agent initially blamed cross-sheet selections, then identified
unquoted labels such as `AC-1` but stopped with invalid source. The parent
preserved that failed workbook, six-call trace (four nonzero), and failed
grade as `first-turn-*` artifacts. It received only a request to continue
independently using its existing resources, with no syntax solution or payload.
On continuation it switched to live positional catalog references in lookup
arrays, completed the summaries, checked price/status changes, and restored
the inputs. The parent did not edit its workbook. Both final files passed
independent baseline and mutation checks, but the stopped first turn remains
a failure; it is not reclassified as successful autonomous completion.

Across all sixteen fresh-context runs, fifteen agents delivered a passing file
within their initial working turn (which could contain retries); one required
that continuation. Eventually all sixteen submitted files passed the specified
checks. Recorded totals are 352 CLI invocations, 48 nonzero invocations (one
deliberate atomic rejection), and 1,787 correlated grader assertions. These
figures do not establish a general success probability, demonstrate that the
revision improved reliability, or imply first-attempt correctness.

The defensible conclusion is that text plus CLI can produce these multi-step
models and that fail-early validation/evaluation catches important mistakes.
The agent cannot yet be trusted to always follow a completion gate on its own.
A future agent host should enforce successful validation, whole-workbook
evaluation, and task-specific invariants before accepting a result, rather than
trusting a completion message or cached values. That host was not implemented
as part of these trials.

## 2026-10-09: three sequential first-draft rounds

The user requested three rounds of complete-workbook generation, first-check
observation, and narrowly justified skill iteration, with a review before any
backtracking. Three new agents used `fork_turns: none` and the inherited default
model (no model override); these are not additional matched Luna samples from
the earlier comparison. Each read a frozen copy of the authoring skill, could
discover CLI help, and wrote a complete workbook before checking any source.
They were forbidden to repair the draft after checking. No parent syntax
solutions were supplied to the agents. A transparent wrapper recorded CLI calls
and saved the first validation result plus the exact first-draft bytes/hash.
Parent rechecks and diagnostic copies were separate from first-attempt results.

| Round | Workbook | Body rows / formulas | First validate | First evaluate | Skill change after the round |
| --- | --- | ---: | --- | --- | --- |
| 1 | Three-year operating/cash forecast, 4 sheets | 60 / 87 | Pass, exit 0 | Fail, exit 4; 60 unresolved-reference errors | Explain literal header text and complete multirow column paths |
| 2 | Catalog, 24 orders, purchasing plan and review, 4 sheets | 61 / 186 | Pass, exit 0 | Pass, exit 0; no errors | None; do not add rules without a demonstrated issue |
| 3 | 24 timed sessions, invoices and capacity plan, 4 sheets | 73 / 300 | Pass, exit 0 | Fail, exit 4; 110 errors | Explain independent range endpoints, view/scalar comparisons, and native elapsed-duration arithmetic |

Round 1 placed quotes in the actual year headers and referred to parent years
instead of full year/Forecast paths. Header quotes are literal name characters;
multirow headers require full paths or a unique leaf, not the parent alone.
The skill received four explanatory lines and the shared reference an executable
example. In an in-memory diagnostic copy, fixing only those two conventions
removed every evaluation error; sampled financial results matched independent
arithmetic. This was not an agent recovery and did not change the scored draft.

Round 2 used full month/Base paths successfully. Independent arithmetic checked
catalog lookup costs, open-order reservations, buffers, nonnegative buys,
projected stock, monthly costs and selected summaries. Two in-memory variations
changed a product cost and an order status; all 426 correlated assertions across
three cases passed. This was neither a visual audit nor a broad business audit.

Round 3 had 24 invalid duration calls (total seconds passed as the seconds
component), 50 view-comparison errors (including dependent errors), and 36
unresolved-label errors from abbreviated hierarchical range endpoints. Minimal
reproductions confirmed the existing runtime contracts. The skill received
short general explanations, not client-specific formulas. The duration seconds
parameter description was clarified in Core's function metadata to state its
existing [0, 60) component limit; generated help/skill references were synced.
No evaluator behavior, view broadcasting, or duration API was changed. Applying
only these three corrections to an in-memory diagnostic copy removed all 110
errors; 144 independent arithmetic/type assertions covered session hours, fees,
nonbillable labor costs, invoice tax and remaining budgets. Again, this was not
an agent recovery. The original file remains a failed first evaluation.

Skill entrypoint SHA-256 checkpoints:

- Round 1: `5489c7df6fd548f8d4ac7576a41678a580b10c3c5c15f31f2e70e73d9177ec9f`.
- Rounds 2/3: `31a11c1bb7f3ed961fba07a9ce07ea61eb3ee43404beaa0921d4bd531e927853`.
- After round 3: `e0fde19b8da5db1dd1537d22849af1879f5392f7833ee77e4b83004df34d2178`.

Five new executable regression tests cover the observed mistakes; all 73 CLI
tests pass. The final round-3 additions have not been tested by a fourth cold
agent. The dedicated Python skill validator remains unavailable due to missing
PyYAML; YAML front matter and package/reference checks are checked separately.

All three first validations passed, but only one first evaluation passed. These
are three different tasks with one sample each, not an improvement estimate or
success-rate claim. Later-round success cannot establish a causal skill effect.
The view/scalar guidance documents a current ergonomics limitation; whether to
change that runtime behavior is a separate product decision, not a skill patch.
No backtracking or fourth iteration was performed. Frozen skills, first drafts,
CLI traces, parent audits and diagnostic scripts/results remain unversioned at
`/private/tmp/ordinate-skill-three-rounds-ZmDrTC`. No trial workbook was added to
production examples, and nothing was committed, published or installed.
