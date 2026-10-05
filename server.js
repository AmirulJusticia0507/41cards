const path = require("path");
const crypto = require("crypto");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { path: "/socket.io" });
const rooms = new Map();
const suits = ["spades", "hearts", "diamonds", "clubs"];
const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

app.use(express.static(path.join(__dirname, "public")));

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

function pokerFive(cards) {
  const faceValues = { J: 11, Q: 12, K: 13, A: 14 };
  const values = cards.map((card) => faceValues[card.rank] || Number(card.rank)).sort((a, b) => b - a);
  const counts = [...new Set(values)].map((value) => [values.filter((item) => item === value).length, value]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const unique = [...new Set(values)];
  if (unique[0] === 14) unique.push(1);
  let straight = 0;
  for (let i = 0; i <= unique.length - 5; i++) if (unique[i] - unique[i + 4] === 4) straight = Math.max(straight, unique[i]);
  const flush = cards.every((card) => card.suit === cards[0].suit);
  if (straight && flush) return [8, straight];
  if (counts[0][0] === 4) return [7, counts[0][1], counts[1][1]];
  if (counts[0][0] === 3 && counts[1][0] === 2) return [6, counts[0][1], counts[1][1]];
  if (flush) return [5, ...values];
  if (straight) return [4, straight];
  if (counts[0][0] === 3) return [3, counts[0][1], ...counts.slice(1).map((item) => item[1]).sort((a, b) => b - a)];
  if (counts[0][0] === 2 && counts[1][0] === 2) return [2, Math.max(counts[0][1], counts[1][1]), Math.min(counts[0][1], counts[1][1]), counts[2][1]];
  if (counts[0][0] === 2) return [1, counts[0][1], ...counts.slice(1).map((item) => item[1]).sort((a, b) => b - a)];
  return [0, ...values];
}

function pokerHand(cards) {
  let best = null;
  for (let a = 0; a < cards.length - 4; a++) for (let b = a + 1; b < cards.length - 3; b++) for (let c = b + 1; c < cards.length - 2; c++) for (let d = c + 1; d < cards.length - 1; d++) for (let e = d + 1; e < cards.length; e++) {
    const hand = pokerFive([cards[a], cards[b], cards[c], cards[d], cards[e]]);
    if (!best || comparePoker(hand, best) > 0) best = hand;
  }
  return best;
}

function comparePoker(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0);
  return 0;
}

function publicState(room, socket) {
  const me = room.players.find((player) => player.socketId === socket.id);
  const spectator = !me;
  return {
    code: room.code,
    gameType: room.gameType,
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
      folded: player.folded || false,
      acted: room.acted?.has(player.key) || false,
      current: index === room.current,
      score: room.status === "finished" ? score(player.hand) : undefined,
      hand: room.status === "finished" ? player.hand : undefined,
      you: player.socketId === socket.id,
    })),
    deckCount: room.deck.length,
    discard: room.discard.at(-1) || null,
    phase: room.gameType === "poker"
      ? (me && !me.folded && !room.acted?.has(me.key) && room.status === "playing" ? "poker-action" : "waiting")
      : (me && room.current === room.players.indexOf(me) ? room.phase : "waiting"),
    currentName: room.gameType === "poker" ? "semua pemain" : (room.players[room.current]?.name || "-"),
    winners: room.winners || [],
    community: (room.community || []).slice(0, room.revealed || 0),
    pokerStage: room.pokerStage,
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

function finishPoker(room) {
  room.status = "finished";
  const active = room.players.filter((player) => !player.folded);
  if (active.length <= 1) room.winners = active.map((player) => player.name);
  else {
    const ranked = active.map((player) => ({ player, hand: pokerHand([...player.hand, ...room.community]) }));
    const best = ranked.reduce((winner, item) => comparePoker(item.hand, winner.hand) > 0 ? item : winner);
    room.winners = ranked.filter((item) => comparePoker(item.hand, best.hand) === 0).map((item) => item.player.name);
  }
  room.revealed = 5;
  broadcast(room);
}

function settlePoker(room) {
  const active = room.players.filter((player) => !player.folded && player.connected);
  if (active.length <= 1) return finishPoker(room);
  if (active.every((player) => room.acted.has(player.key))) {
    room.acted.clear();
    if (room.revealed === 0) { room.revealed = 3; room.pokerStage = "Flop"; }
    else if (room.revealed === 3) { room.revealed = 4; room.pokerStage = "Turn"; }
    else if (room.revealed === 4) { room.revealed = 5; room.pokerStage = "River"; }
    else return finishPoker(room);
  }
  broadcast(room);
}

function startRound(room) {
  if (room.players.length < 2) return false;
  room.deck = makeDeck();
  room.discard = [];
  room.current = 0;
  room.phase = "draw";
  room.winners = [];
  room.players.forEach((player) => { player.hand = []; player.folded = false; });
  if (room.gameType === "poker") {
    for (let round = 0; round < 2; round++) room.players.forEach((player) => player.hand.push(room.deck.pop()));
    room.community = Array.from({ length: 5 }, () => room.deck.pop());
    room.revealed = 0;
    room.pokerStage = "Pre-flop";
    room.acted = new Set();
    room.phase = "poker-action";
  } else {
    for (let round = 0; round < 4; round++) room.players.forEach((player) => player.hand.push(room.deck.pop()));
    room.discard.push(room.deck.pop());
  }
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
  socket.on("create-room", ({ name, maxPlayers, playerKey, gameType } = {}, reply) => {
    const code = roomCode();
    const key = String(playerKey || crypto.randomUUID());
    const room = {
      code,
      gameType: gameType === "poker" ? "poker" : "41",
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

  socket.on("poker-action", (action) => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.find((item) => item.socketId === socket.id);
    if (!room || room.gameType !== "poker" || room.status !== "playing" || !player || player.folded || room.acted.has(player.key)) return;
    if (action === "fold") player.folded = true;
    room.acted.add(player.key);
    settlePoker(room);
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
        if (room.players.length < 2) room.gameType === "poker" ? finishPoker(room) : finish(room);
        else if (room.gameType === "poker") settlePoker(room);
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
    if (room.status === "playing" && room.gameType === "poker" && player) { player.folded = true; settlePoker(room); }
    else if (room.status === "playing" && room.players[room.current] === player) nextTurn(room);
    else broadcast(room);
  });
});

const port = process.env.PORT || 5500;
if (require.main === module) server.listen(port, () => console.log(`41 Cards berjalan di http://localhost:${port}`));

module.exports = server;
