/* node oceanus/engine.test.js */
'use strict';
var E = require('./engine.js');
var failed = 0;
function assert(cond, msg) {
  if (!cond) { failed++; console.error('FAIL ' + msg); }
  else console.log('ok ' + msg);
}
function C(rank, suit) {
  var faces = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
  var r = rank >= 10 ? 10 : rank;
  return { r: r, f: faces[rank] || String(rank), s: suit || 0, suit: 'S' };
}
// draw() pops, so the last array item is dealt first.
// Deal order: player, player, dealer, dealer, then later hits.
function shoe() {
  var cards = Array.prototype.slice.call(arguments);
  return cards.reverse();
}
function play(list, acts, bank) {
  var pad = list.slice(), i;
  for (i = list.length; i < 40; i++) pad.push(C(2));
  var g = new E.Game({
    bankroll: bank == null ? 1000 : bank,
    decks: 1,
    shoe: shoe.apply(null, pad),
    rng: function () { return 0; }
  });
  var start = g.startRound(100);
  for (i = 0; i < (acts || []).length; i++) g.act(acts[i]);
  return { g: g, start: start };
}

// S17: dealer A+6 stands, player 19 wins
var soft = play([C(10), C(9), C(6), C(1)], ['S']);
assert(soft.g.phase === 'settled', 'round settles');
assert(soft.g.dealer.cards.length === 2, 'S17 dealer stands on soft 17');
assert(soft.g.results[0].outcome === 'win', '19 beats soft 17');
assert(soft.g.roundNet() === 100, 'even-money win pays +100');

// Dealer hard 16 draws
var hit = play([C(10), C(7), C(10), C(6), C(5)], ['S']);
assert(hit.g.dealer.cards.length === 3, 'dealer hits hard 16');
assert(hit.g.dealer.cards[2].r === 5, 'drawn card is the next shoe card');

// Player blackjack pays 3:2
var bj = play([C(1), C(10), C(9), C(7)]);
assert(bj.g.results[0].outcome === 'blackjack', 'player blackjack');
assert(bj.g.roundNet() === 150, 'blackjack pays 3:2');

// Both blackjack push, and ace-up always offers insurance first
var both = play([C(1), C(10), C(1), C(13)], [], 100);
assert(both.start.ok && both.g.phase === 'insurance', 'ace up opens insurance even when the bet is the whole bankroll');
assert(both.g.legal().indexOf('INS_YES') < 0, 'cannot buy insurance without spare chips');
both.g.act('INS_NO');
assert(both.g.results[0].outcome === 'push', 'mutual blackjack is a push');
assert(both.g.roundNet() === 0, 'push returns the stake');

// Insurance wins 2:1 when dealer has blackjack
var ins = play([C(10), C(9), C(1), C(13)], ['INS_YES']);
assert(ins.g.results[0].outcome === 'lose', 'main bet loses to dealer blackjack');
assert(ins.g.roundNet() === 0, 'half-bet insurance at 2:1 offsets the loss');

// Surrender returns half
var sur = play([C(10), C(6), C(10), C(5)], ['R']);
assert(sur.g.results[0].outcome === 'surrender', 'surrender against a ten');
assert(sur.g.roundNet() === -50, 'surrender loses half the stake');

// No surrender against an ace
var ace = play([C(10), C(6), C(1), C(5)], ['INS_NO']);
assert(ace.g.legal().indexOf('R') < 0, 'no surrender when the dealer shows an ace');

// Split aces: one card each, no resplit, no double
var aces = play([C(1), C(1), C(8), C(6), C(9), C(7)]);
aces.g.act('P');
assert(aces.g.hands.length === 2, 'aces split into two hands');
assert(aces.g.hands[0].cards.length === 2 && aces.g.hands[1].cards.length === 2, 'split aces receive one card');
assert(aces.g.phase === 'settled', 'split aces do not take another action');

// Second split hand with 21 is skipped, not left waiting on Stand
var tens = play([C(10), C(10), C(7), C(9), C(5), C(1), C(10)]);
tens.g.act('P');
assert(tens.g.hands[1].cards[1].r === 1, 'second hand was dealt an ace');
assert(tens.g.active === 0 && tens.g.phase === 'player', 'play continues on the hand that is not 21');
assert(tens.g.hands[1].done === true, 'a dealt 21 on the other split hand is already finished');
tens.g.act('S');
assert(tens.g.phase === 'settled', 'standing finishes the round');
assert(tens.g.results[1].outcome === 'win', 'split 21 pays 1:1, not blackjack');
assert(tens.g.results[1].amount === 200, '1:1 returns double the hand stake');

// Double after split
var das = play([C(5), C(6), C(9), C(8), C(5), C(4), C(10), C(9)]);
das.g.act('P');
assert(das.g.legal().indexOf('D') >= 0, 'double is allowed after a split');
das.g.act('D');
assert(das.g.hands[0].cards.length === 3 && das.g.hands[0].bet === 200, 'double takes one card and doubles the stake');

// Four-hand cap
var cap = play([
  C(8), C(8), C(6), C(5),
  C(8), C(3), C(8), C(4), C(8), C(2), C(9), C(7), C(10)
]);
cap.g.act('P'); cap.g.act('P'); cap.g.act('P');
assert(cap.g.hands.length === 4, 'at most four hands');
assert(cap.g.legal().indexOf('P') < 0, 'the fourth hand cannot be split again');

if (failed) { console.error(failed + ' failed'); process.exit(1); }
console.log('all passed');
