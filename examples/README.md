# Ordinate workbooks

One guided workbook and eight full-scale examples built around complete business
and household planning cycles. Open an `.ord` file in Ordinate, or drag it into the app. Save a copy
before adapting it to your own situation.

All organizations, transactions and figures are fictional. Acme is a generic
company placeholder; these are original models, not copied accounts or templates.
Financial examples are not investment, tax or lending advice.

## Choose a workbook

| Workbook | Scope | Contents |
| --- | --- | --- |
| [Getting started](00-getting-started.ord) | Six connected sheets | Start with inputs and nine live results side by side, then explore a three-year report, invoices, financing, elapsed time and cross-sheet summaries. |
| [Company report](01-company-report.ord) | 2022–2026; 20 quarters | Product and service revenue, cost structure, profit, cash conversion, five-year annual review, liquidity and board briefing. |
| [DCF valuation](02-dcf-valuation.ord) | Three historical years and seven forecast years | Operating forecast, reinvestment, enterprise-to-equity bridge, dilution and a 49-case WACC/terminal-growth sensitivity. |
| [Project investment](03-project-investment.ord) | Ten-year equipment life | Capacity ramp, pricing, operating costs, depreciation, tax, working capital recovery, dated returns and a 36-case commissioning-cost sensitivity. |
| [Personal budget](04-personal-budget.ord) | Full 2026 cashbook; 312 transactions | Fourteen expense categories, monthly actuals against annual budgets, savings roll-forward, emergency reserves and year-end review. |
| [Mortgage](05-mortgage.ord) | All 360 payments over 30 years | Principal and interest schedule, annual ownership costs, repayment milestones, cumulative reconciliation and 15-/30-year rate comparisons. |
| [Subscription business](06-subscription-business.ord) | 36 months; 24 acquisition cohorts | Acquisition channels, customer churn, price changes, MRR/ARR, staffing, cash plan, retention and unit economics. |
| [Inventory replenishment](07-inventory-replenishment.ord) | 48 components; twelve weeks of demand | Supplier catalog, demand variability, safety stock, outstanding orders, allocations, pack-rounded replenishment and purchase releases. |
| [Time and invoices](08-time-and-invoices.ord) | 120 sessions; eight workstreams and four clients | Delivery ledger, overnight handovers, non-chargeable effort, fee envelopes, three monthly billing periods and client account review. |

Notes describe the reporting period, commercial assumptions and decisions that
the workbook supports. Inputs are kept in labeled assumption sheets or source
ledgers; calculated summaries draw from those sheets. All amounts and rates
state their basis. Display rounding does not round the underlying calculation.

These workbooks have deliberately defined horizons and source ranges. When
extending a ledger or adding forecast periods, extend its summary ranges too.
There are no live feeds, macros or random forecasts.

## Location and checks

Root `examples/` is shared product content, not core implementation. Tests and
application smoke checks read these exact files rather than maintain copies.
The Ordinate Online gallery uses `catalog.json` and these workbooks through a
Vite build step. Its calculated previews and public assets are generated, not
separately maintained copies.

```sh
npm --prefix packages/core-ts test -- tests/examples.test.ts
cd apps/ordinate-app
npm run build
npx electron desktop/interchange-smoke.mjs --examples-only
```

Checks cover every calculated cell and display diagnostic, native save/reopen,
minimum workbook scale, independent financial calculations and recalculation
after input changes. The app check opens every sheet in isolated native and web
hosts and captures each sheet for visual review.

Native `.ord` files are authoritative. Review interchange warnings when exporting
to Excel or CSV; a completed export does not by itself establish identical
recalculation in another application.
