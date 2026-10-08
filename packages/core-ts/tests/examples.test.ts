import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DocumentState, resolveDocumentPresentation, serializeDocumentState, validateDocument } from "../src";

const directory = fileURLToPath(new URL("../../../examples/", import.meta.url));
const files = readdirSync(directory).filter(name => name.endsWith(".ord")).sort();
const read = (file: string) => readFileSync(`${directory}/${file}`, "utf8");
const cell = (document: DocumentState, sheetName: string, row: string, column: string) => {
  const sheet = document.evaluate().sheets.find(sheet => sheet.name === sheetName);
  if (!sheet) throw new Error(`Missing example sheet ${sheetName}`);
  const r = sheet.rowPaths.indexOf(row), c = sheet.colLabels.indexOf(column);
  if (r < 0 || c < 0) throw new Error(`Missing example cell ${sheetName} / ${row} / ${column}`);
  return sheet.values[r][c];
};
const numberAt = (document: DocumentState, sheet: string, row: string, column = "Value") => {
  const value = cell(document, sheet, row, column);
  if (value.kind !== "number") throw new Error(`Expected numeric example result: ${JSON.stringify(value)}`);
  return value.value;
};

describe("User-facing native examples (the root files are the only source)", () => {
  it("ships a guided workbook and eight full-scale application examples", () => expect(files).toHaveLength(9));
  it.each(files)("validates, evaluates, presents and survives native save: %s", file => {
    const source = read(file), validation = validateDocument(source);
    if (!validation.ok) throw new Error(`${file}: ${JSON.stringify(validation.errors)}`);
    const document = DocumentState.fromText(source), evaluated = document.evaluate();
    for (const sheet of evaluated.sheets) {
      sheet.values.forEach((row, r) => row.forEach((value, c) => {
        expect(value.kind, `${file} / ${sheet.name} / ${sheet.rowPaths[r]} / ${sheet.colLabels[c]}: ${JSON.stringify(value)}`).not.toBe("error");
        if (value.kind === "number") expect(Number.isFinite(value.value)).toBe(true);
      }));
    }
    for (const sheet of resolveDocumentPresentation(document).sheets) {
      for (const row of sheet.cells) for (const value of row) expect(value.errors, `${file} / ${sheet.name} / ${value.rowIndex},${value.colIndex}`).toEqual([]);
    }
    const saved = serializeDocumentState(document), reopened = DocumentState.fromText(saved);
    expect(validateDocument(saved).errors).toEqual([]);
    expect(reopened.evaluate()).toEqual(evaluated);
    expect(resolveDocumentPresentation(reopened)).toEqual(resolveDocumentPresentation(document));
    document.sheets.forEach((sheet, i) => {
      for (const position of ["beforeTable", "afterTable"] as const) {
        expect(reopened.sheets[i].getSheetNote(position)).toEqual(sheet.getSheetNote(position));
      }
    });
  });

  it("keeps the guided workbook connected and its tutorial scenarios editable", () => {
    const document = DocumentState.fromText(read("00-getting-started.ord"));
    expect(document.evaluate().sheets.map(sheet => sheet.name)).toEqual([
      "Start Here", "Operating Report", "Sales Ledger", "Loan Planner", "Delivery Sessions", "Review",
    ]);
    expect(numberAt(document, "Review", "2026 planned revenue")).toBeCloseTo(12000000, 6);
    expect(numberAt(document, "Review", "2027 planned revenue")).toBeCloseTo(12960000, 6);
    expect(numberAt(document, "Review", "2026 net income")).toBeCloseTo(2340000, 6);
    expect(numberAt(document, "Review", "Service fees")).toBe(3000);
    expect(cell(document, "Delivery Sessions", "SERVICE-004", "Elapsed")).toMatchObject({ kind: "duration", value: "PT2H" });
    document.setCell("Start Here", "Annual revenue", "Value", "15000000");
    expect(numberAt(document, "Review", "2026 planned revenue")).toBeCloseTo(15000000, 6);
    expect(numberAt(document, "Review", "2027 planned revenue")).toBeCloseTo(16200000, 6);
    document.setCell("Delivery Sessions", "SERVICE-001", "Billable", "true");
    expect(numberAt(document, "Review", "Service fees")).toBe(3250);
    const invoice = numberAt(document, "Review", "Invoice ACME-003");
    document.setCellByIndex("Sales Ledger", 3, 3, "32");
    expect(numberAt(document, "Review", "Invoice ACME-003")).toBeCloseTo(invoice * 2, 8);
  });

  it("demonstrates live arithmetic, finance and ledger results on the welcome sheet", () => {
    const document = DocumentState.fromText(read("00-getting-started.ord"));
    expect(document.sheets[0].cells.flat().filter(cell => cell.body.valid && cell.body.kind === "formula")).toHaveLength(9);
    expect(numberAt(document, "Start Here", "Annual revenue", "Result")).toBe(12960000);
    expect(numberAt(document, "Start Here", "Revenue growth", "Result")).toBe(960000);
    expect(numberAt(document, "Start Here", "Gross margin", "Result")).toBe(6220800);
    expect(numberAt(document, "Start Here", "Corporate tax", "Result")).toBeCloseTo(numberAt(document, "Review", "2026 net income"), 8);
    const monthly = 300000 * .004 / (1 - 1.004 ** -360);
    expect(numberAt(document, "Start Here", "Loan principal", "Result")).toBeCloseTo(monthly, 8);
    expect(numberAt(document, "Start Here", "Loan annual rate", "Result")).toBeCloseTo(numberAt(document, "Review", "First-year loan interest"), 8);
    expect(numberAt(document, "Start Here", "Loan years", "Result")).toBeCloseTo(numberAt(document, "Review", "First-year principal repaid"), 8);
    expect(numberAt(document, "Start Here", "Hourly rate", "Result")).toBe(3000);
    expect(numberAt(document, "Start Here", "Sales tax", "Result")).toBe(numberAt(document, "Review", "Open invoice value"));
    document.setCell("Start Here", "Annual revenue", "Value", "15000000");
    expect(numberAt(document, "Start Here", "Annual revenue", "Result")).toBeCloseTo(16200000, 6);
    expect(numberAt(document, "Start Here", "Gross margin", "Result")).toBeCloseTo(7776000, 6);
    document.setCell("Start Here", "Loan annual rate", "Value", "0.06");
    expect(numberAt(document, "Start Here", "Loan principal", "Result")).toBeGreaterThan(monthly);
    document.setCell("Start Here", "Hourly rate", "Value", "150");
    expect(numberAt(document, "Start Here", "Hourly rate", "Result")).toBe(3600);
    const openInvoices = numberAt(document, "Start Here", "Sales tax", "Result");
    document.setCell("Start Here", "Sales tax", "Value", "0.20");
    expect(numberAt(document, "Start Here", "Sales tax", "Result")).toBeCloseTo(openInvoices / 1.1 * 1.2, 8);
  });

  it("reconciles all twenty report quarters to annual revenue and retained cash", () => {
    const document = DocumentState.fromText(read("01-company-report.ord"));
    const report = document.evaluate().sheets.find(sheet => sheet.name === "Acme Results")!;
    const values = (row: string) => report.values[report.rowPaths.indexOf(row)].slice(1).map(value => {
      if (value.kind !== "number") throw new Error(`Non-numeric report row ${row}`);
      return value.value;
    });
    const revenue = values("Total revenue"), cashFlows = values("Free cash flow");
    const workingCapital = values("Working capital investment");
    expect(revenue).toHaveLength(20);
    for (let quarter=1;quarter<20;quarter++) {
      expect(workingCapital[quarter]).toBeCloseTo((revenue[quarter]-revenue[quarter-1])*.2,9);
    }
    for (let y = 0; y < 5; y++) {
      expect(numberAt(document, "Annual Review", "Total revenue", String(2022+y))).toBe(revenue.slice(y*4,y*4+4).reduce((a,b)=>a+b,0));
    }
    const closingCash = 2400 + cashFlows.reduce((a,b)=>a+b,0);
    expect(numberAt(document, "Overview", "Year-end cash")).toBeCloseTo(closingCash, 8);
    expect(numberAt(document, "Overview", "Latest revenue")).toBe(9763);
    const oldProfit = numberAt(document, "Overview", "Latest operating profit");
    document.setCellByIndex("Acme Results", 3, 20, String(values("Revenue.Industrial systems")[19]+200));
    expect(numberAt(document, "Overview", "Latest revenue")).toBe(9963);
    expect(numberAt(document, "Overview", "Latest operating profit")).toBe(oldProfit+200);
    expect(numberAt(document, "Overview", "Year-end cash")).toBeCloseTo(closingCash+110, 8);
  });
  it("computes DCF from independent forecast and terminal-value arithmetic", () => {
    const document = DocumentState.fromText(read("02-dcf-valuation.ord"));
    const flows = Array.from({length:7}, (_, i) => 1324 * 1.08 ** i);
    const pv = flows.reduce((total, flow, i) => total + flow / 1.1 ** (i + 1), 0);
    const terminalPV = flows[6] * 1.025 / (0.1 - 0.025) / 1.1 ** 7;
    expect(numberAt(document, "Valuation", "Value per share")).toBeCloseTo((pv + terminalPV - 3000) / 1000, 9);
    expect(numberAt(document, "Sensitivity", "10%", "2.5%")).toBeCloseTo((pv + terminalPV - 3000) / 1000, 9);
    expect(numberAt(document, "Valuation", "Diluted value per share")).toBeCloseTo((pv + terminalPV - 3000) / 1050, 9);
    document.setCell("Assumptions", "Gross debt", "Value", "5600");
    expect(numberAt(document, "Valuation", "Value per share")).toBeCloseTo((pv + terminalPV - 4000) / 1000, 9);
    expect(numberAt(document, "Sensitivity", "10%", "2.5%")).toBeCloseTo((pv + terminalPV - 4000) / 1000, 9);
    document.setCell("Assumptions", "WACC", "Value", "0.12");
    expect(numberAt(document, "Valuation", "Value per share")).toBeLessThan((pv + terminalPV - 3000) / 1000);
  });
  it("anchors NPV at the initial outflow rather than discounting it once", () => {
    const document = DocumentState.fromText(read("03-project-investment.ord"));
    let previousWC = 18000*.55*95*.12;
    let expected = -760000-previousWC;
    for (let year = 0; year < 10; year++) {
      const factor = 1.025**year, units = 18000*(.55+year*.04);
      const revenue = units*95*factor, wc = revenue*.12;
      const ebitda = units*(95-48)*factor-(165000+22000)*factor;
      const tax = (ebitda-67500)*.25;
      const flow = ebitda-tax-(wc-previousWC)+(year===9?wc+60000:0);
      expected += flow/1.12**(year+1);
      expect(numberAt(document, "Cash Flows", `Year ${year+1}`, "Net cash flow")).toBeCloseTo(flow, 7);
      previousWC = wc;
    }
    expect(numberAt(document, "Decision", "Periodic NPV")).toBeCloseTo(expected, 8);
    expect(cell(document, "Decision", "Decision at discount rate", "Value")).toMatchObject({kind:"string", value:"Positive NPV"});
    expect(numberAt(document, "Sensitivity", "12%", "0% overrun")).toBeCloseTo(expected, 7);
    expect(numberAt(document, "Decision", "Dated NPV")).toBeLessThan(expected);
    document.setCell("Project Inputs", "Equipment", "Value", "750000");
    expect(numberAt(document, "Decision", "Periodic NPV")).toBeLessThan(expected);
  });
  it("filters transactions into expenses, savings and category totals", () => {
    const document = DocumentState.fromText(read("04-personal-budget.ord"));
    const transactions = document.evaluate().sheets.find(sheet=>sheet.name==="Transactions")!;
    const income = transactions.values.filter(row=>row[3].kind==="string" && row[3].value==="Income").reduce((sum,row)=>sum+(row[6].kind==="number"?row[6].value:NaN),0);
    const expenses = transactions.values.filter(row=>row[3].kind==="string" && row[3].value==="Expense").reduce((sum,row)=>sum+(row[6].kind==="number"?row[6].value:NaN),0);
    expect(numberAt(document, "Annual Review", "Annual income")).toBe(income);
    expect(numberAt(document, "Annual Review", "Annual expenses")).toBe(expenses);
    expect(numberAt(document, "Annual Review", "Year-end savings")).toBe(12000+income-expenses);
    const foodRemaining = numberAt(document, "Category Budget", "Food", "Remaining");
    const old = numberAt(document, "Transactions", "Sep Groceries week 3", "Amount");
    document.setCell("Transactions", "Sep Groceries week 3", "Amount", String(old+100));
    expect(numberAt(document, "Category Budget", "Food", "Remaining")).toBe(foodRemaining-100);
    expect(numberAt(document, "Annual Review", "Year-end savings")).toBe(11900+income-expenses);
  });
  it("reconciles mortgage cash flows with cumulative interest and principal", () => {
    const document = DocumentState.fromText(read("05-mortgage.ord"));
    const monthly = 320000 * .004 / (1 - 1.004 ** -360);
    expect(numberAt(document, "Loan", "Monthly principal and interest")).toBeCloseTo(monthly, 8);
    expect(numberAt(document, "Loan Review", "Interest difference")).toBeCloseTo(0, 7);
    expect(numberAt(document, "Loan Review", "Principal difference")).toBeCloseTo(0, 7);
    expect(numberAt(document, "Loan Review", "Lifetime interest difference")).toBeCloseTo(0, 6);
    expect(numberAt(document, "Loan Review", "Total principal repaid")).toBeCloseTo(320000, 6);
    expect(numberAt(document, "Loan Review", "Final balance")).toBeCloseTo(0, 6);
    expect(numberAt(document, "Amortization", "1", "Interest")).toBe(1280);
    expect(numberAt(document, "Annual Ownership", "2056", "Closing balance")).toBeCloseTo(0, 6);
    document.setCell("Loan", "Annual nominal rate", "Value", "0.06");
    expect(numberAt(document, "Loan", "Monthly principal and interest")).toBeGreaterThan(monthly);
    expect(numberAt(document, "Loan Review", "Principal difference")).toBeCloseTo(0, 7);
    expect(numberAt(document, "Loan Review", "Final balance")).toBeCloseTo(0, 6);
  });
  it("uses whole-customer churn and numeric unit economics", () => {
    const document = DocumentState.fromText(read("06-subscription-business.ord"));
    let customers = 1200, cash = 650000;
    for (let i=0;i<36;i++) {
      const month = `${2026+Math.floor(i/12)}-${String(i%12+1).padStart(2,"0")}`;
      const added = Math.round(65*1.018**i), churned = Math.ceil(customers*.025);
      customers += added-churned;
      const mrr = customers*85*1.04**Math.floor(i/12);
      cash += mrr*.82-added*420-64000*1.08**Math.floor(i/12)-15000;
      expect(numberAt(document, "Customer Plan", month, "Closing")).toBe(customers);
      expect(numberAt(document, "Customer Plan", month, "Closing cash")).toBeCloseTo(cash, 7);
    }
    expect(numberAt(document, "Unit Economics", "Customer acquisition cost")).toBe(420);
    expect(numberAt(document, "Unit Economics", "Gross-profit lifetime value")).toBeCloseTo(85*.82/.025, 9);
    const mrr = numberAt(document, "Unit Economics", "Ending MRR");
    expect(numberAt(document, "Unit Economics", "Monthly compounded MRR growth")).toBeCloseTo((mrr/102000)**(1/36)-1, 12);
    document.setCell("Drivers", "Monthly churn rate", "Value", "0.035");
    expect(numberAt(document, "Unit Economics", "Ending customers")).toBeLessThan(customers);
  });
  it("rounds safety stock to supplier packs and retrieves unit cost", () => {
    const document = DocumentState.fromText(read("07-inventory-replenishment.ord"));
    let spend=0, orderLines=0, units=0;
    for (let i=0;i<48;i++) {
      const sku=`ACME-${101+i}`;
      const order=numberAt(document,"Stock Plan",sku,"Order units");
      const pack=numberAt(document,"Catalog",sku,"Pack size");
      expect(order%pack).toBe(0);
      const position=numberAt(document,"Stock Plan",sku,"Inventory position");
      const reorder=numberAt(document,"Stock Plan",sku,"Reorder point");
      const target=numberAt(document,"Stock Plan",sku,"Target stock");
      expect(order).toBe(position<reorder?Math.ceil((target-position)/pack)*pack:0);
      const cost=order*numberAt(document,"Catalog",sku,"Unit cost");
      expect(numberAt(document,"Stock Plan",sku,"Order cost")).toBeCloseTo(cost,8);
      spend+=cost;units+=order;orderLines+=order>0?1:0;
    }
    expect(numberAt(document,"Purchasing Summary","Planned spend")).toBeCloseTo(spend,8);
    expect(numberAt(document,"Purchasing Summary","Items needing an order")).toBe(orderLines);
    expect(numberAt(document,"Purchasing Summary","Order units")).toBe(units);
    const weeks = document.evaluate().sheets.find(sheet=>sheet.name==="Demand History")!.values[0].slice(1,13).map(value=> {
      if (value.kind!=="number") throw new Error("Non-numeric weekly dispatch count");
      return value.value;
    });
    const mean=weeks.reduce((a,b)=>a+b,0)/12;
    const sd=Math.sqrt(weeks.reduce((sum,value)=>sum+(value-mean)**2,0)/11)/Math.sqrt(5);
    expect(numberAt(document,"Stock Plan","ACME-101","Daily mean")).toBeCloseTo(mean/5,9);
    expect(numberAt(document,"Stock Plan","ACME-101","Daily SD")).toBeCloseTo(sd,9);
    expect(numberAt(document,"Stock Plan","ACME-101","Reorder point")).toBe(Math.ceil(mean+Math.ceil(1.6448536269514722*sd*Math.sqrt(5))));
    document.setCell("Stock Plan","ACME-101","On hand","0");
    const spendBeforeCostChange=numberAt(document,"Purchasing Summary","Planned spend");
    expect(numberAt(document,"Stock Plan","ACME-101","Order units")).toBeGreaterThan(0);
    document.setCell("Catalog","ACME-101","Unit cost","3.50");
    expect(numberAt(document,"Purchasing Summary","Planned spend")).toBeCloseTo(spendBeforeCostChange+numberAt(document,"Stock Plan","ACME-101","Order units"),8);
  });
  it("bills overnight sessions without turning elapsed duration into time-of-day", () => {
    const document = DocumentState.fromText(read("08-time-and-invoices.ord"));
    expect(cell(document, "Sessions", "ACME-004", "Elapsed")).toMatchObject({kind:"duration", value:"PT2H"});
    expect(numberAt(document, "Sessions", "ACME-004", "Hours")).toBe(2);
    expect(cell(document, "Sessions", "ACME-001", "Client code")).toMatchObject({kind:"string", value:"ACME"});
    const oldTotal=numberAt(document,"Invoice Register","Total","September");
    const hours=numberAt(document,"Sessions","ACME-003","Hours");
    const rate=numberAt(document,"Rates","Data migration","Hourly rate");
    expect(cell(document, "Invoice Register", "Due date", "September")).toMatchObject({kind:"date", value:"2026-10-30"});
    const fees = ["September","October","November"].map(month=>numberAt(document,"Invoice Register","Subtotal",month)).reduce((a,b)=>a+b,0);
    const clientFees = ["Acme Manufacturing","Acme Services","Acme Cloud","Acme Distribution"].map(client=>numberAt(document,"Client Billing",client,"Quarter fees")).reduce((a,b)=>a+b,0);
    expect(fees).toBe(clientFees);
    document.setCell("Sessions", "ACME-003", "Billable", "true");
    expect(numberAt(document, "Invoice Register", "Total", "September")).toBeCloseTo(oldTotal+hours*rate*1.1,8);
  });

  it.each([
    ["01-company-report.ord", "Acme Results", 37, 21],
    ["02-dcf-valuation.ord", "Forecast", 20, 11],
    ["03-project-investment.ord", "Operating Plan", 21, 11],
    ["04-personal-budget.ord", "Transactions", 312, 7],
    ["05-mortgage.ord", "Amortization", 360, 9],
    ["06-subscription-business.ord", "Customer Plan", 36, 16],
    ["07-inventory-replenishment.ord", "Stock Plan", 48, 19],
    ["08-time-and-invoices.ord", "Sessions", 120, 11],
  ] as const)("keeps a full business period/detail ledger in %s", (file,name,rows,columns) => {
    const sheet=DocumentState.fromText(read(file)).evaluate().sheets.find(sheet=>sheet.name===name)!;
    expect(sheet.rowPaths.length).toBeGreaterThanOrEqual(rows);
    expect(sheet.colLabels.length).toBe(columns);
  });
});
