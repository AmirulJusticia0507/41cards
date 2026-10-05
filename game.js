const suits = [
  { key: "spades", symbol: "♠", red: false },
  { key: "hearts", symbol: "♥", red: true },
  { key: "diamonds", symbol: "♦", red: true },
  { key: "clubs", symbol: "♣", red: false },
];
const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const bots = [
  { name: "Rani", avatar: "👩🏽" },
  { name: "Bima", avatar: "👨🏻" },
  { name: "Sari", avatar: "👩🏻" },
];

let game;
const $ = (selector) => document.querySelector(selector);

function cardValue(rank) {
  if (rank === "A") return 11;
  if (["J", "Q", "K"].includes(rank)) return 10;
  return Number(rank);
}

function scoreHand(hand) {
  const totals = Object.fromEntries(suits.map((suit) => [suit.key, 0]));
  hand.forEach((card) => totals[card.suit.key] += cardValue(card.rank));
  return Math.max(...Object.values(totals));
}

function makeDeck() {
  const deck = suits.flatMap((suit) => ranks.map((rank) => ({ suit, rank })));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function startGame() {
  const deck = makeDeck();
  const players = [{ name: "Kamu", hand: [] }, ...bots.map((bot) => ({ ...bot, hand: [] }))];
  for (let round = 0; round < 4; round++) players.forEach((player) => player.hand.push(deck.pop()));
  game = { deck, discard: [deck.pop()], players, current: 0, phase: "draw", over: false };
  $("#result-dialog").close();
  setMessage("Ambil satu kartu dari tumpukan atau buangan.");
  render();
}

function cardMarkup(card, extraClass = "") {
  return `<span class="playing-card ${card.suit.red ? "red" : ""} ${extraClass}">
    <span class="rank">${card.rank}<span class="corner-suit">${card.suit.symbol}</span></span>
    <span class="big-suit">${card.suit.symbol}</span>
  </span>`;
}

function render() {
  const player = game.players[0];
  const handEl = $("#player-hand");
  handEl.innerHTML = player.hand.map((card, index) => {
    const count = player.hand.length;
    const center = (count - 1) / 2;
    const offset = index - center;
    const x = offset * (window.innerWidth < 640 ? 49 : 67);
    const rotate = offset * 7;
    const y = Math.abs(offset) * 4;
    return `<button class="hand-card ${game.phase !== "discard" ? "disabled" : ""}" data-card-index="${index}" style="z-index:${index + 10};transform:translateX(${x}px) translateY(${y}px) rotate(${rotate}deg)" aria-label="Buang ${card.rank} ${card.suit.key}">${cardMarkup(card)}</button>`;
  }).join("");

  handEl.querySelectorAll(".hand-card").forEach((button) => button.addEventListener("click", () => discardPlayerCard(Number(button.dataset.cardIndex))));
  $("#discard-card").outerHTML = cardMarkup(game.discard.at(-1), "") .replace("<span", '<span id="discard-card"');
  $("#deck-count").textContent = game.deck.length;
  $("#player-score").textContent = `Skor ${scoreHand(player.hand)}`;
  $("#opponents").innerHTML = game.players.slice(1).map((bot, index) => `
    <div class="opponent ${game.current === index + 1 ? "active" : ""}">
      <div class="avatar">${bot.avatar}</div>
      <div class="mt-1 text-xs font-semibold">${bot.name}</div>
      <div class="text-[10px] text-white/45">4 kartu</div>
      <div class="mini-hand">${bot.hand.map(() => '<i class="mini-card"></i>').join("")}</div>
    </div>`).join("");
  $("#turn-badge").textContent = game.current === 0 ? (game.phase === "draw" ? "Giliran kamu • ambil kartu" : "Giliran kamu • buang kartu") : `Giliran ${game.players[game.current].name}`;
  $("#deck").disabled = game.over || game.current !== 0 || game.phase !== "draw" || !game.deck.length;
  $("#discard-pile").disabled = game.over || game.current !== 0 || game.phase !== "draw" || !game.discard.length;
}

function setMessage(text) { $("#message").textContent = text; }

function drawForPlayer(source) {
  if (game.over || game.current !== 0 || game.phase !== "draw") return;
  const pile = source === "deck" ? game.deck : game.discard;
  if (!pile.length) return;
  game.players[0].hand.push(pile.pop());
  game.phase = "discard";
  setMessage("Sekarang pilih satu kartu di tangan untuk dibuang.");
  render();
}

function discardPlayerCard(index) {
  if (game.over || game.current !== 0 || game.phase !== "discard") return;
  game.discard.push(game.players[0].hand.splice(index, 1)[0]);
  if (scoreHand(game.players[0].hand) === 41) return endGame("forty-one");
  game.current = 1;
  game.phase = "waiting";
  setMessage("Lawan sedang memilih kartu…");
  render();
  window.setTimeout(playBotTurn, 650);
}

function bestDiscardIndex(hand) {
  let bestIndex = 0;
  let bestScore = -1;
  hand.forEach((_, index) => {
    const score = scoreHand(hand.filter((card, cardIndex) => cardIndex !== index));
    if (score > bestScore) { bestScore = score; bestIndex = index; }
  });
  return bestIndex;
}

function playBotTurn() {
  if (game.over) return;
  const bot = game.players[game.current];
  const topDiscard = game.discard.at(-1);
  const currentScore = scoreHand(bot.hand);
  const withDiscard = [...bot.hand, topDiscard];
  const useDiscard = scoreHand(withDiscard.filter((_, i) => i !== bestDiscardIndex(withDiscard))) > currentScore;
  const drawn = useDiscard ? game.discard.pop() : game.deck.pop();
  if (!drawn) return endGame("empty");
  bot.hand.push(drawn);
  game.discard.push(bot.hand.splice(bestDiscardIndex(bot.hand), 1)[0]);
  if (scoreHand(bot.hand) === 41) return endGame("forty-one");

  game.current++;
  if (game.current >= game.players.length) {
    if (!game.deck.length) return endGame("empty");
    game.current = 0;
    game.phase = "draw";
    setMessage("Giliran kamu. Ambil satu kartu.");
    render();
  } else {
    setMessage("Lawan sedang memilih kartu…");
    render();
    window.setTimeout(playBotTurn, 650);
  }
}

function endGame() {
  game.over = true;
  const scores = game.players.map((player) => scoreHand(player.hand));
  const bestScore = Math.max(...scores);
  const winners = scores.map((score, index) => score === bestScore ? index : -1).filter((index) => index >= 0);
  const playerWon = winners.includes(0);
  $("#result-icon").textContent = playerWon ? "🏆" : "🃏";
  $("#result-title").textContent = winners.length > 1 && playerWon ? "Hasil Seri" : playerWon ? "Kamu Menang!" : `${game.players[winners[0]].name} Menang`;
  $("#result-copy").textContent = `Skor akhir kamu ${scores[0]}. Skor tertinggi ronde ini ${bestScore}.`;
  setMessage("Ronde telah selesai.");
  render();
  $("#result-dialog").showModal();
}

$("#deck").addEventListener("click", () => drawForPlayer("deck"));
$("#discard-pile").addEventListener("click", () => drawForPlayer("discard"));
$("#new-game-button").addEventListener("click", startGame);
$("#replay-button").addEventListener("click", startGame);
$("#rules-button").addEventListener("click", () => $("#rules-dialog").showModal());
$("#close-rules").addEventListener("click", () => $("#rules-dialog").close());
$("#play-button").addEventListener("click", () => $("#rules-dialog").close());
window.addEventListener("resize", render);

startGame();
$("#rules-dialog").showModal();
