import { afterEach, describe, expect, it, vi } from "vitest";
import { captureView, ViewHandoff } from "./ViewHandoff";

class ElementFixture {
  children: ElementFixture[] = [];
  attrs = new Map<string, string>();
  dataset: Record<string, string> = {};
  style = { width: "", height: "" };
  scrollTop = 0;
  scrollLeft = 0;
  ready = true;
  getBoundingClientRect() { return { width: 640, height: 500 }; }
  querySelectorAll(): ElementFixture[] { return this.children.flatMap(child => [child, ...child.querySelectorAll()]); }
  querySelector() { return this.ready ? this : null; }
  setAttribute(name: string, value: string) { this.attrs.set(name, value); }
  removeAttribute(name: string) { this.attrs.delete(name); }
  replaceChildren(...children: ElementFixture[]) { this.children = children; }
  cloneNode() {
    const copy = new ElementFixture();
    copy.attrs = new Map(this.attrs);
    copy.children = this.children.map(child => child.cloneNode());
    return copy;
  }
  asElement() { return this as unknown as HTMLDivElement; }
}

function fixture() {
  vi.useFakeTimers();
  const observers: Array<{ notify: () => void; disconnect: ReturnType<typeof vi.fn> }> = [];
  vi.stubGlobal("MutationObserver", class {
    disconnect = vi.fn();
    constructor(notify: () => void) { observers.push({ notify, disconnect: this.disconnect }); }
    observe() {}
  });
  const component = new ViewHandoff({ viewKey: "A", waitForLayout: true, children: null });
  const live = new ElementFixture(), snapshot = new ElementFixture(), root = new ElementFixture();
  live.children = [new ElementFixture()];
  live.children[0].scrollTop = 120;
  Object.assign(component.live, { current: live.asElement() });
  Object.assign(component.snapshot, { current: snapshot.asElement() });
  Object.assign(component.root, { current: root.asElement() });
  function change(viewKey: string, ready = false, waitForLayout = true) {
    const previous = component.props;
    Object.assign(component, { props: { ...previous, viewKey, waitForLayout } });
    const captured = component.getSnapshotBeforeUpdate(previous);
    live.ready = ready;
    component.componentDidUpdate(previous, {}, captured);
    return captured;
  }
  function settle() { live.ready = true; observers.at(-1)!.notify(); }
  return { component, live, snapshot, root, observers, change, settle };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("view handoff", () => {
  it("captures a visual copy without duplicate IDs and records both scroll axes", () => {
    const source = new ElementFixture(), child = new ElementFixture();
    source.children = [child];
    source.setAttribute("id", "root");
    child.setAttribute("id", "cell");
    child.scrollTop = 120; child.scrollLeft = 75;
    const result = captureView(source.asElement());
    const copy = result.node as unknown as ElementFixture;
    expect(copy.attrs.has("id")).toBe(false);
    expect(copy.children[0].attrs.has("id")).toBe(false);
    expect(copy.attrs.get("inert")).toBe("");
    expect(copy.attrs.get("aria-hidden")).toBe("true");
    expect(copy.style).toEqual({ width: "640px", height: "500px" });
    expect(result.scroll).toEqual([{ node: copy.children[0], top: 120, left: 75 }]);
  });

  it("does not copy content during edits within the same view", () => {
    const { change, root, snapshot, observers } = fixture();
    expect(change("A")).toBeNull();
    expect(root.dataset.handoff).toBeUndefined();
    expect(snapshot.children).toHaveLength(0);
    expect(observers).toHaveLength(0);
  });

  it("keeps the old copy while the only live view is inaccessible and non-interactive", () => {
    const { change, live, snapshot, root } = fixture();
    change("B");
    expect(root.dataset.handoff).toBe("pending");
    expect(root.attrs.get("aria-busy")).toBe("true");
    expect(live.attrs.get("inert")).toBe("");
    expect(live.attrs.get("aria-hidden")).toBe("true");
    expect(snapshot.children).toHaveLength(1);
    expect(snapshot.children[0].children[0].scrollTop).toBe(120);
    vi.advanceTimersByTime(249);
    expect(snapshot.children).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(root.dataset.handoff).toBe("loading");
    expect(snapshot.children).toHaveLength(0);
  });

  it("reveals immediately on layout readiness with no minimum waiting time", () => {
    const { change, settle, live, snapshot, root, observers } = fixture();
    change("B");
    vi.advanceTimersByTime(16);
    settle();
    expect(root.dataset.handoff).toBeUndefined();
    expect(snapshot.children).toHaveLength(0);
    expect(live.attrs.has("inert")).toBe(false);
    expect(live.attrs.has("aria-hidden")).toBe(false);
    expect(root.attrs.has("aria-busy")).toBe(false);
    expect(observers[0].disconnect).toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(root.dataset.handoff).toBeUndefined();
  });

  it("retains the last completed copy and original deadline across rapid switches", () => {
    const { change, snapshot, root, observers, settle } = fixture();
    change("B");
    const original = snapshot.children[0];
    vi.advanceTimersByTime(200);
    expect(change("C")).toBeNull();
    expect(snapshot.children[0]).toBe(original);
    expect(observers[0].disconnect).toHaveBeenCalled();
    observers[0].notify(); // An old notification cannot reveal the unfinished C.
    expect(root.dataset.handoff).toBe("pending");
    vi.advanceTimersByTime(50);
    expect(root.dataset.handoff).toBe("loading");
    settle();
    expect(root.dataset.handoff).toBeUndefined();
  });

  it("does not flash the loading cue again if another slow view is requested", () => {
    const { change, root, settle } = fixture();
    change("B");
    vi.advanceTimersByTime(250);
    change("C");
    expect(root.dataset.handoff).toBe("loading");
    settle();
    expect(root.dataset.handoff).toBeUndefined();
  });

  it("skips preservation for an already-ready destination or a source/error view", () => {
    const { change, root, snapshot, observers } = fixture();
    change("B", true);
    expect(snapshot.children).toHaveLength(0);
    expect(observers).toHaveLength(0);
    change("C");
    change("source", true, false);
    expect(root.dataset.handoff).toBeUndefined();
    expect(snapshot.children).toHaveLength(0);
    vi.advanceTimersByTime(1000);
    expect(root.dataset.handoff).toBeUndefined();
  });

  it("cancels delayed work on unmount", () => {
    const { component, change, root, observers } = fixture();
    change("B");
    component.componentWillUnmount();
    vi.advanceTimersByTime(1000);
    expect(root.dataset.handoff).toBe("pending");
    expect(observers[0].disconnect).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
