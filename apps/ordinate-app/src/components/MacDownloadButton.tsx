import "./macDownload.css";
export function MacDownloadButton({ onClick }: { onClick: () => void }) {
  return <button type="button" className="mac-download-button" onClick={onClick} aria-label="Get Mac app" title="Get Mac app">
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 3v9m-3-3 3 3 3-3M4 13v3h12v-3" />
    </svg><span>Get Mac app</span>
  </button>;
}
