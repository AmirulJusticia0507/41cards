const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { io } = require("socket.io-client");

const port = 3200 + Math.floor(Math.random() * 500);
const server = spawn(process.execPath, ["server.js"], { env: { ...process.env, PORT: port }, stdio: "ignore" });
const clients = [];
before(() => new Promise((resolve) => setTimeout(resolve, 1500)));
after(() => { clients.forEach((client) => client.close()); server.kill(); });

function client() {
  const socket = io(`http://127.0.0.1:${port}`, { reconnection: false });
  clients.push(socket);
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

function emit(socket, event, data) {
  return new Promise((resolve) => socket.emit(event, data, resolve));
}

function state(socket, condition) {
  return new Promise((resolve) => {
    const handler = (value) => { if (condition(value)) { socket.off("state", handler); resolve(value); } };
    socket.on("state", handler);
  });
}

test("dua pemain dapat bergabung dan kartu lawan tetap rahasia", async () => {
  const host = await client();
  const guest = await client();
  const created = await emit(host, "create-room", { name: "Host", maxPlayers: 4 });
  assert.equal(created.ok, true);
  const joined = await emit(guest, "join-room", { code: created.code, name: "Tamu" });
  assert.equal(joined.ok, true);
  const hostPlaying = state(host, (value) => value.status === "playing");
  const guestPlaying = state(guest, (value) => value.status === "playing");
  host.emit("start-round");
  const [hostState, guestState] = await Promise.all([hostPlaying, guestPlaying]);
  assert.equal(hostState.me.hand.length, 4);
  assert.equal(guestState.me.hand.length, 4);
  assert.equal(hostState.players.find((player) => !player.you).hand, undefined);
  assert.equal(guestState.players.find((player) => !player.you).hand, undefined);

  const afterDraw = state(host, (value) => value.phase === "discard");
  host.emit("draw-card", "deck");
  assert.equal((await afterDraw).me.hand.length, 5);

  const guestTurn = state(guest, (value) => value.phase === "draw");
  host.emit("discard-card", 0);
  assert.equal((await guestTurn).currentName, "Tamu");

  const guestBecomesHost = state(guest, (value) => value.host === true && value.players.length === 1);
  host.emit("leave-room", () => {});
  assert.equal((await guestBecomesHost).players[0].name, "Tamu");
});

test("Texas Hold'em membagikan dua kartu dan membuka flop", async () => {
  const host = await client();
  const guest = await client();
  const created = await emit(host, "create-room", { name: "Poker A", maxPlayers: 2, gameType: "poker" });
  await emit(guest, "join-room", { code: created.code, name: "Poker B" });
  const hostPlaying = state(host, (value) => value.status === "playing");
  const guestPlaying = state(guest, (value) => value.status === "playing");
  host.emit("start-round");
  const [hostState] = await Promise.all([hostPlaying, guestPlaying]);
  assert.equal(hostState.gameType, "poker");
  assert.equal(hostState.me.hand.length, 2);
  assert.equal(hostState.community.length, 0);
  assert.equal(hostState.pot, 30);
  assert.equal(hostState.players.find((player) => !player.you).hand, undefined);

  host.emit("poker-action", "check");
  const flop = state(guest, (value) => value.community.length === 3);
  guest.emit("poker-action", "check");
  assert.equal((await flop).pokerStage, "Flop");

  for (const [count, stageName] of [[4, "Turn"], [5, "River"]]) {
    host.emit("poker-action", "check");
    const nextStage = state(guest, (value) => value.community.length === count);
    guest.emit("poker-action", "check");
    assert.equal((await nextStage).pokerStage, stageName);
  }

  host.emit("poker-action", "check");
  const betweenRounds = state(guest, (value) => value.status === "between-rounds");
  guest.emit("poker-action", "check");
  const handResult = await betweenRounds;
  assert.ok(handResult.winners.length >= 1);
  assert.ok(["Royal Flush", "Straight Flush", "Four of a Kind", "Full House", "Flush", "Straight", "Three of a Kind", "Two Pair", "One Pair", "High Card"].includes(handResult.winningHand));
  assert.equal(handResult.players.reduce((total, player) => total + player.chips, 0), 2000);
  const nextHand = state(guest, (value) => value.status === "playing");
  assert.equal((await nextHand).pokerStage, "Pre-flop");
});

test("Texas Hold'em menerima nominal raise yang dipilih pemain", async () => {
  const host = await client();
  const guest = await client();
  const created = await emit(host, "create-room", { name: "Poker C", maxPlayers: 2, gameType: "poker" });
  await emit(guest, "join-room", { code: created.code, name: "Poker D" });
  const playing = state(host, (value) => value.status === "playing");
  host.emit("start-round");
  const initial = await playing;
  const hostPlayer = initial.players.find((player) => player.you);
  const updated = state(host, (value) => value.players.find((player) => player.you)?.bet === hostPlayer.bet + initial.toCall + 60);
  host.emit("poker-action", { type: "raise", amount: 60 });
  const raised = await updated;
  assert.equal(raised.pot, initial.pot + initial.toCall + 60);
  assert.equal(raised.currentBet, hostPlayer.bet + initial.toCall + 60);
});

test("pemain poker yang kalah all-in tersisih dan turnamen berakhir tanpa mengisi ulang chip", async () => {
  const host = await client();
  const guest = await client();
  const created = await emit(host, "create-room", { name: "Poker E", maxPlayers: 2, gameType: "poker" });
  await emit(guest, "join-room", { code: created.code, name: "Poker F" });
  const playing = state(host, (value) => value.status === "playing");
  host.emit("start-round");
  const initial = await playing;
  const guestCanAct = state(guest, (value) => value.phase === "poker-action");
  host.emit("poker-action", "all-in");
  await guestCanAct;
  const tournamentEnd = state(host, (value) => ["between-rounds", "finished"].includes(value.status));
  guest.emit("poker-action", "all-in");
  const finished = await tournamentEnd;
  assert.equal(finished.players.reduce((total, player) => total + player.chips, 0), initial.players.reduce((total, player) => total + player.chips, 0));
  if (finished.status === "finished") {
    const winner = finished.players.find((player) => !player.eliminated);
    const eliminated = finished.players.find((player) => player.eliminated);
    assert.ok(winner);
    assert.ok(eliminated);
    assert.equal(winner.chips, initial.players.reduce((total, player) => total + player.chips, 0));
    assert.equal(eliminated.chips, 0);
    assert.deepEqual(finished.winners, [winner.name]);
  } else {
    assert.ok(finished.players.every((player) => !player.eliminated));
  }
});

test("mode CPU mengisi kursi dan memainkan giliran otomatis", async () => {
  const host = await client();
  const created = await emit(host, "create-room", { name: "Solo", maxPlayers: 2, gameType: "41", opponentMode: "cpu" });
  const playing = state(host, (value) => value.status === "playing");
  host.emit("start-round");
  const initial = await playing;
  assert.equal(initial.players.length, 2);
  assert.equal(initial.players.filter((player) => player.bot).length, 1);
  assert.match(initial.players.find((player) => player.bot).name, /^CPU-[A-Z2-9]{4}$/);

  const afterDraw = state(host, (value) => value.phase === "discard");
  host.emit("draw-card", "deck");
  await afterDraw;
  const backToPlayer = state(host, (value) => value.phase === "draw" && value.currentName === "Solo");
  host.emit("discard-card", 0);
  assert.equal((await backToPlayer).currentName, "Solo");
});
