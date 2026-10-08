import type { Plugin } from "vite";

/** Standalone static distribution, without changing the desktop/editor entry. */
export function onlineEntry(): Plugin {
  return {
    name: "ordinate-online-entry",
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        const url = new URL(request.url!, "http://localhost");
        if (url.pathname === server.config.base || url.pathname === `${server.config.base}index.html`) {
          request.url = `${server.config.base}online.html${url.search}`;
        }
        next();
      });
    },
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        const entry = bundle["online.html"];
        if (!entry || entry.type !== "asset") throw new Error("Missing online HTML entry");
        delete bundle["online.html"];
        entry.fileName = "index.html";
        bundle["index.html"] = entry;
      },
    },
  };
}
