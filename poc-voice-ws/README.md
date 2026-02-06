# Voice Call POC (WebSocket signaling)

Audio-only WebRTC POC with WebSocket signaling. One server, multiple peers in a room.

## Local

```bash
cd poc-voice-ws
./scripts/dev.sh
```

Open `http://localhost:8080` in two browser tabs (or two devices on the same network).

## Docker

```bash
cd poc-voice-ws
./scripts/docker-build.sh
./scripts/docker-run.sh
```

Or with compose:

```bash
docker compose up --build
```

## Notes

- Uses public STUN only (`stun:stun.l.google.com:19302`). For NAT-restricted environments, add TURN.
- Signaling is broadcast within a room; messages include `to` to avoid collisions.
