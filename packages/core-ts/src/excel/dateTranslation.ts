export type ExcelDateSystem = 1900 | 1904;
export type CalendarFunction = "DATE" | "YEAR" | "MONTH" | "DAY";

export function calendarFunction(name: string): name is CalendarFunction {
  return name === "DATE" || name === "YEAR" || name === "MONTH" || name === "DAY";
}

const iff = (condition: string, yes: string, no = "error[type_error]") => `if(${condition},${yes},${no})`;
const epochDays = (system: ExcelDateSystem) => system === 1900 ? 25569 : 24107;
const lastDay = (system: ExcelDateSystem) => system === 1900 ? 2958465 : 2957003;

/** Bake the source workbook calendar into ordinary native expressions. Nothing
 * in DocumentState needs an Excel mode, even after native save and reopen. */
export function importCalendar(name: CalendarFunction, numeric: readonly string[], system: ExcelDateSystem): string {
  const a = numeric.map(value => `(${value})`);
  if (name !== "DATE") {
    const serial = a[0], day = `floor(${serial})`;
    const gregorian = system === 1900 ? `(${day}+${iff(`${day}<60`, "1", "0")})` : day;
    let result = `${name.toLowerCase()}(datetimeFromUnixMillis((${gregorian}-${epochDays(system)})*86400000))`;
    if (system === 1900) {
      // Excel intentionally retains Lotus's fictitious leap day and January 0.
      result = iff(`${day}==60`, name === "YEAR" ? "1900" : name === "MONTH" ? "2" : "29", result);
      result = iff(`${day}==0`, name === "YEAR" ? "1900" : name === "MONTH" ? "1" : "0", result);
    }
    return iff(`and(${serial}>=0,${serial}<${lastDay(system) + 1})`, result);
  }

  const [y, m, d] = a.map(value => `trunc(${value})`);
  const year = iff(`${y}<1900`, `(${y}+1900)`, y);
  const monthOffset = `floor((${m}-1)/12)`;
  const normalizedYear = `(${year}+${monthOffset})`;
  const normalizedMonth = `(${m}-${monthOffset}*12)`;
  const start = `(unixMillis(datetime(date(${normalizedYear},${normalizedMonth},1),time(datetimeFromUnixMillis(0))))/86400000+${epochDays(system)})`;
  // Normalize month first; adding day-1 in Excel's serial space preserves the
  // extra leap day (e.g. DATE(1900,2,29)=60 and DATE(1900,3,0)=60).
  const first = system === 1900 ? `(${start}-${iff(`${start}<61`, "1", "0")})` : start;
  const serial = `(${first}+${d}-1)`;
  return iff(`and(${y}>=0,${y}<10000)`, iff(`and(${serial}>=0,${serial}<=${lastDay(system)})`, serial));
}
