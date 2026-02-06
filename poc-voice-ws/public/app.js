const $ = (id) => document.getElementById(id);

const statusEl = $("status");
const logEl = $("log");
const peersEl = $("peers");
const joinBtn = $("join");
const leaveBtn = $("leave");
const muteBtn = $("mute");
const unmuteBtn = $("unmute");
const micLevelEl = $("micLevel");
const micStateEl = $("micState");
const micGainEl = $("micGain");
const audioBin = $("audioBin");

let ws;
let myId;
let myName;
let roomId;
let localStream;
let processedStream;
let audioCtx;
let analyser;
let gainNode;
let meterTimer;
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
  if (myId) {
    const me = document.createElement("li");
    me.textContent = `You (${myId.slice(0, 8)})`;
    peersEl.appendChild(me);
  }
  for (const [id, p] of peers.entries()) {
    const li = document.createElement("li");
    li.textContent = `${p.name || "peer"} (${id.slice(0, 8)})`;
    peersEl.appendChild(li);
  }
  if (!myId && peers.size === 0) {
    const li = document.createElement("li");
    li.textContent = "No peers";
    peersEl.appendChild(li);
  }
}

async function ensureLocalAudio() {
  if (processedStream) return processedStream;
  localStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  });
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioCtx.createMediaStreamSource(localStream);
  gainNode = audioCtx.createGain();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;

  source.connect(gainNode);
  gainNode.connect(analyser);

  const dest = audioCtx.createMediaStreamDestination();
  gainNode.connect(dest);
  processedStream = dest.stream;

  startMicMeter();
  return processedStream;
}

async function resumeAudioContext() {
  if (audioCtx && audioCtx.state !== "running") {
    try {
      await audioCtx.resume();
    } catch {
      // ignore
    }
  }
}

function createPeerConnection(peerId, peerName) {
  if (peers.has(peerId)) return peers.get(peerId).pc;

  const pc = new RTCPeerConnection(iceConfig);
  const remoteAudio = document.createElement("audio");
  remoteAudio.autoplay = true;
  remoteAudio.playsInline = true;
  remoteAudio.muted = false;
  audioBin.appendChild(remoteAudio);

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      send({ type: "ice", to: peerId, candidate: e.candidate });
    }
  };

  pc.ontrack = (e) => {
    if (remoteAudio.srcObject !== e.streams[0]) {
      remoteAudio.srcObject = e.streams[0];
      remoteAudio.play().catch(() => {});
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

  try {
    await ensureLocalAudio();
    log("Mic permission granted");
  } catch (e) {
    log(`Mic permission error: ${e.message || e}`);
  }

  await resumeAudioContext();
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
      updatePeersList();
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
    if (peer.audio && peer.audio.parentNode) {
      peer.audio.srcObject = null;
      peer.audio.parentNode.removeChild(peer.audio);
    }
    peers.delete(id);
  }
  if (localStream) {
    for (const track of localStream.getTracks()) track.stop();
    localStream = null;
  }
  processedStream = null;
  if (audioCtx) {
    audioCtx.close();
    audioCtx = null;
  }
  if (meterTimer) {
    clearInterval(meterTimer);
    meterTimer = null;
  }
  micLevelEl.style.width = "0%";
  micStateEl.textContent = "Idle";
  micStateEl.classList.remove("active");
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

micGainEl.oninput = () => {
  if (!gainNode) return;
  gainNode.gain.value = Number(micGainEl.value);
};

joinBtn.onclick = () => join().catch((e) => log(e.message));
leaveBtn.onclick = () => leave();

function startMicMeter() {
  if (!analyser) return;
  const data = new Uint8Array(analyser.fftSize);
  if (meterTimer) clearInterval(meterTimer);
  meterTimer = setInterval(() => {
    analyser.getByteTimeDomainData(data);
    let max = 0;
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i] - 128) / 128;
      if (v > max) max = v;
    }
    const pct = Math.min(1, max * 3);
    micLevelEl.style.width = `${Math.round(pct * 100)}%`;
    if (pct > 0.1) {
      micStateEl.textContent = "Speaking";
      micStateEl.classList.add("active");
    } else {
      micStateEl.textContent = "Idle";
      micStateEl.classList.remove("active");
    }
  }, 80);
}
