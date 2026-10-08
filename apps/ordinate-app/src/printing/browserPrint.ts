/** Browsers may return from print() before preview closes. Keep the print tree
 * alive until afterprint, including cancellation, rather than assuming that
 * return means completion or using a timeout to guess the dialog's lifetime. */
export function browserPrint(): Promise<void> {
  return new Promise((resolve, reject) => {
    const finished = () => resolve();
    window.addEventListener("afterprint", finished, { once: true });
    try { window.print(); }
    catch (error) {
      window.removeEventListener("afterprint", finished);
      reject(error);
    }
  });
}
