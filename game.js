const socket = io({ autoConnect: false });
const $ = (selector) => document.querySelector(selector);
const suitInfo = {
  spades: { symbol: "♠", red: false }, hearts: { symbol: "♥", red: true },
  diamonds: { symbol: "♦", red: true }, clubs: { symbol: "♣", red: false },
};
const avatars = ["👩🏽", "👨🏻", "👩🏻", "🧑🏽", "👩🏾", "👨🏽", "👩🏻‍🦱", "🧑🏻"];
let game = null;
let lastStatus = null;

function cardMarkup(card, extraClass = "") {
  if (!card) return '<span id="discard-card" class="playing-card opacity-20"></span>';
  const suit = suitInfo[card.suit];
  return `<span class="playing-card ${suit.red ? "red" : ""} ${extraClass}"><span class="rank">${card.rank}<span class="corner-suit">${suit.symbol}</span></span><span class="big-suit">${suit.symbol}</span></span>`;
}

function renderHand() {
  const hand = game?.me?.hand || [];
  const handEl = $("#player-hand");
  handEl.innerHTML = hand.map((card, index) => {
    const offset = index - (hand.length - 1) / 2;
    const x = offset * (window.innerWidth < 640 ? 49 : 67);
    return `<button class="hand-card ${game.phase !== "discard" ? "disabled" : ""}" data-card-index="${index}" style="z-index:${index + 10};transform:translateX(${x}px) translateY(${Math.abs(offset) * 4}px) rotate(${offset * 7}deg)">${cardMarkup(card)}</button>`;
  }).join("");
  handEl.querySelectorAll(".hand-card").forEach((button) => button.addEventListener("click", () => {
    if (game.phase === "discard") socket.emit("discard-card", Number(button.dataset.cardIndex));
  }));
}

function renderTable() {
  if (!game) return;
  const others = game.players.filter((player) => !player.you);
  $("#opponents").innerHTML = others.map((player, index) => `<div class="opponent ${player.current ? "active" : ""} ${player.connected ? "" : "opacity-40"}"><div class="avatar">${avatars[index % avatars.length]}</div><div class="mt-1 max-w-full truncate px-1 text-xs font-semibold">${escapeHtml(player.name)}</div><div class="text-[10px] text-white/45">${player.connected ? `${player.cardCount} kartu` : "terputus"}</div><div class="mini-hand">${Array.from({ length: player.cardCount }, () => '<i class="mini-card"></i>').join("")}</div></div>`).join("");
  renderHand();
  $("#discard-card").outerHTML = cardMarkup(game.discard).replace("<span", '<span id="discard-card"');
  $("#deck-count").textContent = game.deckCount;
  $("#player-score").textContent = game.spectator ? "Mode Penonton" : `Skor ${game.me?.score || 0}`;
  const myTurn = game.phase === "draw" || game.phase === "discard";
  $("#turn-badge").textContent = game.status === "waiting" ? "Menunggu pemain" : game.status === "finished" ? "Ronde selesai" : myTurn ? `Giliran kamu • ${game.phase === "draw" ? "ambil kartu" : "buang kartu"}` : `Giliran ${game.currentName}`;
  $("#message").textContent = game.status === "waiting" ? "Permainan belum dimulai." : game.status === "finished" ? "Host dapat memulai ronde baru." : game.spectator ? `Kamu menonton permainan • giliran ${game.currentName}` : myTurn ? (game.phase === "draw" ? "Ambil kartu dari tumpukan atau buangan." : "Pilih satu kartu untuk dibuang.") : `Menunggu ${game.currentName}…`;
  $("#deck").disabled = game.phase !== "draw";
  $("#discard-pile").disabled = game.phase !== "draw" || !game.discard;
  $(".hand-zone").classList.toggle("opacity-30", game.spectator);
}

function renderLobby() {
  if (!game) return;
  $("#join-panel").classList.add("hidden");
  $("#waiting-panel").classList.remove("hidden");
  $("#close-lobby").classList.remove("hidden");
  $("#lobby-room-code").textContent = game.code;
  $("#room-badge").textContent = game.code;
  $("#room-badge").classList.remove("hidden");
  $("#leave-header-button").classList.remove("hidden");
  $("#lobby-players").innerHTML = game.players.map((player, index) => `<div class="flex items-center gap-3 rounded-xl bg-white/5 px-4 py-3"><span>${avatars[index % avatars.length]}</span><span class="flex-1 text-sm font-semibold">${escapeHtml(player.name)}${player.you ? " (kamu)" : ""}</span><span class="text-[10px] ${player.connected ? "text-emerald-300" : "text-red-300"}">${player.connected ? "ONLINE" : "PUTUS"}</span></div>`).join("");
  $("#lobby-status").textContent = game.spectator ? "Kamu masuk sebagai penonton." : `${game.players.length}/${game.maxPlayers} pemain • minimal 2 pemain`;
  $("#start-button").classList.toggle("hidden", !game.host || game.players.length < 2 || game.status === "playing");
}

function showResult() {
  const winnerText = game.winners.join(" & ");
  const won = game.winners.includes(game.me?.name);
  $("#result-icon").textContent = won ? "🏆" : "🃏";
  $("#result-title").textContent = won ? (game.winners.length > 1 ? "Hasil Seri" : "Kamu Menang!") : `${winnerText} Menang`;
  $("#result-copy").textContent = game.spectator ? `Pemenang: ${winnerText}.` : `Skor akhir kamu ${game.me.score}. Pemenang: ${winnerText}.`;
  $("#replay-button").classList.toggle("hidden", !game.host);
  if (!$("#result-dialog").open) $("#result-dialog").showModal();
}

function escapeHtml(value) { const node = document.createElement("div"); node.textContent = value; return node.innerHTML; }
function showError(message) { $("#lobby-error").textContent = message; $("#lobby-error").classList.remove("hidden"); }
function identityKey(code) { return `41cards:${code}:playerKey`; }
function saveSession(data) { localStorage.setItem("41cards:session", JSON.stringify(data)); }
function loadSession() { try { return JSON.parse(localStorage.getItem("41cards:session")); } catch { return null; } }
function resetLobby() {
  if (game?.code) localStorage.removeItem(identityKey(game.code));
  game = null;
  lastStatus = null;
  localStorage.removeItem("41cards:session");
  $("#waiting-panel").classList.add("hidden");
  $("#join-panel").classList.remove("hidden");
  $("#close-lobby").classList.add("hidden");
  $("#room-badge").classList.add("hidden");
  $("#leave-header-button").classList.add("hidden");
  $("#lobby-error").classList.add("hidden");
  if (!$("#lobby-dialog").open) $("#lobby-dialog").showModal();
}
function leaveRoom() {
  const button = $("#leave-button");
  button.disabled = true;
  button.textContent = "Keluar…";
  socket.timeout(3000).emit("leave-room", () => {
    resetLobby();
    window.location.replace("/");
  });
}
function joinRoom(spectator = false) {
  const code = $("#room-code").value.trim().toUpperCase();
  const name = $("#player-name").value.trim();
  if (!code || (!spectator && !name)) return showError("Isi nama dan kode room terlebih dahulu.");
  socket.emit("join-room", { code, name, spectator, playerKey: localStorage.getItem(identityKey(code)) }, (response) => {
    if (!response.ok) return showError(response.error);
    if (response.playerKey) localStorage.setItem(identityKey(response.code), response.playerKey);
    saveSession({ code: response.code, name, spectator, playerKey: response.playerKey });
    $("#lobby-error").classList.add("hidden");
  });
}

socket.on("state", (state) => {
  game = state;
  renderTable();
  renderLobby();
  if (state.status === "playing" && $("#lobby-dialog").open) $("#lobby-dialog").close();
  if (state.status === "finished" && lastStatus !== "finished") showResult();
  lastStatus = state.status;
});
socket.on("notice", showError);
socket.on("disconnect", () => { if (game) $("#message").textContent = "Koneksi terputus. Mencoba menyambung kembali…"; });
socket.on("connect", () => {
  const session = loadSession();
  if (session) socket.emit("join-room", session, (response) => { if (!response.ok) localStorage.removeItem("41cards:session"); });
});

$("#create-button").addEventListener("click", () => {
  const name = $("#player-name").value.trim();
  if (!name) return showError("Isi nama kamu terlebih dahulu.");
  socket.emit("create-room", { name, maxPlayers: Number($("#max-players").value) }, (response) => {
    if (!response.ok) return showError(response.error);
    localStorage.setItem(identityKey(response.code), response.playerKey);
    saveSession({ code: response.code, name, spectator: false, playerKey: response.playerKey });
  });
});
$("#join-button").addEventListener("click", () => joinRoom(false));
$("#watch-button").addEventListener("click", () => joinRoom(true));
$("#start-button").addEventListener("click", () => socket.emit("start-round"));
$("#leave-button").addEventListener("click", leaveRoom);
$("#leave-header-button").addEventListener("click", leaveRoom);
$("#deck").addEventListener("click", () => socket.emit("draw-card", "deck"));
$("#discard-pile").addEventListener("click", () => socket.emit("draw-card", "discard"));
$("#replay-button").addEventListener("click", () => { $("#result-dialog").close(); socket.emit("start-round"); });
$("#close-result").addEventListener("click", () => $("#result-dialog").close());
$("#rules-button").addEventListener("click", () => $("#rules-dialog").showModal());
$("#close-rules").addEventListener("click", () => $("#rules-dialog").close());
$("#play-button").addEventListener("click", () => $("#rules-dialog").close());
$("#lobby-button").addEventListener("click", () => $("#lobby-dialog").showModal());
$("#close-lobby").addEventListener("click", () => $("#lobby-dialog").close());
$("#room-badge").addEventListener("click", () => navigator.clipboard?.writeText(game.code));
$("#lobby-room-code").addEventListener("click", () => navigator.clipboard?.writeText(game.code));
window.addEventListener("resize", () => game && renderHand());

$("#lobby-dialog").showModal();
socket.connect();
