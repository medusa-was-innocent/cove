"use strict";

// Same word lists and shape as the original Cove prototype's room-name
// generator: adjective + noun + a short random tail, so a fresh room reads
// like "quiet-harbor-4f2" instead of an opaque id.
const ADJECTIVES = [
	"quiet",
	"bright",
	"still",
	"open",
	"warm",
	"clear",
	"soft",
	"wild",
	"calm",
	"swift",
	"pale",
	"keen",
	"amber",
	"silver",
	"dusk",
	"tide",
];

const NOUNS = [
	"harbor",
	"meadow",
	"inlet",
	"ridge",
	"grove",
	"dune",
	"atoll",
	"creek",
	"bluff",
	"marsh",
	"copse",
	"fjord",
	"cove",
	"haven",
	"nook",
	"reef",
];

const ROOM_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function isValidRoomId(id) {
	return typeof id === "string" && ROOM_RE.test(id);
}

/** Lowercase, dashes, 1-64 chars matching the signaling id contract. */
function slugifyRoom(raw) {
	return String(raw ?? "")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, "-")
		.replace(/-{2,}/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64);
}

function randomRoomId() {
	const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
	const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
	const tail = Math.random().toString(36).slice(2, 5);
	return `${adj}-${noun}-${tail}`;
}

module.exports = { isValidRoomId, slugifyRoom, randomRoomId };
