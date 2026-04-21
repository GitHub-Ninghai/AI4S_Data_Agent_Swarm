import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { WebSocket } from "ws";
import { initWebSocket, broadcast, getConnectedClientCount, closeWebSocket } from "./wsBroadcaster.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestServer(): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port });
    });
  });
}

function wsConnect(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function waitForClose(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve();
    } else {
      ws.on("close", () => resolve());
    }
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WebSocket Broadcaster", () => {
  let httpServer: http.Server;
  let port: number;

  beforeAll(async () => {
    const result = await createTestServer();
    httpServer = result.server;
    port = result.port;
    initWebSocket(httpServer, 10);
  });

  afterAll(() => {
    closeWebSocket();
    httpServer.close();
  });

  it("accepts a WebSocket connection", async () => {
    const ws = await wsConnect(port);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
    await waitForClose(ws);
  });

  it("tracks connected client count", async () => {
    const ws = await wsConnect(port);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const countBefore = getConnectedClientCount();
    expect(countBefore).toBeGreaterThanOrEqual(1);

    ws.close();
    await waitForClose(ws);
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  it("broadcasts messages to connected clients", async () => {
    const ws = await wsConnect(port);

    // Set up listener BEFORE broadcasting
    const messagePromise = new Promise<string>((resolve) => {
      ws.once("message", (data) => resolve(data.toString()));
    });

    broadcast("test:event", { hello: "world" });

    const raw = await messagePromise;
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual({ type: "test:event", data: { hello: "world" } });

    ws.close();
    await waitForClose(ws);
  });

  it("broadcasts to multiple clients", async () => {
    const ws1 = await wsConnect(port);
    const ws2 = await wsConnect(port);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Set up listeners BEFORE broadcasting
    const msg1 = new Promise<string>((resolve) => {
      ws1.once("message", (data) => resolve(data.toString()));
    });
    const msg2 = new Promise<string>((resolve) => {
      ws2.once("message", (data) => resolve(data.toString()));
    });

    broadcast("multi", { count: 2 });

    const [raw1, raw2] = await Promise.all([msg1, msg2]);
    expect(JSON.parse(raw1).type).toBe("multi");
    expect(JSON.parse(raw2).type).toBe("multi");

    ws1.close();
    ws2.close();
    await waitForClose(ws1);
    await waitForClose(ws2);
  }, 10_000);

  it("rejects connections beyond maxClients", async () => {
    // Close existing and create a fresh server with limit 2
    closeWebSocket();
    httpServer.close();

    const result = await createTestServer();
    httpServer = result.server;
    port = result.port;
    initWebSocket(httpServer, 2);

    // Connect 2 clients (limit)
    const ws1 = await wsConnect(port);
    const ws2 = await wsConnect(port);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // 3rd should be rejected
    const ws3 = new WebSocket(`ws://127.0.0.1:${port}`);
    const result3 = await new Promise<"open" | "close">((resolve) => {
      ws3.on("open", () => resolve("open"));
      ws3.on("unexpected-response", () => resolve("close"));
      ws3.on("error", () => resolve("close"));
      setTimeout(() => resolve("close"), 3000);
    });
    expect(result3).toBe("close");

    ws1.close();
    ws2.close();
    await waitForClose(ws1);
    await waitForClose(ws2);
  }, 10_000);
});
