import { Component, createRef, type ReactNode } from "react";
import "./viewHandoff.css";

const LOADING_DELAY_MS = 250;
type Props = { viewKey: string; waitForLayout: boolean; children: ReactNode };
type CapturedView = { node: HTMLElement; scroll: Array<{ node: HTMLElement; top: number; left: number }> };

/** A disposable visual copy, not a second React tree or grid instance. */
export function captureView(source: HTMLElement): CapturedView {
  const bounds = source.getBoundingClientRect();
  const node = source.cloneNode(true) as HTMLElement;
  const originals = [source, ...source.querySelectorAll<HTMLElement>("*")];
  const copies = [node, ...node.querySelectorAll<HTMLElement>("*")];
  const scroll: CapturedView["scroll"] = [];
  originals.forEach((original, index) => {
    const copy = copies[index];
    // Duplicate IDs must not redirect labels, focus, or overlays to the copy.
    copy.removeAttribute("id");
    if (original.scrollTop || original.scrollLeft) {
      scroll.push({ node: copy, top: original.scrollTop, left: original.scrollLeft });
    }
  });
  node.style.width = `${bounds.width}px`;
  node.style.height = `${bounds.height}px`;
  node.setAttribute("inert", "");
  node.setAttribute("aria-hidden", "true");
  return { node, scroll };
}

/** Capture before DOM mutation: useLayoutEffect runs too late for this task.
 * The grid's existing data-layout-ready signal is the sole reveal criterion.
 * A timer only delays the loading cue; it never delays a ready view.
 */
export class ViewHandoff extends Component<Props, Record<string, never>, CapturedView | null> {
  readonly live = createRef<HTMLDivElement>();
  readonly snapshot = createRef<HTMLDivElement>();
  readonly root = createRef<HTMLDivElement>();
  private observer: MutationObserver | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending = false;

  private isReady(waitForLayout = this.props.waitForLayout) {
    return !waitForLayout || this.live.current!.querySelector('.table-stage[data-layout-ready="true"]') !== null;
  }

  getSnapshotBeforeUpdate(previous: Props): CapturedView | null {
    if (previous.viewKey === this.props.viewKey && previous.waitForLayout === this.props.waitForLayout) return null;
    if (!this.props.waitForLayout || this.pending || !this.isReady(previous.waitForLayout)) return null;
    return captureView(this.live.current!);
  }

  componentDidUpdate(previous: Props, _state: Record<string, never>, captured: CapturedView | null) {
    if (previous.viewKey === this.props.viewKey && previous.waitForLayout === this.props.waitForLayout) return;
    this.observer?.disconnect();
    if (this.isReady()) {
      this.finish();
      return;
    }
    if (captured) {
      this.snapshot.current!.replaceChildren(captured.node);
      // Scroll offsets are restored after attachment, when scroll ranges exist.
      for (const item of captured.scroll) {
        item.node.scrollTop = item.top;
        item.node.scrollLeft = item.left;
      }
    }
    if (!this.pending) {
      this.pending = true;
      this.root.current!.dataset.handoff = "pending";
      this.root.current!.setAttribute("aria-busy", "true");
      this.live.current!.setAttribute("inert", "");
      this.live.current!.setAttribute("aria-hidden", "true");
      this.timer = setTimeout(() => {
        this.timer = null;
        this.snapshot.current!.replaceChildren();
        this.root.current!.dataset.handoff = "loading";
      }, LOADING_DELAY_MS);
    }
    // On a rapid A → B → C switch, retain A's copy and the original deadline.
    // Observe only the current live tree, never the copy or an old grid callback.
    this.observer = new MutationObserver(() => { if (this.isReady()) this.finish(); });
    this.observer.observe(this.live.current!, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-layout-ready"] });
  }

  private finish() {
    this.observer?.disconnect();
    this.observer = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pending = false;
    this.snapshot.current!.replaceChildren();
    delete this.root.current!.dataset.handoff;
    this.root.current!.removeAttribute("aria-busy");
    this.live.current!.removeAttribute("inert");
    this.live.current!.removeAttribute("aria-hidden");
  }

  componentWillUnmount() {
    this.observer?.disconnect();
    if (this.timer !== null) clearTimeout(this.timer);
  }

  render() {
    return <div className="view-handoff" ref={this.root}>
      <div className="view-handoff-live" ref={this.live}>{this.props.children}</div>
      <div className="view-handoff-snapshot" ref={this.snapshot} aria-hidden="true" />
      <div className="view-handoff-loading" role="status">Loading…</div>
    </div>;
  }
}
