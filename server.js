"use strict";

const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const { isValidRoomId, randomRoomId } = require("./lib/roomId");

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

// Hand out a fresh room id and send the browser straight into it.
app.get("/new", (req, res) => {
	res.redirect(`/r/${randomRoomId()}`);
});

// The room page is a static file; the room id lives in the URL and is read
// client-side. A malformed id gets the "that room name isn't valid" page
// instead of a broken lobby.
app.get("/r/:roomId", (req, res) => {
	if (!isValidRoomId(req.params.roomId)) {
		return res.status(404).sendFile(path.join(__dirname, "public", "invalid.html"));
	}
	res.sendFile(path.join(__dirname, "public", "room.html"));
});

app.use((req, res) => {
	res.status(404).sendFile(path.join(__dirname, "public", "404.html"));
});

/**
 * In-memory signaling state. Nothing here ever touches audio, video, or
 * chat content - those travel directly between browsers over WebRTC. The
 * server's only job is introducing peers to each other, for as long as the
 * process stays up.
 *
 * rooms: Map<roomId, Map<socketId, { name }>>
 */
const rooms = new Map();

const roomOf = (socket) => socket.data.room;

function leaveCurrentRoom(socket) {
	const roomId = roomOf(socket);
	if (!roomId) return;

	const peers = rooms.get(roomId);
	if (peers) {
		peers.delete(socket.id);
		if (peers.size === 0) rooms.delete(roomId);
	}

	socket.to(roomId).emit("peer-left", { id: socket.id });
	socket.leave(roomId);
	socket.data.room = null;
}

io.on("connection", (socket) => {
	socket.on("join-room", ({ room, name } = {}) => {
		if (!isValidRoomId(room)) return;
		if (roomOf(socket)) return; // already in a room on this connection

		const displayName = typeof name === "string" ? name.slice(0, 32) : "";

		if (!rooms.has(room)) rooms.set(room, new Map());
		const peers = rooms.get(room);

		// Tell the newcomer who's already here...
		const existingPeers = Array.from(peers.entries()).map(([id, data]) => ({ id, name: data.name }));
		socket.emit("joined", { selfId: socket.id, peers: existingPeers });

		// ...and tell everyone already here that the newcomer arrived.
		socket.to(room).emit("peer-joined", { id: socket.id, name: displayName });

		peers.set(socket.id, { name: displayName });
		socket.join(room);
		socket.data.room = room;
	});

	// Relay for SDP offers/answers and ICE candidates. Only forwarded between
	// sockets confirmed to share a room, so a client can't use this to poke
	// at arbitrary connections elsewhere on the server.
	socket.on("signal", ({ to, data } = {}) => {
		const room = roomOf(socket);
		if (!room || typeof to !== "string") return;

		const peers = rooms.get(room);
		if (!peers || !peers.has(to)) return;

		io.to(to).emit("signal", { from: socket.id, data });
	});

	socket.on("leave-room", () => leaveCurrentRoom(socket));
	socket.on("disconnect", () => leaveCurrentRoom(socket));
});

server.listen(PORT, () => {
	console.log(`Cove server listening on http://localhost:${PORT}`);
});
