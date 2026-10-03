import { ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";

type Event = IpcMainEvent | IpcMainInvokeEvent;
type Handler = (event: Event, ...args: any[]) => unknown;
const routes = new Map<number, { url: string; handlers: Map<string, Handler> }>();
const registered = new Set<string>();

/** Register channels once; route every request to its originating document. */
export function createWindowIpc(win: BrowserWindow, url: string) {
  const id = win.webContents.id;
  const handlers = new Map<string, Handler>();
  routes.set(id, { url, handlers });
  function register(channel: string, handler: Handler, invoke: boolean) {
    handlers.set(channel, handler);
    if (registered.has(channel)) return;
    registered.add(channel);
    const dispatch = (event: Event, ...args: unknown[]) => {
      const route = routes.get(event.sender.id);
      if (!route || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== route.url) {
        throw new Error("Untrusted desktop request");
      }
      const target = route.handlers.get(channel);
      if (!target) throw new Error(`Unavailable desktop operation: ${channel}`);
      return target(event, ...args);
    };
    if (invoke) ipcMain.handle(channel, dispatch);
    else ipcMain.on(channel, dispatch);
  }
  return {
    handle: (channel: string, handler: Handler) => register(channel, handler, true),
    on: (channel: string, handler: Handler) => register(channel, handler, false),
    dispose: () => { routes.delete(id); },
  };
}
