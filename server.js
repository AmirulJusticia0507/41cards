const path = require("path");
const crypto = require("crypto");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const rooms = new Map();
const suits = ["spades", "hearts", "diamonds", "clubs"];
const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

app.use(express.static(__dirname));

function cleanName(value) {
  return String(value || "Pemain").trim().slice(0, 18) || "Pemain";
}

function roomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  while (rooms.has(code));
  return code;
}

function makeDeck() {
  const deck = suits.flatMap((suit) => ranks.map((rank) => ({ suit, rank })));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function value(rank) {
  if (rank === "A") return 11;
  return ["J", "Q", "K"].includes(rank) ? 10 : Number(rank);
}

function score(hand) {
  const totals = Object.fromEntries(suits.map((suit) => [suit, 0]));
  hand.forEach((card) => totals[card.suit] += value(card.rank));
  return Math.max(...Object.values(totals), 0);
}

function publicState(room, socket) {
  const me = room.players.find((player) => player.socketId === socket.id);
  const spectator = !me;
  return {
    code: room.code,
    status: room.status,
    maxPlayers: room.maxPlayers,
    host: me?.key === room.hostKey,
    spectator,
    playerKey: me?.key,
    me: me ? { name: me.name, hand: me.hand, score: score(me.hand) } : null,
    players: room.players.map((player, index) => ({
      name: player.name,
      cardCount: player.hand.length,
      connected: player.connected,
      current: index === room.current,
      score: room.status === "finished" ? score(player.hand) : undefined,
      hand: room.status === "finished" ? player.hand : undefined,
      you: player.socketId === socket.id,
    })),
    deckCount: room.deck.length,
    discard: room.discard.at(-1) || null,
    phase: me && room.current === room.players.indexOf(me) ? room.phase : "waiting",
    currentName: room.players[room.current]?.name || "-",
    winners: room.winners || [],
  };
}

function broadcast(room) {
  io.to(room.code).fetchSockets().then((sockets) => sockets.forEach((socket) => socket.emit("state", publicState(room, socket))));
}

function finish(room) {
  room.status = "finished";
  const best = Math.max(...room.players.map((player) => score(player.hand)));
  room.winners = room.players.filter((player) => score(player.hand) === best).map((player) => player.name);
  broadcast(room);
}

function startRound(room) {
  if (room.players.length < 2) return false;
  room.deck = makeDeck();
  room.discard = [];
  room.current = 0;
  room.phase = "draw";
  room.winners = [];
  room.players.forEach((player) => { player.hand = []; });
  for (let round = 0; round < 4; round++) room.players.forEach((player) => player.hand.push(room.deck.pop()));
  room.discard.push(room.deck.pop());
  room.status = "playing";
  broadcast(room);
  return true;
}

function nextTurn(room) {
  if (!room.deck.length) return finish(room);
  let attempts = 0;
  do {
    room.current = (room.current + 1) % room.players.length;
    attempts++;
  } while (!room.players[room.current].connected && attempts <= room.players.length);
  if (attempts > room.players.length) return finish(room);
  room.phase = "draw";
  broadcast(room);
}

io.on("connection", (socket) => {
  socket.on("create-room", ({ name, maxPlayers, playerKey } = {}, reply) => {
    const code = roomCode();
    const key = String(playerKey || crypto.randomUUID());
    const room = {
      code,
      maxPlayers: Math.min(8, Math.max(2, Number(maxPlayers) || 4)),
      hostKey: key,
      status: "waiting",
      players: [{ key, socketId: socket.id, name: cleanName(name), hand: [], connected: true }],
      spectators: new Set(), deck: [], discard: [], current: 0, phase: "draw", winners: [],
    };
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    reply?.({ ok: true, code, playerKey: key });
    broadcast(room);
  });

  socket.on("join-room", ({ code, name, playerKey, spectator = false } = {}, reply) => {
    code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return reply?.({ ok: false, error: "Room tidak ditemukan." });
    if (spectator) {
      room.spectators.add(socket.id);
    } else {
      const returning = room.players.find((player) => player.key === playerKey);
      if (returning) {
        returning.socketId = socket.id;
        returning.connected = true;
        returning.name = cleanName(name || returning.name);
      } else {
        if (room.status !== "waiting") return reply?.({ ok: false, error: "Permainan sudah dimulai. Masuk sebagai penonton." });
        if (room.players.length >= room.maxPlayers) return reply?.({ ok: false, error: "Room sudah penuh." });
        playerKey = String(playerKey || crypto.randomUUID());
        room.players.push({ key: playerKey, socketId: socket.id, name: cleanName(name), hand: [], connected: true });
      }
    }
    socket.join(code);
    socket.data.roomCode = code;
    reply?.({ ok: true, code, playerKey: spectator ? null : playerKey });
    broadcast(room);
  });

  socket.on("start-round", () => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.find((item) => item.socketId === socket.id);
    if (!room || player?.key !== room.hostKey || !["waiting", "finished"].includes(room.status)) return;
    if (!startRound(room)) socket.emit("notice", "Minimal dua pemain untuk memulai.");
  });

  socket.on("draw-card", (source) => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players[room.current];
    if (!room || room.status !== "playing" || player?.socketId !== socket.id || room.phase !== "draw") return;
    const pile = source === "discard" ? room.discard : room.deck;
    if (!pile.length) return;
    player.hand.push(pile.pop());
    room.phase = "discard";
    broadcast(room);
  });

  socket.on("discard-card", (index) => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players[room.current];
    if (!room || room.status !== "playing" || player?.socketId !== socket.id || room.phase !== "discard") return;
    index = Number(index);
    if (!Number.isInteger(index) || index < 0 || index >= player.hand.length) return;
    room.discard.push(player.hand.splice(index, 1)[0]);
    if (score(player.hand) === 41) return finish(room);
    nextTurn(room);
  });

  socket.on("leave-room", (reply) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return reply?.({ ok: true });
    room.spectators.delete(socket.id);
    const index = room.players.findIndex((player) => player.socketId === socket.id);
    if (index >= 0) {
      const [leaving] = room.players.splice(index, 1);
      if (leaving.key === room.hostKey) room.hostKey = room.players[0]?.key || null;
      if (room.status === "playing") {
        if (room.players.length < 2) finish(room);
        else {
          if (index < room.current) room.current--;
          else if (index === room.current) {
            if (room.current >= room.players.length) room.current = 0;
            room.phase = "draw";
          }
        }
      }
    }
    socket.leave(room.code);
    socket.data.roomCode = null;
    reply?.({ ok: true });
    if (!room.players.length && !room.spectators.size) rooms.delete(room.code);
    else broadcast(room);
  });

  socket.on("disconnect", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    room.spectators.delete(socket.id);
    const player = room.players.find((item) => item.socketId === socket.id);
    if (player) player.connected = false;
    if (room.status === "playing" && room.players[room.current] === player) nextTurn(room);
    else broadcast(room);
  });
});

const port = process.env.PORT || 5500;
server.listen(port, () => console.log(`41 Cards berjalan di http://localhost:${port}`));
