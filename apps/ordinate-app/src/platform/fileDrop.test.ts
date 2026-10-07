import { describe, expect, it, vi } from "vitest";
import { droppedFileKind, fileDragCue, installFileDrop } from "./fileDrop";
import { readUploadedDocument } from "../store/fileSessionStore";

describe("file drop routing", () => {
  it.each([['report.ord', 'document'], ['REPORT.ORD', 'document'], ['数据.csv', 'import'], ['data.TSV', 'import'], ['report.xlsx', 'import']])("routes %s", (name, kind) => {
    expect(droppedFileKind([new File(['data'], name)])).toBe(kind);
  });
  it("rejects missing, multiple, unsupported and oversized files before reading", () => {
    expect(() => droppedFileKind([])).toThrow("one file");
    expect(() => droppedFileKind([new File([], 'a.ord'), new File([], 'b.csv')])).toThrow("one file");
    expect(() => droppedFileKind([new File([], 'a.pdf')])).toThrow();
    expect(() => droppedFileKind([{ name: 'a.ord', size: 16_777_217 } as File])).toThrow("too large");
  });
  it("reads browser ORD uploads as snapshots, not writable backing files", async () => {
    const file = new File(['# 数据\n| 42 |'], '数据.ord', {lastModified: 1});
    const result = await readUploadedDocument(file);
    expect(result).toMatchObject({ok: true, value: {text: '# 数据\n| 42 |', file: {displayName: '数据.ord', adapterKind: 'browser-download'}}});
  });
  it("reports unreadable browser files without fabricating a snapshot", async () => {
    const file = new File([], 'denied.ord');
    vi.spyOn(file, 'text').mockRejectedValue(new Error('Read denied'));
    const result = await readUploadedDocument(file);
    expect(result).toMatchObject({ok: false, error: {kind: 'read_failed', message: expect.stringContaining('Read denied')}});
  });
});

function setup() {
  const target = new EventTarget();
  const actions = {canDrop: vi.fn(() => true), preview: vi.fn(), receive: vi.fn(async () => {}), report: vi.fn(async () => {})};
  const dispose = installFileDrop(target as Window, actions);
  const dispatch = (type: string, files = [new File(['42'], 'file.csv')], types = ['Files'], prevented = false) => {
    const event = new Event(type, {cancelable: true});
    const transfer = {files, types, items: files.map(file => ({kind: 'file', type: file.type})), dropEffect: 'unset'};
    Object.defineProperty(event, 'dataTransfer', {value: transfer});
    if (prevented) event.preventDefault();
    target.dispatchEvent(event);
    return {event, transfer};
  };
  return {target, actions, dispose, dispatch};
}
describe("file drop event lifecycle", () => {
  it("keeps a stable cue across nested elements without publishing every mouse movement", () => {
    const f = setup();
    f.dispatch('dragenter'); f.dispatch('dragenter'); f.dispatch('dragleave'); f.dispatch('dragover');
    expect(f.actions.preview).toHaveBeenCalledTimes(1);
    expect(f.actions.preview).toHaveBeenLastCalledWith({kind: 'import'});
    f.dispatch('dragleave');
    expect(f.actions.preview).toHaveBeenLastCalledWith(null);
    f.dispose();
  });
  it.each(['drop', 'dragend', 'blur', 'escape', 'dispose'])("clears the cue on %s without taking focus", type => {
    const f = setup(); f.dispatch('dragenter');
    if (type === 'dispose') f.dispose();
    else if (type === 'escape') {
      const event = new Event('keydown'); Object.defineProperty(event, 'key', {value: 'Escape'}); f.target.dispatchEvent(event);
    } else f.dispatch(type);
    expect(f.actions.preview).toHaveBeenLastCalledWith(null);
    f.dispose();
  });
  it("suppresses feedback for internal drags and while a dialog is open", () => {
    const f = setup();
    f.dispatch('dragenter', [], ['text/plain']);
    expect(f.actions.preview).not.toHaveBeenCalled();
    f.dispatch('dragenter');
    f.actions.canDrop.mockReturnValue(false); f.dispatch('dragover');
    expect(f.actions.preview).toHaveBeenLastCalledWith(null);
    f.dispose();
  });
  it("shows a non-accepting cue for known invalid files", () => {
    const f = setup();
    expect(f.dispatch('dragenter', [new File([], 'a.pdf')]).transfer.dropEffect).toBe('none');
    expect(f.actions.preview).toHaveBeenLastCalledWith({kind: 'blocked', message: expect.any(String)});
    f.dispose();
  });
  it("prevents navigation and routes the selected file once", async () => {
    const f = setup();
    expect(f.dispatch('dragover').transfer.dropEffect).toBe('copy');
    expect(f.dispatch('drop').event.defaultPrevented).toBe(true);
    expect(f.actions.receive).toHaveBeenCalledOnce();
    expect(f.actions.receive).toHaveBeenCalledWith(expect.objectContaining({name:'file.csv'}), 'import');
    f.dispose();
    expect(f.dispatch('drop').event.defaultPrevented).toBe(false);
  });
  it("leaves text and internal drag gestures alone", () => {
    const f = setup();
    expect(f.dispatch('dragover', [], ['text/plain']).event.defaultPrevented).toBe(false);
    expect(f.dispatch('drop', [], ['text/plain']).event.defaultPrevented).toBe(false);
    f.dispatch('drop', undefined, undefined, true);
    expect(f.actions.receive).not.toHaveBeenCalled();
  });
  it("blocks navigation without replacing a modal or busy document", () => {
    const f = setup(); f.actions.canDrop.mockReturnValue(false);
    expect(f.dispatch('dragover').transfer.dropEffect).toBe('none');
    expect(f.dispatch('drop').event.defaultPrevented).toBe(true);
    expect(f.actions.receive).not.toHaveBeenCalled();
  });
  it("serializes async drops and allows a later retry", async () => {
    const f = setup(); let finish!: () => void;
    f.actions.receive.mockImplementationOnce(() => new Promise<void>(resolve => {finish = resolve;}));
    f.dispatch('drop'); f.dispatch('drop');
    expect(f.actions.receive).toHaveBeenCalledOnce();
    expect(f.dispatch('dragover').transfer.dropEffect).toBe('none');
    finish(); await vi.waitFor(() => expect(f.dispatch('dragover').transfer.dropEffect).toBe('copy'));
    f.dispatch('drop'); expect(f.actions.receive).toHaveBeenCalledTimes(2);
  });
  it("reports errors and recovers for another drop", async () => {
    const f = setup(); f.dispatch('drop', [new File([], 'a.pdf')]);
    await vi.waitFor(() => expect(f.actions.report).toHaveBeenCalledOnce());
    expect(f.actions.receive).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(f.dispatch('dragover').transfer.dropEffect).toBe('copy'));
    f.dispatch('drop'); expect(f.actions.receive).toHaveBeenCalledOnce();
  });
});

describe("protected file drag previews", () => {
  const preview = (...types: string[]) => fileDragCue({files: [], items: types.map(type => ({kind: 'file', type}))} as unknown as DataTransfer);
  it.each(['text/plain', 'application/octet-stream', ''])("does not guess a file extension from %s", mime => {
    expect(preview(mime)).toEqual({kind: 'unknown'});
  });
  it.each(['text/csv', 'text/tab-separated-values', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])("recognizes import MIME %s", mime => {
    expect(preview(mime)).toEqual({kind: 'import'});
  });
  it("keeps the dual cue when no metadata is available", () => { expect(preview()).toEqual({kind:'unknown'}); });
  it("rejects multiple files even before their names are exposed", () => { expect(preview('', '')).toEqual({kind:'blocked', message:'Drop one file at a time.'}); });
  it("uses the same filename validation as drop", () => {
    expect(fileDragCue({files: [new File([], 'REPORT.ORD')]} as unknown as DataTransfer)).toEqual({kind:'document'});
    expect(fileDragCue({files: [{name:'huge.ord',size:16_777_217}]} as unknown as DataTransfer)).toMatchObject({kind:'blocked'});
  });
});
