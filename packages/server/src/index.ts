import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { once } from "node:events";
try {
  const config = loadConfig(),
    runtime = await createApp(config),
    server = await runtime.app.listen(config.port, config.host);
  if (!server.listening) await once(server, "listening");
  server.requestTimeout = 60000;
  server.headersTimeout = 15000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 100;
  console.log(JSON.stringify({ event: "nodepass.started", port: config.port }));
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    const deadline = setTimeout(() => server.closeAllConnections(), 15000);
    deadline.unref();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    clearTimeout(deadline);
    await runtime.close();
  };
  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
} catch {
  console.error(
    "nodePass startup failed. Check database access, schema compatibility and configured secret files.",
  );
  process.exit(1);
}
