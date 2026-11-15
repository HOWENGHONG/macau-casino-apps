/* 海立方 廿一點 — 遊戲規則引擎
 *
 * 規則（與澳門海立方／澳博 S17 檯一致）：
 *   · 6 副牌，莊家軟 17 停牌（S17）
 *   · 任何兩張牌可加倍；分牌後可加倍（DAS）
 *   · 可分牌（同點數），最多 4 門；A 只可分一次，分 A 後每門只補一張牌、不可加倍
 *   · 可分牌前投降（Late Surrender）：限首兩張、莊明牌 A 除外、分牌後不可
 *   · 保險：莊明牌 A 時開放，上限原注一半，賠 2:1
 *   · Blackjack 賠 3:2；分牌後組成的 21 只賠 1:1
 *   · 莊明牌 A 或 10 點牌先瞇牌核對 Blackjack
 *
 * 純規則引擎，不依賴 DOM，可在 Node 測試。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BJEngine = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FACES = { 1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K' };
  var SUITS = ['\u2660', '\u2665', '\u2666', '\u2663'];
  var MIN_BET = 10;
  var MAX_BET = 5000;

  function makeDeck() {
    var cards = [];
    for (var s = 0; s < 4; s++) {
      for (var r = 1; r <= 13; r++) {
        cards.push({ r: Math.min(r, 10), f: FACES[r], s: s, suit: SUITS[s] });
      }
    }
    return cards;
  }

  function totals(cards) {
    var t = 0, aces = 0, i;
    for (i = 0; i < cards.length; i++) {
      if (cards[i].r === 1) { aces++; t += 1; } else { t += cards[i].r; }
    }
    var soft = aces > 0 && t + 10 <= 21;
    return { t: soft ? t + 10 : t, soft: soft, hard: t };
  }

  function isAceUp(card) { return !!card && card.r === 1; }
  function isTenUp(card) { return !!card && card.r === 10; }

  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  function Game(opts) {
    opts = opts || {};
    this.decks = opts.decks || 6;
    this.bankroll = opts.bankroll == null ? 10000 : opts.bankroll;
    this.rng = opts.rng || Math.random;
    this.minBet = opts.minBet || MIN_BET;
    this.maxBet = opts.maxBet || MAX_BET;
    this.shoe = opts.shoe ? opts.shoe.slice() : this.newShoe();
    this.reshuffleAt = Math.floor(this.decks * 52 * 0.22);
    this.hands = [];
    this.dealer = { cards: [], hidden: true };
    this.phase = 'bet';
    this.active = 0;
    this.bet = 0;
    this.insurance = 0;
    this.results = [];
    this.note = '';
    this.rounds = 0;
    this.roundStart = this.bankroll;
    this.shuffledThisRound = false;
  }

  Game.prototype.newShoe = function () {
    var cards = [], i;
    for (i = 0; i < this.decks; i++) cards = cards.concat(makeDeck());
    return shuffle(cards, this.rng);
  };

  Game.prototype.draw = function () {
    if (!this.shoe.length) this.shoe = this.newShoe();
    return this.shoe.pop();
  };

  Game.prototype.maybeShuffle = function () {
    this.shuffledThisRound = false;
    if (this.shoe.length < this.reshuffleAt) {
      this.shoe = this.newShoe();
      this.shuffledThisRound = true;
    }
  };

  Game.prototype.dealerUp = function () { return this.dealer.cards[0]; };

  /* ---------- round flow ---------- */

  Game.prototype.startRound = function (bet) {
    if (this.phase === 'player' || this.phase === 'insurance') return { ok: false, error: 'still-playing' };
    bet = Math.round(bet);
    if (!isFinite(bet) || bet < this.minBet) return { ok: false, error: 'below-min' };
    if (bet > this.maxBet) return { ok: false, error: 'above-max' };
    if (bet > this.bankroll) return { ok: false, error: 'insufficient' };

    this.maybeShuffle();
    this.hands = [];
    this.dealer = { cards: [], hidden: true };
    this.insurance = 0;
    this.results = [];
    this.note = '';
    this.active = 0;
    this.bet = bet;
    this.roundStart = this.bankroll;
    this.bankroll -= bet;
    this.rounds++;

    var p = { cards: [this.draw(), this.draw()], bet: bet, done: false, fromSplit: false, splitAces: false };
    p.natural = totals(p.cards).t === 21;
    this.hands = [p];
    this.dealer.cards = [this.draw(), this.draw()];

    // peek: dealer shows an ace or a ten
    if (isAceUp(this.dealerUp()) && this.bankroll >= bet / 2) {
      this.phase = 'insurance';
      return { ok: true };
    }
    return this.finishPeek();
  };

  Game.prototype.finishPeek = function () {
    var up = this.dealerUp();
    var peek = isAceUp(up) || isTenUp(up);
    var dealerBJ = peek && totals(this.dealer.cards).t === 21 && this.dealer.cards.length === 2;
    if (dealerBJ) {
      this.dealer.hidden = false;
      this.phase = 'settled';
      this.settle();
      return { ok: true, dealerBlackjack: true };
    }
    this.phase = 'player';
    // player natural wins straight away (dealer cannot have blackjack any more)
    if (this.hands[0].natural) {
      this.dealer.hidden = false;
      this.phase = 'settled';
      this.settle();
      return { ok: true, playerBlackjack: true };
    }
    return { ok: true };
  };

  Game.prototype.legal = function () {
    if (this.phase === 'insurance') {
      return this.bankroll >= this.bet / 2 ? ['INS_YES', 'INS_NO'] : ['INS_NO'];
    }
    if (this.phase !== 'player') return [];
    var h = this.hands[this.active];
    if (!h || h.done) return [];
    var t = totals(h.cards);
    if (t.t >= 21) return ['S'];
    var acts = [];
    var two = h.cards.length === 2;
    if (two && !h.splitAces && !h.fromSplit && this.hands.length === 1 && !isAceUp(this.dealerUp())) acts.push('R');
    if (two && this.bankroll >= h.bet && !h.splitAces) acts.push('D');
    if (this.canSplit(h)) acts.push('P');
    acts.push('H', 'S');
    return acts;
  };

  Game.prototype.canSplit = function (h) {
    if (!h || h.cards.length !== 2) return false;
    if (h.cards[0].r !== h.cards[1].r) return false;
    if (this.hands.length >= 4) return false;
    if (h.splitAces) return false;
    if (this.bankroll < h.bet) return false;
    return true;
  };

  Game.prototype.act = function (code) {
    var h, t;
    if (this.phase === 'insurance') {
      if (code === 'INS_YES' && this.bankroll >= this.bet / 2) {
        this.insurance = this.bet / 2;
        this.bankroll -= this.insurance;
      }
      return this.finishPeek();
    }
    if (this.phase !== 'player') return { ok: false, error: 'not-playing' };
    h = this.hands[this.active];
    if (!h || h.done) return { ok: false, error: 'hand-done' };

    if (code === 'H') {
      h.cards.push(this.draw());
      t = totals(h.cards);
      if (t.t > 21) { h.done = true; this.note = '爆牌'; this.advance(); }
      else if (t.t === 21) { h.done = true; this.advance(); }
      return { ok: true };
    }
    if (code === 'S') {
      h.done = true;
      this.advance();
      return { ok: true };
    }
    if (code === 'D') {
      if (h.cards.length !== 2 || h.splitAces) return { ok: false, error: 'illegal' };
      this.bankroll -= h.bet;
      h.bet *= 2;
      h.doubled = true;
      h.cards.push(this.draw());
      h.done = true;
      this.advance();
      return { ok: true };
    }
    if (code === 'P') {
      if (!this.canSplit(h)) return { ok: false, error: 'illegal' };
      this.bankroll -= h.bet;
      var isA = h.cards[0].r === 1;
      var h1 = { cards: [h.cards[0], this.draw()], bet: h.bet, done: false, fromSplit: true, splitAces: isA };
      var h2 = { cards: [h.cards[1], this.draw()], bet: h.bet, done: false, fromSplit: true, splitAces: isA };
      this.hands.splice(this.active, 1, h1, h2);
      if (isA) { h1.done = true; h2.done = true; }
      else if (totals(h1.cards).t === 21) { h1.done = true; }
      this.advance();
      return { ok: true };
    }
    if (code === 'R') {
      if (h.cards.length !== 2 || h.fromSplit || isAceUp(this.dealerUp())) return { ok: false, error: 'illegal' };
      h.surrendered = true;
      h.done = true;
      this.advance();
      return { ok: true };
    }
    return { ok: false, error: 'unknown' };
  };

  Game.prototype.advance = function () {
    var i;
    for (i = this.active; i < this.hands.length; i++) {
      if (!this.hands[i].done) { this.active = i; this.phase = 'player'; return; }
    }
    for (i = 0; i < this.active; i++) {
      if (!this.hands[i].done) { this.active = i; this.phase = 'player'; return; }
    }
    this.phase = 'dealer';
    this.playDealer();
    this.settle();
  };

  Game.prototype.playDealer = function () {
    this.dealer.hidden = false;
    var alive = false, i;
    for (i = 0; i < this.hands.length; i++) {
      var h = this.hands[i];
      if (!h.surrendered && totals(h.cards).t <= 21) { alive = true; break; }
    }
    if (!alive) return;
    while (true) {
      var t = totals(this.dealer.cards);
      if (t.t > 21 || t.t >= 17) break;          // S17：軟 17 亦停牌
      this.dealer.cards.push(this.draw());
    }
  };

  Game.prototype.settle = function () {
    var d = totals(this.dealer.cards);
    var dealerTotal = d.t;
    var dealerBJ = this.dealer.cards.length === 2 && dealerTotal === 21;
    var results = [], paid = 0, i;

    for (i = 0; i < this.hands.length; i++) {
      var h = this.hands[i];
      var t = totals(h.cards).t;
      var r = { index: i, total: t, bet: h.bet, outcome: 'lose', amount: 0, cards: h.cards.slice() };

      if (h.surrendered) {
        r.outcome = 'surrender';
        r.amount = h.bet / 2;
      } else if (t > 21) {
        r.outcome = 'bust';
        r.amount = 0;
      } else if (h.natural && dealerBJ) {
        r.outcome = 'push';
        r.amount = h.bet;
      } else if (h.natural) {
        r.outcome = 'blackjack';
        r.amount = h.bet * 2.5;
      } else if (dealerBJ) {
        r.outcome = 'lose';
        r.amount = 0;
      } else if (dealerTotal > 21 || t > dealerTotal) {
        r.outcome = 'win';
        r.amount = h.bet * 2;
      } else if (t === dealerTotal) {
        r.outcome = 'push';
        r.amount = h.bet;
      }
      paid += r.amount;
      results.push(r);
    }

    this.bankroll += paid;

    if (this.insurance > 0) {
      if (dealerBJ) {
        this.bankroll += this.insurance * 3;    // 本金 + 2:1 賠率
        this.note = '保險中';
      } else {
        this.note = '保險沒收';
      }
    }
    this.results = results;
    this.phase = 'settled';
    return results;
  };

  Game.prototype.roundNet = function () {
    return this.bankroll - this.roundStart;
  };

  return {
    Game: Game,
    totals: totals,
    makeDeck: makeDeck,
    isAceUp: isAceUp,
    isTenUp: isTenUp,
    MIN_BET: MIN_BET,
    MAX_BET: MAX_BET
  };
}));
