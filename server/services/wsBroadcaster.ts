import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WsMessage {
  type: string;
  data: unknown;
}

// ---------------------------------------------------------------------------
// Broadcaster
// ---------------------------------------------------------------------------

const clients = new Set<WebSocket>();
let wss: WebSocketServer | null = null;

const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Initialise the WebSocket server on the given HTTP server.
 * Handles connection limits, heartbeat, and client tracking.
 */
export function initWebSocket(
  httpServer: Server,
  maxClients: number = 10,
): WebSocketServer {
  wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    // Enforce max client limit
    if (clients.size >= maxClients) {
      socket.write("HTTP/1.1 429 Too Many Connections\r\n\r\n");
      socket.destroy();
      return;
    }

    wss!.handleUpgrade(request, socket, head, (ws) => {
      wss!.emit("connection", ws, request);
    });
  });

  wss.on("connection", (ws) => {
    clients.add(ws);

    // Heartbeat: mark ws as alive on pong
    (ws as any)._alive = true;
    ws.on("pong", () => {
      (ws as any)._alive = true;
    });

    ws.on("close", () => {
      clients.delete(ws);
    });

    ws.on("error", () => {
      clients.delete(ws);
    });
  });

  // Heartbeat interval: ping all clients, terminate dead ones
  const heartbeat = setInterval(() => {
    for (const ws of clients) {
      if (!(ws as any)._alive) {
        ws.terminate();
        clients.delete(ws);
        continue;
      }
      (ws as any)._alive = false;
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  // Clean up on server close
  wss.on("close", () => {
    clearInterval(heartbeat);
  });

  return wss;
}

/**
 * Broadcast a typed message to all connected WebSocket clients.
 * Only sends to clients with readyState === OPEN.
 */
export function broadcast(type: string, data: unknown): void {
  const message: WsMessage = { type, data };
  const payload = JSON.stringify(message);

  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

/**
 * Get the number of currently connected clients.
 */
export function getConnectedClientCount(): number {
  return clients.size;
}

/**
 * Close all WebSocket connections and shut down the server.
 */
export function closeWebSocket(): void {
  for (const ws of clients) {
    ws.terminate();
  }
  clients.clear();
  wss?.close();
}
