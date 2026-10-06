const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { path: "/socket.io" });
const rooms = new Map();
const database = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, max: 2, idleTimeoutMillis: 10000 }) : null;
const ROOM_TTL_SECONDS = 7200;
let databaseReady;
const suits = ["spades", "hearts", "diamonds", "clubs"];
const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const STARTING_CHIPS = 1000;
const SMALL_BLIND = 10;
const BIG_BLIND = 20;
const BOT_DELAY_MS = 250;

function randomBotName(existingNames = new Set()) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let name;
  do name = `CPU-${Array.from({ length: 4 }, () => chars[crypto.randomInt(chars.length)]).join("")}`;
  while (existingNames.has(name));
  return name;
}

function storedRoom(room) {
  return { ...room, spectators: [...room.spectators], acted: room.acted ? [...room.acted] : null };
}

function restoredRoom(data) {
  return data && { ...data, spectators: new Set(data.spectators || []), acted: data.acted ? new Set(data.acted) : undefined };
}

async function saveRoom(room) {
  rooms.set(room.code, room);
  if (!database) return;
  await ensureDatabase();
  await database.query(
    `INSERT INTO game_rooms (code, state, expires_at) VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 second'))
     ON CONFLICT (code) DO UPDATE SET state = EXCLUDED.state, expires_at = EXCLUDED.expires_at`,
    [room.code, storedRoom(room), ROOM_TTL_SECONDS],
  );
}

async function loadRoom(code, fresh = false) {
  if (!fresh && rooms.has(code)) return rooms.get(code);
  if (!database) return rooms.get(code);
  await ensureDatabase();
  const result = await database.query("SELECT state FROM game_rooms WHERE code = $1 AND expires_at > NOW()", [code]);
  const room = restoredRoom(result.rows[0]?.state);
  if (room) rooms.set(code, room);
  return room;
}

async function deleteRoom(code) {
  rooms.delete(code);
  if (database) {
    await ensureDatabase();
    await database.query("DELETE FROM game_rooms WHERE code = $1", [code]);
  }
}

function ensureDatabase() {
  if (!database) return Promise.resolve();
  databaseReady ||= database.query(`
    CREATE TABLE IF NOT EXISTS game_rooms (
      code VARCHAR(5) PRIMARY KEY,
      state JSONB NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS game_rooms_expires_at_idx ON game_rooms (expires_at);
  `);
  return databaseReady;
}

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
    const j = crypto.randomInt(i + 1);
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

function pokerHandName(hand) {
  if (!hand) return "Menang karena semua lawan fold";
  if (hand[0] === 8 && hand[1] === 14) return "Royal Flush";
  return ["High Card", "One Pair", "Two Pair", "Three of a Kind", "Straight", "Flush", "Full House", "Four of a Kind", "Straight Flush"][hand[0]];
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
      bot: player.bot || false,
      chips: player.chips || 0,
      bet: player.bet || 0,
      allIn: player.allIn || false,
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
    winningHand: room.winningHand || null,
    community: (room.community || []).slice(0, room.revealed || 0),
    pokerStage: room.pokerStage,
    pot: room.pot || 0,
    currentBet: room.currentBet || 0,
    toCall: me ? Math.max(0, (room.currentBet || 0) - (me.bet || 0)) : 0,
  };
}

function broadcast(room) {
  saveRoom(room).catch((error) => console.error("Gagal menyimpan room:", error.message));
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
  if (active.length <= 1) {
    room.winners = active.map((player) => player.name);
    room.winningHand = pokerHandName(null);
  }
  else {
    const ranked = active.map((player) => ({ player, hand: pokerHand([...player.hand, ...room.community]) }));
    const best = ranked.reduce((winner, item) => comparePoker(item.hand, winner.hand) > 0 ? item : winner);
    room.winners = ranked.filter((item) => comparePoker(item.hand, best.hand) === 0).map((item) => item.player.name);
    room.winningHand = pokerHandName(best.hand);
  }
  const winners = room.players.filter((player) => room.winners.includes(player.name));
  if (winners.length) {
    const share = Math.floor(room.pot / winners.length);
    winners.forEach((winner) => { winner.chips += share; });
    winners[0].chips += room.pot - share * winners.length;
  }
  room.pot = 0;
  room.revealed = 5;
  broadcast(room);
}

function settlePoker(room) {
  const active = room.players.filter((player) => !player.folded && player.connected);
  if (active.length <= 1) return finishPoker(room);
  const settled = active.every((player) => player.allIn || (room.acted.has(player.key) && player.bet === room.currentBet));
  if (settled) {
    room.acted.clear();
    room.players.forEach((player) => { player.bet = 0; });
    room.currentBet = 0;
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
  room.players.forEach((player) => { player.hand = []; player.folded = false; player.bet = 0; player.allIn = false; });
  if (room.gameType === "poker") {
    if (room.players.filter((player) => player.chips > 0).length < 2) room.players.forEach((player) => { player.chips = STARTING_CHIPS; });
    room.players.forEach((player) => { player.folded = player.chips <= 0; });
    for (let round = 0; round < 2; round++) room.players.forEach((player) => player.hand.push(room.deck.pop()));
    room.community = Array.from({ length: 5 }, () => room.deck.pop());
    room.revealed = 0;
    room.pokerStage = "Pre-flop";
    room.winningHand = null;
    room.acted = new Set();
    room.pot = 0;
    room.currentBet = 0;
    room.dealer = ((room.dealer ?? -1) + 1) % room.players.length;
    const eligible = room.players.map((player, index) => ({ player, index })).filter(({ player }) => !player.folded);
    const afterDealer = [...eligible.filter(({ index }) => index > room.dealer), ...eligible.filter(({ index }) => index <= room.dealer)];
    const postBlind = (player, amount) => {
      const paid = Math.min(player.chips, amount);
      player.chips -= paid; player.bet += paid; room.pot += paid;
      if (!player.chips) player.allIn = true;
      room.currentBet = Math.max(room.currentBet, player.bet);
    };
    postBlind(afterDealer[0].player, SMALL_BLIND);
    postBlind(afterDealer[1 % afterDealer.length].player, BIG_BLIND);
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
  if (room.players[room.current].bot) setTimeout(() => playBot41(room), BOT_DELAY_MS);
}

function bestDiscard(hand) {
  let bestIndex = 0;
  let bestScore = -1;
  hand.forEach((_, index) => {
    const candidate = score(hand.filter((card, cardIndex) => cardIndex !== index));
    if (candidate > bestScore) { bestScore = candidate; bestIndex = index; }
  });
  return bestIndex;
}

function playBot41(room) {
  if (room.status !== "playing") return;
  const bot = room.players[room.current];
  if (!bot?.bot) return;
  const topDiscard = room.discard.at(-1);
  const testHand = topDiscard ? [...bot.hand, topDiscard] : bot.hand;
  const useDiscard = topDiscard && score(testHand.filter((_, index) => index !== bestDiscard(testHand))) > score(bot.hand);
  const drawn = useDiscard ? room.discard.pop() : room.deck.pop();
  if (!drawn) return finish(room);
  bot.hand.push(drawn);
  room.discard.push(bot.hand.splice(bestDiscard(bot.hand), 1)[0]);
  if (score(bot.hand) === 41) return finish(room);
  nextTurn(room);
}

function playPokerBots(room) {
  room.players.filter((player) => player.bot && !player.folded && !room.acted.has(player.key)).forEach((bot) => {
    const due = Math.max(0, room.currentBet - bot.bet);
    const foldChance = room.revealed === 0 ? 18 : 10;
    if (due > 0 && crypto.randomInt(100) < foldChance && room.players.filter((player) => !player.folded).length > 2) bot.folded = true;
    else {
      const payment = Math.min(bot.chips, due);
      bot.chips -= payment;
      bot.bet += payment;
      room.pot += payment;
      if (!bot.chips) bot.allIn = true;
    }
    room.acted.add(bot.key);
  });
}

io.on("connection", (socket) => {
  socket.on("create-room", ({ name, maxPlayers, playerKey, gameType, opponentMode } = {}, reply) => {
    const code = roomCode();
    const key = String(playerKey || crypto.randomUUID());
    const capacity = Math.min(8, Math.max(2, Number(maxPlayers) || 4));
    const room = {
      code,
      gameType: gameType === "poker" ? "poker" : "41",
      opponentMode: opponentMode === "cpu" ? "cpu" : "online",
      maxPlayers: capacity,
      hostKey: key,
      status: "waiting",
      players: [{ key, socketId: socket.id, name: cleanName(name), hand: [], connected: true, chips: STARTING_CHIPS }],
      spectators: new Set(), deck: [], discard: [], current: 0, phase: "draw", winners: [],
    };
    if (room.opponentMode === "cpu") {
      const names = new Set(room.players.map((player) => player.name));
      for (let index = 0; index < capacity - 1; index++) {
        const botName = randomBotName(names);
        names.add(botName);
        room.players.push({ key: `bot-${crypto.randomUUID()}`, socketId: null, name: botName, hand: [], connected: true, bot: true, chips: STARTING_CHIPS });
      }
    }
    saveRoom(room).catch((error) => console.error("Gagal menyimpan room:", error.message));
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerKey = key;
    reply?.({ ok: true, code, playerKey: key });
    broadcast(room);
  });

  socket.on("join-room", async ({ code, name, playerKey, spectator = false } = {}, reply) => {
    code = String(code || "").trim().toUpperCase();
    const room = await loadRoom(code, true);
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
        room.players.push({ key: playerKey, socketId: socket.id, name: cleanName(name), hand: [], connected: true, chips: STARTING_CHIPS });
      }
    }
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerKey = spectator ? null : playerKey;
    reply?.({ ok: true, code, playerKey: spectator ? null : playerKey });
    broadcast(room);
  });

  socket.on("sync-room", async () => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = await loadRoom(code, true);
    if (!room) return socket.emit("room-expired");
    const player = room.players.find((item) => item.key === socket.data.playerKey);
    if (player) { player.socketId = socket.id; player.connected = true; }
    rooms.set(code, room);
    socket.emit("state", publicState(room, socket));
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
    const type = typeof action === "string" ? action : action?.type;
    if (type === "fold") player.folded = true;
    else {
      const due = Math.max(0, room.currentBet - player.bet);
      let payment = due;
      if (type === "raise") payment += Math.min(20, Math.max(0, player.chips - due));
      if (type === "all-in") payment = player.chips;
      payment = Math.min(player.chips, payment);
      player.chips -= payment;
      player.bet += payment;
      room.pot += payment;
      if (!player.chips) player.allIn = true;
      if (player.bet > room.currentBet) {
        room.currentBet = player.bet;
        room.acted.clear();
      }
    }
    room.acted.add(player.key);
    playPokerBots(room);
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
      if (room.opponentMode === "cpu" && !room.players.some((player) => !player.bot)) {
        socket.leave(room.code);
        socket.data.roomCode = null;
        deleteRoom(room.code).catch((error) => console.error("Gagal menghapus room:", error.message));
        return reply?.({ ok: true });
      }
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
    if (!room.players.length && !room.spectators.size) deleteRoom(room.code).catch((error) => console.error("Gagal menghapus room:", error.message));
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
