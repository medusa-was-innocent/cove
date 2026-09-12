/* global io */
"use strict";

/**
 * Cove — room page logic.
 *
 * The server (server.js) only exchanges signaling messages: room roster,
 * SDP offers/answers, and ICE candidates. Video, audio, and chat all travel
 * directly between browsers over WebRTC once a connection is up.
 *
 * Every local MediaStream always carries exactly one audio track and one
 * video track — a real device track, or a silent/black placeholder when a
 * device is missing, denied, or toggled off. That keeps each
 * RTCPeerConnection's senders stable from the moment it's created, so
 * muting, camera-off, and even screen sharing are all just `enabled` flips
 * or replaceTrack() calls — nothing ever needs to renegotiate after the
 * initial handshake.
 *
 * Connections use "perfect negotiation": politeness is decided by comparing
 * peer ids (the lexicographically smaller id is polite), so both sides can
 * independently agree on the same role without any extra coordination.
 */

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun.cloudflare.com:3478" }];

const MAX_PEERS = 8;
const MAX_CHAT = 400;
const NAME_KEY = "cove-name";

// ---------------------------------------------------------------- icons --
const ICONS = {
	mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="11" rx="3"></rect><path d="M5 10a7 7 0 0 0 14 0"></path><line x1="12" y1="19" x2="12" y2="22"></line><line x1="8" y1="22" x2="16" y2="22"></line></svg>',
	micOff:
		'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="11" rx="3"></rect><path d="M5 10a7 7 0 0 0 14 0"></path><line x1="12" y1="19" x2="12" y2="22"></line><line x1="8" y1="22" x2="16" y2="22"></line><line x1="3" y1="2" x2="21" y2="22"></line></svg>',
	video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="14" height="12" rx="2"></rect><path d="M16 10.5 21.5 7v10L16 13.5"></path></svg>',
	videoOff:
		'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="14" height="12" rx="2"></rect><path d="M16 10.5 21.5 7v10L16 13.5"></path><line x1="1" y1="2" x2="23" y2="22"></line></svg>',
	monitor:
		'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>',
	monitorOff:
		'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line><line x1="1" y1="1" x2="23" y2="21"></line></svg>',
	chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-4 4V6Z"></path></svg>',
	link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17H7a5 5 0 0 1 0-10h2"></path><path d="M15 7h2a5 5 0 1 1 0 10h-2"></path><line x1="8" y1="12" x2="16" y2="12"></line></svg>',
	leave:
		'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate(135deg)"><path d="M22 16.92v2a2 2 0 0 1-2.18 2 19.6 19.6 0 0 1-8.54-3 19.3 19.3 0 0 1-6-6 19.6 19.6 0 0 1-3-8.58A2 2 0 0 1 4.25 1h2a2 2 0 0 1 2 1.72c.13.95.36 1.88.69 2.77a2 2 0 0 1-.45 2.11L7.1 8.99a16 16 0 0 0 6 6l1.4-1.4a2 2 0 0 1 2.11-.45c.9.33 1.83.56 2.78.69A2 2 0 0 1 22 16.92Z"></path></svg>',
};

// ------------------------------------------------------------ dom refs --
const $ = (id) => document.getElementById(id);

const dom = {
	lobby: $("lobby"),
	stage: $("stage"),
	lobbyRoomPath: $("lobbyRoomPath"),
	activeRoomPath: $("activeRoomPath"),

	previewVideo: $("previewVideo"),
	previewAvatarFallback: $("previewAvatarFallback"),
	previewAvatarInitial: $("previewAvatarInitial"),
	lobbyMicBtn: $("lobbyMicBtn"),
	lobbyCamBtn: $("lobbyCamBtn"),
	lobbyHint: $("lobbyHint"),
	nameInput: $("nameInput"),
	camSelectWrap: $("camSelectWrap"),
	camSelect: $("camSelect"),
	micSelectWrap: $("micSelectWrap"),
	micSelect: $("micSelect"),
	joinBtn: $("joinBtn"),

	peerCountPill: $("peerCountPill"),
	copyLinkBtn: $("copyLinkBtn"),
	crowdedNote: $("crowdedNote"),
	waitingRow: $("waitingRow"),
	waitingCopyBtn: $("waitingCopyBtn"),
	videoGrid: $("videoGrid"),

	chatPanel: $("chatPanel"),
	chatLog: $("chatLog"),
	chatEmpty: $("chatEmpty"),
	chatForm: $("chatForm"),
	chatInput: $("chatInput"),
	chatCloseBtn: $("chatCloseBtn"),

	micBtn: $("micBtn"),
	camBtn: $("camBtn"),
	screenBtn: $("screenBtn"),
	chatBtn: $("chatBtn"),
	dockCopyBtn: $("dockCopyBtn"),
	leaveBtn: $("leaveBtn"),

	toastStack: $("toastStack"),
};

// --------------------------------------------------------------- state --
const state = {
	roomId: "",
	name: "",
	audioEnabled: true,
	videoEnabled: true,
	screenSharing: false,
	selectedMicId: "",
	selectedCamId: "",
	localStream: null,
	cameraTrack: null,
	socket: null,
	selfId: null,
	chatOpen: false,
	unread: 0,
};

/** peerId -> { pc, dc, polite, name, audio, video, screen, makingOffer, ignoreOffer, isSettingRemoteAnswerPending, talking, audioDetector } */
const peers = new Map();
let localAudioDetector = null;

// -------------------------------------------------------------- utils --

function toast(message) {
	const el = document.createElement("div");
	el.className = "toast";
	el.textContent = message;
	dom.toastStack.appendChild(el);
	setTimeout(() => el.remove(), 3200);
}

function initials(name) {
	const trimmed = (name || "").trim();
	return trimmed ? trimmed[0].toUpperCase() : "?";
}

function setIcon(button, svg, label) {
	button.innerHTML = svg;
	if (label) button.setAttribute("aria-label", label);
}

async function copyInviteLink() {
	try {
		await navigator.clipboard.writeText(window.location.href);
		toast("Room link copied");
	} catch {
		toast("Couldn't copy — copy the URL from the address bar");
	}
}

// ---------------------------------------------------------- media utils --

function blankVideoTrack() {
	const canvas = document.createElement("canvas");
	canvas.width = 16;
	canvas.height = 16;
	const ctx = canvas.getContext("2d");
	if (ctx) {
		ctx.fillStyle = "#1a1916";
		ctx.fillRect(0, 0, 16, 16);
	}
	const stream = canvas.captureStream(5);
	return stream.getVideoTracks()[0];
}

function blankAudioTrack() {
	const AudioCtx = window.AudioContext || window.webkitAudioContext;
	const ctx = new AudioCtx();
	const oscillator = ctx.createOscillator();
	const gain = ctx.createGain();
	gain.gain.value = 0;
	oscillator.connect(gain);
	const dest = ctx.createMediaStreamDestination();
	gain.connect(dest);
	oscillator.start();
	return dest.stream.getAudioTracks()[0];
}

function describeMediaError(err, kind) {
	const name = err && err.name;
	if (name === "NotAllowedError" || name === "PermissionDeniedError") {
		return `Allow ${kind} access to appear on camera — you can still join.`;
	}
	if (name === "NotFoundError" || name === "OverconstrainedError") {
		return `No ${kind} found. You can still join the room.`;
	}
	if (name === "NotReadableError") {
		return `This ${kind} is already in use.`;
	}
	return `Could not start the ${kind}. You can still join.`;
}

/**
 * Always returns a stream with exactly one audio + one video track — a
 * real device track where available, a silent/black placeholder otherwise
 * — so every RTCPeerConnection's senders stay stable for the whole call.
 */
async function acquireMedia({ audioDeviceId, videoDeviceId } = {}) {
	const stream = new MediaStream();
	let audio = false;
	let video = false;
	let error;

	try {
		const mic = await navigator.mediaDevices.getUserMedia({
			audio: {
				echoCancellation: true,
				noiseSuppression: true,
				autoGainControl: true,
				...(audioDeviceId ? { deviceId: { exact: audioDeviceId } } : {}),
			},
			video: false,
		});
		mic.getAudioTracks().forEach((t) => stream.addTrack(t));
		audio = stream.getAudioTracks().some((t) => t.readyState === "live");
	} catch (err) {
		error = describeMediaError(err, "microphone");
	}

	try {
		const cam = await navigator.mediaDevices.getUserMedia({
			audio: false,
			video: {
				width: { ideal: 1280 },
				height: { ideal: 720 },
				facingMode: "user",
				...(videoDeviceId ? { deviceId: { exact: videoDeviceId } } : {}),
			},
		});
		cam.getVideoTracks().forEach((t) => stream.addTrack(t));
		video = stream.getVideoTracks().some((t) => t.readyState === "live");
	} catch (err) {
		error = error ?? describeMediaError(err, "camera");
	}

	if (stream.getAudioTracks().length === 0) stream.addTrack(blankAudioTrack());
	if (stream.getVideoTracks().length === 0) stream.addTrack(blankVideoTrack());

	return { stream, audio, video, error };
}

function stopStream(stream) {
	if (!stream) return;
	stream.getTracks().forEach((t) => {
		try {
			t.stop();
		} catch {
			/* ignore */
		}
	});
}

function attachSpeakingDetector(stream, onChange) {
	const track = stream.getAudioTracks().find((t) => t.readyState === "live" && t.enabled);
	if (!track || typeof AudioContext === "undefined") return null;

	let ctx;
	try {
		ctx = new (window.AudioContext || window.webkitAudioContext)();
	} catch {
		return null;
	}

	let source;
	try {
		source = ctx.createMediaStreamSource(new MediaStream([track]));
	} catch {
		void ctx.close();
		return null;
	}

	const analyser = ctx.createAnalyser();
	analyser.fftSize = 512;
	analyser.smoothingTimeConstant = 0.6;
	source.connect(analyser);
	const data = new Uint8Array(analyser.frequencyBinCount);
	let talking = false;
	let raf;
	let alive = true;

	const loop = () => {
		if (!alive) return;
		analyser.getByteFrequencyData(data);
		let sum = 0;
		for (let i = 0; i < data.length; i++) sum += data[i];
		const avg = sum / data.length;
		const next = avg > 16;
		if (next !== talking) {
			talking = next;
			onChange(talking);
		}
		raf = requestAnimationFrame(loop);
	};
	raf = requestAnimationFrame(loop);

	return {
		stop() {
			alive = false;
			cancelAnimationFrame(raf);
			try {
				source.disconnect();
			} catch {
				/* ignore */
			}
			void ctx.close();
		},
	};
}

const screenShareSupported = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;

// ------------------------------------------------------------ lobby -----

async function refreshLobbyStream() {
	const result = await acquireMedia({
		audioDeviceId: state.selectedMicId || undefined,
		videoDeviceId: state.selectedCamId || undefined,
	});
	stopStream(state.localStream);
	state.localStream = result.stream;
	state.cameraTrack = result.stream.getVideoTracks()[0] ?? null;
	state.audioEnabled = result.audio;
	state.videoEnabled = result.video;

	const audioTrack = state.localStream.getAudioTracks()[0];
	if (audioTrack) audioTrack.enabled = state.audioEnabled;
	const videoTrack = state.localStream.getVideoTracks()[0];
	if (videoTrack) videoTrack.enabled = state.videoEnabled;

	dom.previewVideo.srcObject = state.localStream;
	dom.lobbyHint.textContent = result.error || "";
	dom.lobbyHint.hidden = !result.error;

	await populateDeviceLists();
	refreshLobbyUi();
}

function refreshLobbyUi() {
	const hasVideo = state.videoEnabled && !!state.cameraTrack;
	dom.previewVideo.hidden = !hasVideo;
	dom.previewAvatarFallback.hidden = hasVideo;
	dom.previewAvatarInitial.textContent = initials(dom.nameInput.value);

	setIcon(dom.lobbyMicBtn, state.audioEnabled ? ICONS.mic : ICONS.micOff, state.audioEnabled ? "Mute" : "Unmute");
	dom.lobbyMicBtn.classList.toggle("btn-danger", !state.audioEnabled);
	dom.lobbyMicBtn.classList.toggle("btn-secondary", state.audioEnabled);

	setIcon(dom.lobbyCamBtn, state.videoEnabled ? ICONS.video : ICONS.videoOff, state.videoEnabled ? "Camera off" : "Camera on");
	dom.lobbyCamBtn.classList.toggle("btn-danger", !state.videoEnabled);
	dom.lobbyCamBtn.classList.toggle("btn-secondary", state.videoEnabled);
}

async function populateDeviceLists() {
	if (!navigator.mediaDevices?.enumerateDevices) return;
	try {
		const all = await navigator.mediaDevices.enumerateDevices();
		const mics = all.filter((d) => d.kind === "audioinput" && d.deviceId);
		const cams = all.filter((d) => d.kind === "videoinput" && d.deviceId);

		dom.micSelectWrap.hidden = mics.length <= 1;
		dom.camSelectWrap.hidden = cams.length <= 1;

		fillSelect(dom.micSelect, mics, "Default microphone");
		fillSelect(dom.camSelect, cams, "Default camera");

		if (state.selectedMicId) dom.micSelect.value = state.selectedMicId;
		if (state.selectedCamId) dom.camSelect.value = state.selectedCamId;
	} catch {
		/* enumerateDevices is best-effort */
	}
}

function fillSelect(select, devices, defaultLabel) {
	select.innerHTML = "";
	const def = document.createElement("option");
	def.value = "";
	def.textContent = defaultLabel;
	select.appendChild(def);
	devices.forEach((d, i) => {
		const option = document.createElement("option");
		option.value = d.deviceId;
		option.textContent = d.label || defaultLabel.replace("Default ", "") + ` ${i + 1}`;
		select.appendChild(option);
	});
}

function toggleLobbyMic() {
	const track = state.localStream?.getAudioTracks()[0];
	state.audioEnabled = !state.audioEnabled;
	if (track) track.enabled = state.audioEnabled;
	refreshLobbyUi();
}

function toggleLobbyCam() {
	const track = state.localStream?.getVideoTracks()[0];
	state.videoEnabled = !state.videoEnabled;
	if (track) track.enabled = state.videoEnabled;
	refreshLobbyUi();
}

function join() {
	const trimmed = dom.nameInput.value.trim().slice(0, 32) || "Guest";
	state.name = trimmed;
	try {
		window.localStorage.setItem(NAME_KEY, trimmed);
	} catch {
		/* ignore */
	}

	dom.lobby.hidden = true;
	dom.stage.classList.add("is-visible");

	// Dock icons must reflect whatever mic/cam state carried over from the
	// lobby (or a previous call in this tab) rather than whatever was last
	// drawn — icons are only touched by user action, never by state resets.
	setIcon(dom.micBtn, state.audioEnabled ? ICONS.mic : ICONS.micOff, state.audioEnabled ? "Mute microphone" : "Unmute microphone");
	dom.micBtn.classList.toggle("is-off", !state.audioEnabled);
	setIcon(dom.camBtn, state.videoEnabled ? ICONS.video : ICONS.videoOff, state.videoEnabled ? "Turn camera off" : "Turn camera on");
	dom.camBtn.classList.toggle("is-off", !state.videoEnabled);
	setIcon(dom.screenBtn, ICONS.monitor, "Share screen");
	dom.screenBtn.classList.remove("is-live");

	createLocalTile();
	connectSocket();
}

// ------------------------------------------------------------ signaling --

function connectSocket() {
	const socket = io();
	state.socket = socket;

	socket.on("connect", () => {
		state.selfId = socket.id;
		socket.emit("join-room", { room: state.roomId, name: state.name });
	});

	socket.on("joined", ({ selfId, peers: existingPeers }) => {
		state.selfId = selfId;
		existingPeers.forEach(({ id, name }) => ensurePeerConnection(id, name));
		updateStageChrome();
	});

	socket.on("peer-joined", ({ id, name }) => {
		ensurePeerConnection(id, name);
		updateStageChrome();
	});

	socket.on("peer-left", ({ id }) => removePeer(id));

	socket.on("signal", ({ from, data }) => handleSignal(from, data));

	socket.on("disconnect", () => {
		if (dom.lobby.hidden === false) return; // already left deliberately
		toast("Lost connection to the server");
	});
}

function ensurePeerConnection(peerId, remoteName) {
	if (peers.has(peerId) || peerId === state.selfId) return;

	const polite = state.selfId < peerId;
	const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
	const peer = {
		pc,
		dc: null,
		polite,
		name: remoteName || "Guest",
		audio: true,
		video: true,
		screen: false,
		makingOffer: false,
		ignoreOffer: false,
		isSettingRemoteAnswerPending: false,
		audioDetector: null,
	};
	peers.set(peerId, peer);

	if (state.localStream) {
		state.localStream.getTracks().forEach((track) => pc.addTrack(track, state.localStream));
	}

	pc.onnegotiationneeded = async () => {
		try {
			peer.makingOffer = true;
			const offer = await pc.createOffer();
			await pc.setLocalDescription(offer);
			state.socket.emit("signal", { to: peerId, data: { type: "description", description: pc.localDescription } });
		} catch (err) {
			console.error("negotiation error", err);
		} finally {
			peer.makingOffer = false;
		}
	};

	pc.onicecandidate = ({ candidate }) => {
		if (candidate) state.socket.emit("signal", { to: peerId, data: { type: "candidate", candidate } });
	};

	pc.ontrack = (event) => attachStreamToTile(peerId, event.streams[0]);

	pc.ondatachannel = (event) => {
		peer.dc = event.channel;
		wireDataChannel(peerId, event.channel);
	};

	pc.onconnectionstatechange = () => updateTileStatus(peerId, pc.connectionState);

	if (!polite) {
		const dc = pc.createDataChannel("cove-data");
		peer.dc = dc;
		wireDataChannel(peerId, dc);
	}

	createRemoteTile(peerId, peer.name);
}

async function handleSignal(peerId, data) {
	const peer = peers.get(peerId);
	if (!peer) return;

	if (data.type === "description") {
		const { pc } = peer;
		const readyForOffer = !peer.makingOffer && (pc.signalingState === "stable" || peer.isSettingRemoteAnswerPending);
		const offerCollision = data.description.type === "offer" && !readyForOffer;

		peer.ignoreOffer = !peer.polite && offerCollision;
		if (peer.ignoreOffer) return;

		try {
			if (offerCollision) await pc.setLocalDescription({ type: "rollback" });
			peer.isSettingRemoteAnswerPending = data.description.type === "answer";
			await pc.setRemoteDescription(data.description);
		} finally {
			peer.isSettingRemoteAnswerPending = false;
		}

		if (data.description.type === "offer") {
			const answer = await pc.createAnswer();
			await pc.setLocalDescription(answer);
			state.socket.emit("signal", { to: peerId, data: { type: "description", description: pc.localDescription } });
		}
	} else if (data.type === "candidate") {
		try {
			await peer.pc.addIceCandidate(data.candidate);
		} catch (err) {
			if (!peer.ignoreOffer) console.error("ICE candidate error", err);
		}
	}
}

function removePeer(peerId) {
	const peer = peers.get(peerId);
	if (!peer) return;
	peer.audioDetector?.stop();
	peer.dc?.close();
	peer.pc.close();
	peers.delete(peerId);
	document.getElementById(`tile-${peerId}`)?.remove();
	updateStageChrome();
}

// ------------------------------------------------------------ data channel --

function wireDataChannel(peerId, dc) {
	dc.onopen = () => sendPresence(peerId);
	dc.onmessage = (event) => {
		let msg;
		try {
			msg = JSON.parse(event.data);
		} catch {
			return;
		}
		handleDataMessage(peerId, msg);
	};
}

function sendPresence(peerId) {
	const peer = peers.get(peerId);
	if (!peer || peer.dc?.readyState !== "open") return;
	peer.dc.send(
		JSON.stringify({ type: "presence", audio: state.audioEnabled, video: state.videoEnabled, screen: state.screenSharing })
	);
}

function broadcastPresence() {
	peers.forEach((_peer, peerId) => sendPresence(peerId));
}

function broadcastTalking(talking) {
	peers.forEach((peer) => {
		if (peer.dc?.readyState === "open") peer.dc.send(JSON.stringify({ type: "talking", talking }));
	});
}

function handleDataMessage(peerId, msg) {
	const peer = peers.get(peerId);
	if (!peer || !msg || typeof msg !== "object") return;

	if (msg.type === "presence") {
		peer.audio = !!msg.audio;
		peer.video = !!msg.video;
		peer.screen = !!msg.screen;
		updateTileMeta(peerId, peer);
	} else if (msg.type === "talking") {
		document.getElementById(`tile-${peerId}`)?.classList.toggle("is-talking", !!msg.talking);
	} else if (msg.type === "chat" && typeof msg.text === "string") {
		appendChatMessage(peer.name, msg.text.slice(0, MAX_CHAT), false);
		if (!state.chatOpen) {
			state.unread += 1;
			updateChatBadge();
		}
	}
}

// ----------------------------------------------------------------- tiles --

function tileTemplate(id, isSelf) {
	const tile = document.createElement("div");
	tile.className = "tile" + (isSelf ? " is-self" : "");
	tile.id = `tile-${id}`;
	tile.innerHTML = `
		<video autoplay playsinline ${isSelf ? "muted" : ""}></video>
		<div class="avatar-fallback"><div class="avatar-circle">?</div></div>
		<div class="tile-footer">
			<span class="name-tag"></span>
			<span class="badges">
				<span class="badge screen-badge" hidden>${ICONS.monitor}</span>
				<span class="badge is-danger mic-badge" hidden>${ICONS.micOff}</span>
			</span>
		</div>
	`;
	return tile;
}

function createLocalTile() {
	const tile = tileTemplate("local", true);
	dom.videoGrid.appendChild(tile);

	const video = tile.querySelector("video");
	if (state.localStream) video.srcObject = state.localStream;

	tile.querySelector(".name-tag").textContent = `${state.name} · you`;
	tile.querySelector(".avatar-circle").textContent = initials(state.name);

	const hasVideo = state.videoEnabled && !!state.cameraTrack;
	video.hidden = !hasVideo;
	tile.querySelector(".avatar-fallback").hidden = hasVideo;
	tile.querySelector(".mic-badge").hidden = state.audioEnabled;

	if (state.localStream) {
		localAudioDetector = attachSpeakingDetector(state.localStream, (talking) => {
			tile.classList.toggle("is-talking", talking && state.audioEnabled);
			broadcastTalking(talking);
		});
	}

	updateStageChrome();
}

function createRemoteTile(peerId, name) {
	const tile = tileTemplate(peerId, false);
	dom.videoGrid.appendChild(tile);
	tile.querySelector(".name-tag").textContent = name || "Guest";
	tile.querySelector(".avatar-circle").textContent = initials(name);
	tile.querySelector("video").hidden = true;
	tile.querySelector(".avatar-fallback").hidden = false;
	updateTileStatus(peerId, "new");
	updateStageChrome();
}

function attachStreamToTile(peerId, stream) {
	const tile = document.getElementById(`tile-${peerId}`);
	if (!tile || !stream) return;
	const video = tile.querySelector("video");
	video.srcObject = stream;

	const peer = peers.get(peerId);
	if (peer) updateTileMeta(peerId, peer);

	if (stream.getAudioTracks().length && peer) {
		peer.audioDetector?.stop();
		peer.audioDetector = attachSpeakingDetector(stream, (talking) => {
			tile.classList.toggle("is-talking", talking && peer.audio);
		});
	}
}

function updateTileMeta(peerId, peer) {
	const tile = document.getElementById(`tile-${peerId}`);
	if (!tile) return;
	tile.querySelector(".name-tag").textContent = peer.name;
	tile.querySelector(".avatar-circle").textContent = initials(peer.name);
	tile.querySelector(".mic-badge").hidden = peer.audio;
	tile.querySelector(".screen-badge").hidden = !peer.screen;

	const video = tile.querySelector("video");
	const hasStream = video.srcObject && video.srcObject.getVideoTracks().length > 0;
	const showVideo = hasStream && (peer.video || peer.screen);
	video.hidden = !showVideo;
	tile.querySelector(".avatar-fallback").hidden = showVideo;
	if (!peer.audio) tile.classList.remove("is-talking");
}

function updateTileStatus(peerId, connectionState) {
	const tile = document.getElementById(`tile-${peerId}`);
	if (!tile) return;
	tile.querySelectorAll(".tile-status").forEach((el) => el.remove());

	if (connectionState === "connecting" || connectionState === "new") {
		const status = document.createElement("div");
		status.className = "tile-status";
		status.textContent = "Connecting";
		tile.appendChild(status);
	} else if (connectionState === "failed") {
		const status = document.createElement("div");
		status.className = "tile-status is-failed";
		status.textContent = "Couldn't reach this person — a strict network may be blocking the peer link.";
		tile.appendChild(status);
	}
}

function updateStageChrome() {
	const count = peers.size + 1;
	dom.peerCountPill.textContent = count === 1 ? "1 person" : `${count} people`;

	const bucket = count >= 5 ? "5plus" : String(count);
	dom.videoGrid.setAttribute("data-count", bucket);

	dom.waitingRow.hidden = peers.size !== 0;

	const crowded = count > MAX_PEERS;
	dom.crowdedNote.hidden = !crowded;
	if (crowded) dom.crowdedNote.textContent = `This room is getting large — quality may drop past ${MAX_PEERS} people.`;
}

// -------------------------------------------------------------- controls --

function toggleMic() {
	state.audioEnabled = !state.audioEnabled;
	const track = state.localStream?.getAudioTracks()[0];
	if (track) track.enabled = state.audioEnabled;

	setIcon(dom.micBtn, state.audioEnabled ? ICONS.mic : ICONS.micOff, state.audioEnabled ? "Mute microphone" : "Unmute microphone");
	dom.micBtn.classList.toggle("is-off", !state.audioEnabled);

	const tile = document.getElementById("tile-local");
	if (tile) {
		tile.querySelector(".mic-badge").hidden = state.audioEnabled;
		if (!state.audioEnabled) tile.classList.remove("is-talking");
	}
	broadcastPresence();
}

function toggleCam() {
	if (state.screenSharing) return;
	state.videoEnabled = !state.videoEnabled;
	const track = state.localStream?.getVideoTracks()[0];
	if (track) track.enabled = state.videoEnabled;

	setIcon(dom.camBtn, state.videoEnabled ? ICONS.video : ICONS.videoOff, state.videoEnabled ? "Turn camera off" : "Turn camera on");
	dom.camBtn.classList.toggle("is-off", !state.videoEnabled);

	const tile = document.getElementById("tile-local");
	if (tile) {
		const hasVideo = state.videoEnabled && !!state.cameraTrack;
		tile.querySelector("video").hidden = !hasVideo;
		tile.querySelector(".avatar-fallback").hidden = hasVideo;
	}
	broadcastPresence();
}

function replaceOutgoingVideoTrack(track) {
	peers.forEach((peer) => {
		const sender = peer.pc.getSenders().find((s) => s.track && s.track.kind === "video");
		if (sender) void sender.replaceTrack(track).catch(() => {});
	});
}

async function toggleScreenShare() {
	if (!screenShareSupported) return;

	if (state.screenSharing) {
		const cam = state.cameraTrack;
		replaceOutgoingVideoTrack(cam);
		if (cam) {
			const old = state.localStream.getVideoTracks()[0];
			if (old && old !== cam) {
				state.localStream.removeTrack(old);
				try {
					old.stop();
				} catch {
					/* ignore */
				}
			}
			if (!state.localStream.getTracks().includes(cam)) state.localStream.addTrack(cam);
		}
		state.screenSharing = false;
		finishScreenToggleUi();
		return;
	}

	try {
		const display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false });
		const screenTrack = display.getVideoTracks()[0];
		if (!screenTrack) return;

		replaceOutgoingVideoTrack(screenTrack);
		const old = state.localStream.getVideoTracks()[0];
		if (old) state.localStream.removeTrack(old);
		state.localStream.addTrack(screenTrack);
		state.screenSharing = true;
		finishScreenToggleUi();

		screenTrack.addEventListener(
			"ended",
			() => {
				if (state.screenSharing) toggleScreenShare();
			},
			{ once: true }
		);
	} catch {
		// user cancelled the picker
	}
}

function finishScreenToggleUi() {
	const tile = document.getElementById("tile-local");
	if (tile) {
		tile.querySelector("video").srcObject = state.localStream;
		const showVideo = state.screenSharing || (state.videoEnabled && !!state.cameraTrack);
		tile.querySelector("video").hidden = !showVideo;
		tile.querySelector(".avatar-fallback").hidden = showVideo;
	}
	setIcon(dom.screenBtn, state.screenSharing ? ICONS.monitorOff : ICONS.monitor, state.screenSharing ? "Stop sharing" : "Share screen");
	dom.screenBtn.classList.toggle("is-live", state.screenSharing);
	dom.screenBtn.classList.toggle("is-off", false);
	broadcastPresence();
}

function toggleChat(forceOpen) {
	state.chatOpen = forceOpen ?? !state.chatOpen;
	dom.chatPanel.classList.toggle("is-open", state.chatOpen);
	dom.chatBtn.classList.toggle("is-off", false);
	if (state.chatOpen) {
		state.unread = 0;
		updateChatBadge();
		dom.chatInput.focus();
	}
}

function updateChatBadge() {
	let dot = dom.chatBtn.querySelector(".unread-dot");
	if (state.unread > 0 && !state.chatOpen) {
		if (!dot) {
			dot = document.createElement("span");
			dot.className = "unread-dot";
			dom.chatBtn.appendChild(dot);
		}
	} else if (dot) {
		dot.remove();
	}
}

function submitChat(event) {
	event.preventDefault();
	const text = dom.chatInput.value.trim().slice(0, MAX_CHAT);
	if (!text) return;
	peers.forEach((peer) => {
		if (peer.dc?.readyState === "open") peer.dc.send(JSON.stringify({ type: "chat", text }));
	});
	appendChatMessage(state.name, text, true);
	dom.chatInput.value = "";
}

function appendChatMessage(name, text, isSelf) {
	dom.chatEmpty?.remove();
	const wrapper = document.createElement("div");
	wrapper.className = "chat-msg" + (isSelf ? " is-self" : "");

	const meta = document.createElement("div");
	meta.className = "chat-name";
	meta.textContent = isSelf ? "You" : name;

	const bubble = document.createElement("div");
	bubble.className = "chat-bubble";
	bubble.textContent = text;

	wrapper.appendChild(meta);
	wrapper.appendChild(bubble);
	dom.chatLog.appendChild(wrapper);
	dom.chatLog.scrollTop = dom.chatLog.scrollHeight;
}

function leaveCall() {
	state.socket?.emit("leave-room");
	state.socket?.disconnect();
	state.socket = null;

	Array.from(peers.keys()).forEach(removePeer);
	localAudioDetector?.stop();
	localAudioDetector = null;
	stopStream(state.localStream);
	state.localStream = null;
	state.cameraTrack = null;
	state.screenSharing = false;

	dom.videoGrid.innerHTML = "";
	dom.chatLog.innerHTML = '<p class="chat-empty" id="chatEmpty">Messages stay in this room, on this device.</p>';
	dom.chatEmpty = $("chatEmpty");
	state.unread = 0;
	toggleChat(false);

	dom.stage.classList.remove("is-visible");
	dom.lobby.hidden = false;
	state.audioEnabled = true;
	state.videoEnabled = true;
	refreshLobbyStream();
}

// ------------------------------------------------------------------ init --

function parseRoomId() {
	const match = window.location.pathname.match(/^\/r\/([^/]+)$/);
	return match ? decodeURIComponent(match[1]) : null;
}

function init() {
	const roomId = parseRoomId();
	if (!roomId) {
		window.location.href = "/";
		return;
	}
	state.roomId = roomId;
	dom.lobbyRoomPath.textContent = `/${roomId}`;
	dom.activeRoomPath.textContent = `/${roomId}`;
	document.title = `${roomId} — Cove`;

	let savedName = "";
	try {
		savedName = window.localStorage.getItem(NAME_KEY) || "";
	} catch {
		/* ignore */
	}
	dom.nameInput.value = savedName;

	dom.joinBtn.textContent = "Join";

	dom.lobbyMicBtn.addEventListener("click", toggleLobbyMic);
	dom.lobbyCamBtn.addEventListener("click", toggleLobbyCam);
	dom.nameInput.addEventListener("input", () => {
		dom.previewAvatarInitial.textContent = initials(dom.nameInput.value);
	});
	dom.nameInput.addEventListener("keydown", (e) => {
		if (e.key === "Enter") join();
	});
	dom.micSelect.addEventListener("change", () => {
		state.selectedMicId = dom.micSelect.value;
		refreshLobbyStream();
	});
	dom.camSelect.addEventListener("change", () => {
		state.selectedCamId = dom.camSelect.value;
		refreshLobbyStream();
	});
	dom.joinBtn.addEventListener("click", join);

	dom.copyLinkBtn.addEventListener("click", copyInviteLink);
	dom.waitingCopyBtn.addEventListener("click", copyInviteLink);
	dom.dockCopyBtn.addEventListener("click", copyInviteLink);

	dom.micBtn.addEventListener("click", toggleMic);
	dom.camBtn.addEventListener("click", toggleCam);
	dom.screenBtn.addEventListener("click", toggleScreenShare);
	dom.chatBtn.addEventListener("click", () => toggleChat());
	dom.chatCloseBtn.addEventListener("click", () => toggleChat(false));
	dom.leaveBtn.addEventListener("click", leaveCall);

	dom.chatForm.addEventListener("submit", submitChat);
	dom.chatInput.addEventListener("keydown", (e) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			submitChat(e);
		}
	});

	setIcon(dom.micBtn, ICONS.mic, "Mute microphone");
	setIcon(dom.camBtn, ICONS.video, "Turn camera off");
	setIcon(dom.screenBtn, ICONS.monitor, "Share screen");
	setIcon(dom.chatBtn, ICONS.chat, "Toggle chat");
	setIcon(dom.dockCopyBtn, ICONS.link, "Copy room link");
	setIcon(dom.leaveBtn, ICONS.leave, "Leave call");
	if (!screenShareSupported) dom.screenBtn.hidden = true;

	refreshLobbyStream();
}

document.addEventListener("DOMContentLoaded", init);
