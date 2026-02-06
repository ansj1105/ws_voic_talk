const $ = (id) => document.getElementById(id);

const statusEl = $("status");
const logEl = $("log");
const peersEl = $("peers");
const joinBtn = $("join");
const leaveBtn = $("leave");
const muteBtn = $("mute");
const unmuteBtn = $("unmute");

let ws;
let myId;
let myName;
let roomId;
let localStream;
const peers = new Map();

const iceConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logEl.textContent = `${line}\n${logEl.textContent}`.slice(0, 4000);
}

function setStatus(text) {
  statusEl.textContent = text;
}

function updatePeersList() {
  peersEl.innerHTML = "";
  for (const [id, p] of peers.entries()) {
    const li = document.createElement("li");
    li.textContent = `${p.name || "peer"} (${id.slice(0, 8)})`;
    peersEl.appendChild(li);
  }
}

async function ensureLocalAudio() {
  if (localStream) return localStream;
  localStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  });
  return localStream;
}

function createPeerConnection(peerId, peerName) {
  if (peers.has(peerId)) return peers.get(peerId).pc;

  const pc = new RTCPeerConnection(iceConfig);
  const remoteAudio = document.createElement("audio");
  remoteAudio.autoplay = true;
  remoteAudio.playsInline = true;

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      send({ type: "ice", to: peerId, candidate: e.candidate });
    }
  };

  pc.ontrack = (e) => {
    if (remoteAudio.srcObject !== e.streams[0]) {
      remoteAudio.srcObject = e.streams[0];
      log(`Remote audio stream from ${peerId.slice(0, 8)}`);
    }
  };

  pc.onconnectionstatechange = () => {
    log(`PC(${peerId.slice(0, 8)}) state: ${pc.connectionState}`);
  };

  peers.set(peerId, { pc, name: peerName || "peer", audio: remoteAudio });
  updatePeersList();
  return pc;
}

function isInitiator(peerId) {
  return myId && myId < peerId;
}

async function addLocalTracks(pc) {
  const stream = await ensureLocalAudio();
  for (const track of stream.getTracks()) {
    pc.addTrack(track, stream);
  }
}

async function makeOffer(peerId) {
  const pc = createPeerConnection(peerId, peers.get(peerId)?.name);
  await addLocalTracks(pc);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  send({ type: "offer", to: peerId, sdp: pc.localDescription });
}

async function handleOffer(msg) {
  const from = msg.from;
  const pc = createPeerConnection(from, msg.name);
  await addLocalTracks(pc);
  await pc.setRemoteDescription(msg.sdp);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  send({ type: "answer", to: from, sdp: pc.localDescription });
}

async function handleAnswer(msg) {
  const pc = peers.get(msg.from)?.pc;
  if (!pc) return;
  await pc.setRemoteDescription(msg.sdp);
}

async function handleIce(msg) {
  const pc = peers.get(msg.from)?.pc;
  if (!pc) return;
  try {
    await pc.addIceCandidate(msg.candidate);
  } catch (err) {
    log(`ICE error: ${err.message}`);
  }
}

function send(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

async function join() {
  myName = $("name").value.trim() || "guest";
  roomId = $("room").value.trim() || "demo";

  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`);

  ws.onopen = () => {
    send({ type: "join", name: myName, room: roomId });
    setStatus(`Joined ${roomId}`);
    joinBtn.disabled = true;
    leaveBtn.disabled = false;
    muteBtn.disabled = false;
    unmuteBtn.disabled = false;
    log("WebSocket connected");
  };

  ws.onmessage = async (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "joined") {
      myId = msg.id;
      for (const peer of msg.peers) {
        createPeerConnection(peer.id, peer.name);
        if (isInitiator(peer.id)) {
          await makeOffer(peer.id);
        }
      }
      return;
    }

    if (msg.from === myId) return;
    if (msg.to && msg.to !== myId) return;

    switch (msg.type) {
      case "peer-joined":
        createPeerConnection(msg.id, msg.name);
        if (isInitiator(msg.id)) {
          await makeOffer(msg.id);
        }
        break;
      case "offer":
        await handleOffer(msg);
        break;
      case "answer":
        await handleAnswer(msg);
        break;
      case "ice":
        await handleIce(msg);
        break;
      case "peer-left":
        const peer = peers.get(msg.id);
        if (peer) {
          peer.pc.close();
          peers.delete(msg.id);
          updatePeersList();
        }
        break;
      default:
        break;
    }
  };

  ws.onclose = () => {
    setStatus("Disconnected");
    joinBtn.disabled = false;
    leaveBtn.disabled = true;
    muteBtn.disabled = true;
    unmuteBtn.disabled = true;
    log("WebSocket closed");
  };
}

function leave() {
  send({ type: "leave" });
  if (ws) ws.close();
  for (const [id, peer] of peers.entries()) {
    peer.pc.close();
    peers.delete(id);
  }
  if (localStream) {
    for (const track of localStream.getTracks()) track.stop();
    localStream = null;
  }
  updatePeersList();
}

muteBtn.onclick = () => {
  if (!localStream) return;
  for (const track of localStream.getAudioTracks()) track.enabled = false;
  log("Muted");
};

unmuteBtn.onclick = () => {
  if (!localStream) return;
  for (const track of localStream.getAudioTracks()) track.enabled = true;
  log("Unmuted");
};

joinBtn.onclick = () => join().catch((e) => log(e.message));
leaveBtn.onclick = () => leave();
