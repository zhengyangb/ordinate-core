# Display preferences

Settings is available from the gear after Redo in the left toolbar, separated from History by the shared toolbar divider, ⌘/Ctrl+, and the macOS application menu. Its sidebar contains Appearance and Date & time. Region always follows the host; neither manual region nor interface language is configurable. Choices apply immediately and persist per user, not in `.ord` documents. Appearance uses the existing theme preference key. Other document windows synchronize through browser storage events.

## Temporal display contract

- The default is Regional with Automatic region. The browser uses its preferred language/region; the desktop host supplies macOS system region via Electron `app.getSystemLocale()` when creating the window. Region is not a stored preference. System region changes take effect in a new window.
- Locale formatting applies only to runtime date, datetime, time and duration values with no effective explicit format. Cell > row > column formatting and diagnostics remain authoritative. Text that resembles a date remains text; semantic header labels remain labels.
- `createCellDisplayFormatter` owns the display policy. Grid projection, document search and print snapshots consume the same formatter. Editing, source, runtime values, calculations and Excel import/export retain their existing semantics.
- Dates use the Gregorian calendar. Formatting original wall-clock components with `Intl.DateTimeFormat` in UTC prevents locale preferences from performing a timezone conversion. Qualified times retain their original offset as a suffix. Seconds and nonzero milliseconds remain visible.
- `Intl.DurationFormat` formats duration units, not a clock. Calendar years/months, negative signs, hours above 24 and milliseconds remain intact. Zero explicitly displays seconds rather than disappearing.
- ISO selects the existing ISO display. Explicit formats are not affected by either mode.

The host must provide `Intl.DurationFormat`; unsupported hosts fail rather than silently substituting an unrelated display. Invalid stored preferences fail early. This version does not change the global number format, UI language, time zone, or Excel export formats.

## Interaction

The window reuses the application modal and SegmentedChoice radio groups. The two sidebar tabs support Up/Down, Home/End and Tab, with linked panels and only the active panel exposed. The window and footer retain their dimensions across categories and format choices; content scrolls independently on short screens. Appearance includes a preview using the actual chrome and sheet tokens. The Settings command is not a pressed-state toggle. Escape closes it and restores focus; there is no separate Save action.

API references: [Electron system region](https://www.electronjs.org/docs/latest/api/app#appgetsystemlocale), [DateTimeFormat](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/DateTimeFormat), [DurationFormat](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DurationFormat/DurationFormat).
