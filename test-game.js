const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { io } = require("socket.io-client");

const port = 3200 + Math.floor(Math.random() * 500);
const server = spawn(process.execPath, ["server.js"], { env: { ...process.env, PORT: port }, stdio: "ignore" });
const clients = [];
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
  await new Promise((resolve) => setTimeout(resolve, 600));
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
