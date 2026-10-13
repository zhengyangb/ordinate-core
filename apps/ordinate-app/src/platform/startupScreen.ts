/** One initial reveal, independent of subsequent sheet switches or edits. */
export function finishStartup() {
  const screen = document.getElementById("startup-screen");
  if (!screen) return; // Already revealed (including React StrictMode's second effect).
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing application root");
  root.inert = false;
  root.removeAttribute("aria-hidden");
  document.documentElement.dataset.startup = "ready";
  screen.remove();
  performance.mark("ordinate:interactive");
}

/** Keep a prepared first view behind the shell until its tab becomes visible. */
export function revealStartupWhenVisible() {
  if (document.visibilityState === "visible") { finishStartup(); return; }
  const reveal = () => {
    if (document.visibilityState !== "visible") return;
    document.removeEventListener("visibilitychange", reveal);
    finishStartup();
  };
  document.addEventListener("visibilitychange", reveal);
  return () => document.removeEventListener("visibilitychange", reveal);
}

export function failStartup(error: unknown) {
  const screen = document.getElementById("startup-screen");
  if (!screen) throw error;
  document.documentElement.dataset.startup = "failed";
  const message = document.createElement("p");
  message.setAttribute("role", "alert");
  message.textContent = `Ordinate could not start. ${String(error)}`;
  const retry = document.createElement("button");
  retry.textContent = "Reload";
  retry.addEventListener("click", () => window.location.reload());
  screen.replaceChildren(message, retry);
  screen.removeAttribute("aria-busy");
}
