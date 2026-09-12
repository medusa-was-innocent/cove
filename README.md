# Cove

A free, peer-to-peer group video call for the web. No signups, no
downloads — share a link and you're talking.

This is a from-scratch rebuild of the original Cove prototype, keeping its
design (colors, type, layout, copy) but running on a simpler, self-contained
signaling backend: one long-lived Node process with a persistent WebSocket
connection per browser, instead of HTTP polling against a database. See
"What changed from the original prototype" below for why.

## Running it locally

```bash
npm install
npm start
```

Then open `http://localhost:3000`. Open the same room link in a second tab
to test a call with yourself. Set `PORT` to change the port (default 3000).

## How it's put together

```
server.js         Express app + Socket.IO signaling server
lib/roomId.js     Room-name word lists, slug validation, random ids
public/
  index.html      Landing page
  room.html        Lobby + in-call screen (one page, two states)
  invalid.html     "That room name isn't valid" page
  404.html
  css/style.css
  js/room.js        All WebRTC + chat + UI logic
```

The server only ever exchanges small signaling messages — room roster, SDP
offers/answers, ICE candidates. It never sees video, audio, or chat content;
once a connection is up, everything flows directly between browsers.

Every local media stream always carries exactly one audio track and one
video track — a real device track, or a silent/black placeholder when a
camera or mic isn't available. That keeps each peer connection's senders
stable from the first handshake, so muting, camera-off, and screen sharing
are all just `track.enabled` flips or `replaceTrack()` calls — nothing
needs to renegotiate mid-call.

Connections use "perfect negotiation": for each pair, whichever peer id
sorts first (alphabetically) is "polite" and yields on a collision, so both
sides agree on the same role without extra coordination or a strict
join-order dependency.

## What changed from the original prototype

The original signaling backend polled an HTTP endpoint backed by a
database — real Postgres (Neon) when deployed with `DATABASE_URL` set, and
an embedded, **in-memory, per-process** database (PGLite) otherwise. That's
a reasonable default for a single always-on server, but it's a common
failure mode on serverless/edge hosting: if two visitors' requests land on
different server instances (or a cold start resets the in-memory store
between requests), each side polls a roster the other was never written
into — they never learn about each other, and the call never connects,
even though the WebRTC handshake code itself is sound.

This rebuild sidesteps that class of bug by using a single Node process
holding a persistent WebSocket (Socket.IO) connection per browser, with
roster state in that same process's memory — no polling, no separate
database, nothing that can fall out of sync between two visitors as long as
the one process is running. The tradeoff is the usual one for in-memory
state: it resets if the process restarts, and it doesn't horizontally scale
to multiple server instances without adding shared state back in (e.g.
Redis) — fine for a single instance, worth knowing if you ever deploy this
behind a multi-instance/serverless setup.

## Known limitations

- **STUN only, no TURN server.** NAT traversal relies on public STUN
  servers. Most networks work fine; very restrictive/symmetric NATs (some
  corporate networks) may fail to connect peer-to-peer without a TURN
  relay (e.g. coturn) as a fallback.
- **In-memory signaling state**, as above — resets on restart, single
  instance only.
- **No hard cap on room size** — matching the original design, the app
  just shows a "getting large" notice past 8 people rather than blocking
  anyone. A full mesh still costs more bandwidth per person added, so very
  large rooms will feel it first on the weakest connection in the room.
