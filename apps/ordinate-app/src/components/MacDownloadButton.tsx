import "./macDownload.css";
export function MacDownloadButton({ platform, onClick }: { platform: "mac" | "windows" | "linux" | "other"; onClick: () => void }) {
  const label = platform === "mac" ? "Get Mac app" : "Coming soon";
  const title = platform === "mac" ? label : `${platform === "other" ? "Desktop" : platform === "windows" ? "Windows" : "Linux"} app · Coming soon`;
  return <button type="button" className="mac-download-button" onClick={onClick} aria-label={title} title={title}>
    {platform === "mac" ? <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 3v9m-3-3 3 3 3-3M4 13v3h12v-3" />
    </svg> : <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
      <circle cx="10" cy="10" r="6.5" /><path d="M10 6.5v4l2.5 1.5" />
    </svg>}<span>{label}</span>
  </button>;
}
