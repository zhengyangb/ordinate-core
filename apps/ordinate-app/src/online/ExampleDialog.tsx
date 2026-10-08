import { useId, useRef, useState } from "react";
import ModalShell from "../components/ModalShell";
import { SegmentedChoice } from "../components/SegmentedChoice";
import type { Example } from "./onlineModel";

function Preview({ example }: { example: Example }) {
  return <div className="online-example-preview" aria-hidden="true"><table>
    {!!example.preview.headers.length && <thead><tr>{example.preview.headers.map((text, index) => <th key={index}>{text}</th>)}</tr></thead>}
    <tbody>{example.preview.rows.map((row, index) => <tr key={index}>{row.map((text, col) => <td key={col}>{text}</td>)}</tr>)}</tbody>
  </table></div>;
}

export function ExampleDialog({ examples, busy, error, onClose, onOpen, onBlank, onOpenFile }: {
  examples: Example[]; busy: string | null; error: string | null;
  onClose: () => void; onOpen: (example: Example) => void; onBlank: () => void; onOpenFile: () => void;
}) {
  const [category, setCategory] = useState("All");
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const models = examples.filter(example => !example.featured);
  const featured = examples.find(example => example.featured);
  const categories = ["All", ...new Set(models.map(example => example.category))];
  return <ModalShell open className="online-example-dialog" titleId={titleId} initialFocusRef={headingRef} onClose={onClose}>
    <div className="app-modal-content">
      <header className="online-dialog-header">
        <div><h2 ref={headingRef} id={titleId} tabIndex={-1}>Start with an example</h2><p>A working model to explore and make your own.</p></div>
        <button className="online-dialog-close" aria-label="Close examples" onClick={onClose}>×</button>
      </header>
      <div className="online-gallery-content">
        {featured && <button className="online-featured" disabled={!!busy} onClick={() => onOpen(featured)} aria-label={`Open ${featured.title}`}>
          <div className="online-featured-copy"><span className="online-featured-kicker">Guided workbook · {featured.sheets} sheets</span>
            <h3>{featured.title}</h3><p>{featured.description}</p><span className="online-featured-action">Explore Ordinate <span aria-hidden="true">→</span></span></div>
          <Preview example={featured} />
        </button>}
        <div className="online-gallery-section"><h3>More examples</h3><SegmentedChoice label="Example category" value={category}
          options={categories.map(item => ({ value: item, label: item }))} onChange={setCategory} /></div>
        {error && <p className="online-error" role="alert">{error}</p>}
        <div className="online-example-grid" aria-busy={!!busy}>
          {models.filter(item => category === "All" || category === item.category).map(example => <button
            key={example.id} className="online-example" disabled={!!busy} onClick={() => onOpen(example)} aria-label={`Open ${example.title}`}>
            <Preview example={example} />
            <div className="online-example-label"><h4>{example.title}</h4><span>{example.sheets} sheets</span></div>
            <p>{example.description}</p>
          </button>)}
        </div>
      </div>
      <footer className="online-dialog-footer"><span>Your files stay on this device.</span><div className="app-modal-actions">
        <button className="app-modal-action secondary" disabled={!!busy} onClick={onBlank}>Blank document</button>
        <button className="app-modal-action primary" disabled={!!busy} onClick={onOpenFile}>Open file…</button>
      </div></footer>
    </div>
  </ModalShell>;
}
