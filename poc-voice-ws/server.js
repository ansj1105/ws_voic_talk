import http from "http";
import fs from "fs";
import path from "path";
import { WebSocketServer } from "ws";
import { randomUUID } from "crypto";

const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = path.resolve("./public");

const server = http.createServer((req, res) => {
  const url = req.url === "/" ? "/index.html" : req.url;
  const filePath = path.join(PUBLIC_DIR, url);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(400);
    return res.end("Bad request");
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not found");
    }
    const ext = path.extname(filePath);
    const contentType =
      ext === ".html" ? "text/html" :
      ext === ".js" ? "text/javascript" :
      ext === ".css" ? "text/css" :
      "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, new Set());
  return rooms.get(roomId);
}

function broadcast(roomId, sender, payload) {
  const room = rooms.get(roomId);
  if (!room) return;
  const data = JSON.stringify(payload);
  for (const client of room) {
    if (client !== sender && client.readyState === 1) {
      client.send(data);
    }
  }
}

function roomPeers(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  return Array.from(room).map((c) => ({ id: c.id, name: c.name }));
}

wss.on("connection", (ws) => {
  ws.id = randomUUID();
  ws.roomId = null;
  ws.name = "";

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "join") {
      const roomId = String(msg.room || "default").trim();
      const name = String(msg.name || "guest").trim().slice(0, 32);
      ws.roomId = roomId;
      ws.name = name;

      const room = getRoom(roomId);
      room.add(ws);

      ws.send(JSON.stringify({
        type: "joined",
        id: ws.id,
        peers: roomPeers(roomId).filter((p) => p.id !== ws.id)
      }));

      broadcast(roomId, ws, { type: "peer-joined", id: ws.id, name: ws.name });
      return;
    }

    if (!ws.roomId) return;

    switch (msg.type) {
      case "offer":
      case "answer":
      case "ice":
        broadcast(ws.roomId, ws, { ...msg, from: ws.id, name: ws.name });
        break;
      case "leave":
        ws.close();
        break;
      default:
        break;
    }
  });

  ws.on("close", () => {
    if (!ws.roomId) return;
    const room = rooms.get(ws.roomId);
    if (room) {
      room.delete(ws);
      broadcast(ws.roomId, ws, { type: "peer-left", id: ws.id });
      if (room.size === 0) rooms.delete(ws.roomId);
    }
  });
});

server.listen(PORT, () => {
  console.log(`POC voice WS signaling server on :${PORT}`);
});
