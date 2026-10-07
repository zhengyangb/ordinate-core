import { describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import { createSheetPrinter, type NativePDFPrinter } from "./printing";

function setup() {
  const pdf = Buffer.from("test PDF");
  const handle = Buffer.from("test window handle");
  const win = {
    isDestroyed: vi.fn(() => false), getNativeWindowHandle: vi.fn(() => handle),
    getTitle: vi.fn(() => "Quarterly report"),
    webContents: { printToPDF: vi.fn(async () => pdf) },
  };
  const native = { printPDF: vi.fn<NativePDFPrinter["printPDF"]>() };
  return { pdf, handle, win, native, print: createSheetPrinter(win as unknown as BrowserWindow, native) };
}

describe("native PDF sheet printing", () => {
  it("hands the PDF buffer and host-owned title/handle directly to PDFKit", async () => {
    const { win, native, print, pdf, handle } = setup();
    native.printPDF.mockImplementation((_handle, _pdf, _title, done) => done("", true));
    await print();
    expect(win.webContents.printToPDF).toHaveBeenCalledWith({printBackground:true, preferCSSPageSize:true});
    expect(native.printPDF).toHaveBeenCalledWith(handle, pdf, "Quarterly report", expect.any(Function));
  });
  it("waits for native completion, treats cancellation normally and allows another job", async () => {
    const { native, print } = setup();
    const first = print();
    await vi.waitFor(() => expect(native.printPDF).toHaveBeenCalledOnce());
    await expect(print()).rejects.toThrow("already in progress");
    native.printPDF.mock.calls[0][3]("", false);
    await first;
    native.printPDF.mockImplementation((_handle, _pdf, _title, done) => done("", true));
    await print();
    expect(native.printPDF).toHaveBeenCalledTimes(2);
  });
  it("does not open a panel when PDF generation fails and permits retry", async () => {
    const { win, native, print } = setup();
    win.webContents.printToPDF.mockRejectedValueOnce(new Error("PDF generation failed"));
    await expect(print()).rejects.toThrow("PDF generation failed");
    expect(native.printPDF).not.toHaveBeenCalled();
    native.printPDF.mockImplementation((_handle, _pdf, _title, done) => done("", false));
    await print();
  });
  it.each(["throw", "callback"])("clears the pending job after a native %s error", async kind => {
    const { native, print } = setup();
    native.printPDF.mockImplementation((_handle, _pdf, _title, done) => {
      if (kind === "throw") throw new Error("Invalid printable PDF");
      done("Cannot open the print panel", false);
    });
    await expect(print()).rejects.toThrow();
    native.printPDF.mockImplementation((_handle, _pdf, _title, done) => done("", false));
    await print();
  });
  it("rejects a closed window, including closure while PDF generation is pending", async () => {
    const { win, native, print } = setup();
    win.isDestroyed.mockReturnValueOnce(true);
    await expect(print()).rejects.toThrow("window has closed");
    expect(win.webContents.printToPDF).not.toHaveBeenCalled();
    win.webContents.printToPDF.mockImplementationOnce(async () => {
      win.isDestroyed.mockReturnValue(true);
      return Buffer.from("PDF");
    });
    await expect(print()).rejects.toThrow("window has closed");
    expect(native.printPDF).not.toHaveBeenCalled();
  });
  it("fails explicitly when the Mac bridge is unavailable", async () => {
    const { win } = setup();
    await expect(createSheetPrinter(win as unknown as BrowserWindow, null)()).rejects.toThrow("only on Mac");
    expect(win.webContents.printToPDF).not.toHaveBeenCalled();
  });
});
