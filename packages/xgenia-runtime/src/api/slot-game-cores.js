'use strict';

/**
 * Slot GAME cores — the maths behind the core slot nodes (Weighted Reels, Check Wins, Calculate
 * Winnings, Get Paytable, Generate Symbol Weights, Reel Strips Generator, Spin Calculate, Spin Result,
 * Check Jackpot, Calculate Free Spins States, Init Free Spins, Reel Ways Check Wins, Reel Ways
 * Calculate Winnings, Volatility Estimator, Symbol Frequency Tracker), written ONCE. (2026-10-04)
 *
 * WHAT WAS WRONG: each of these nodes existed twice — the editor node in private
 * xgenia-pro-nodes/src/slot-games/*.js and a hand-kept re-implementation that
 * slot-game-node-converter.ts emitted into the compiled evaluate(ctx) script XRGS runs. Nothing held
 * the two equal and they drifted: run side by side on the same inputs (src/api/test-slot-game-parity.ts)
 * 15 of 16 node types disagreed — Check Jackpot looked for symbol 0 in the editor and symbol 1 on the
 * RGS, Calculate Winnings and Reel Ways Calculate Winnings threw on every RGS round whose winningLines
 * were unwired, Check Wins scored every one-symbol run when minConsecutiveSymbols was empty, Weighted
 * Reels showed an empty grid for rowSize 0, Get Paytable ignored a "5" override, Spin Calculate charged
 * a stake the editor clamps, Init Free Spins and Calculate Free Spins States read blockedReels
 * differently, the formulas went through two different evaluators. Why it matters: the game a player
 * tests in the editor is the game the RGS pays, or the RTP the studio certified is not the RTP it ships.
 *
 * Now both consumers run THIS function body:
 *   * the editor nodes require this module and call the returned functions;
 *   * the RGS compiler (slot-game-node-converter.ts) embeds String(defineSlotGameCores), called with
 *     the embedded formula evaluator, once per script, and calls __sgc.<core>(...) from each node
 *     function.
 * The rules are the editor nodes' documented behaviour — their input setters' coercions and defaults
 * included, because the RGS receives the raw wire / parameter values the setters used to coerce.
 * src/api/test-slot-game-parity.ts holds the editor nodes and the compiled scripts equal in the real
 * XRGS sandbox, on every default and on randomized inputs.
 *
 * RULES FOR THIS FILE (the body runs inside the XRGS script sandbox after sanitizeForSandbox):
 *   * everything lives INSIDE defineSlotGameCores(formulas) and references nothing outside it (the
 *     formula evaluator comes in as the argument), so a bundled editor still embeds a consistent text;
 *   * no classes, prototypes, randomness, timers or dynamic code; ES2017 syntax; no `x: number`-shaped
 *     text (sanitizeForSandbox strips TypeScript annotations by regex) and no object spread;
 *   * pure functions: (args) -> result, or (state, args) -> result with result.updatedState;
 *   * a refusal is a throw (the editor node logs it, writes it to inspect data and fires Done; the RGS
 *     refuses the round); `notes` carry the editor's console lines ([level, ...args]) without logging.
 *
 * Grid conventions (as the nodes): reels[col][row], 1-based symbols, positions [row, col] (Check Wins
 * paylines are [col, row]), money in minor units, Seeds = ISAAC Random Number Array Generator values.
 */
function defineSlotGameCores(formulas) {
  var evaluateFormula = formulas.evaluateFormula;

  // ── input coercion: what the editor runtime and the node setters do to a raw value ─────────────

  /**
   * A string arriving on an array-typed port: the editor runtime evaluates it as JS (node.js
   * setInputValue) before the setter sees it; the RGS gets the raw string. JSON is the part of that
   * both can read: '' is undefined, valid JSON is parsed, anything else is [] (what the editor makes
   * of a string it cannot evaluate).
   */
  function arrayInput(v) {
    if (typeof v !== 'string') return v;
    var t = v.trim();
    if (t === '') return undefined;
    try { return JSON.parse(t); } catch (e) { return []; }
  }
  /** setter `value || []` */
  function orEmpty(v) { return arrayInput(v) || []; }
  /** setter `Array.isArray(value) ? value : []` */
  function arrayOrEmpty(v) { v = arrayInput(v); return Array.isArray(v) ? v : []; }
  /** setter `Number(value) || fallback` */
  function numberOr(v, fallback) { return Number(v) || fallback; }
  /** setter `Math.max(Number(value) || fallback, 1)` */
  function atLeastOne(v, fallback) { return Math.max(Number(v) || fallback, 1); }
  /** A per-symbol override port (symbolPayoutN, symbolWeightN): empty means none, a number counts. */
  function overrideValue(v) {
    if (v === undefined || v === null || v === '') return undefined;
    var n = Number(v);
    return isNaN(n) ? undefined : n;
  }
  /** blockedReels on Init Free Spins / Calculate Free Spins States: setter `String(value) || '0,4'`. */
  function blockedReelsInput(v) { return v === undefined ? '0,4' : (String(v) || '0,4'); }
  function parseBlockedReels(blockedReels) {
    return blockedReels.split(',').map(function (idx) {
      var parsed = Number(idx.trim());
      if (isNaN(parsed)) throw new Error('Invalid blocked reel index: "' + idx.trim() + '"');
      return parsed;
    });
  }
  function copyKeys(obj) {
    var out = {};
    if (obj && typeof obj === 'object') for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
    return out;
  }

  // ── Check Jackpot ──────────────────────────────────────────────────────────────────────────────
  // winningSymbol unset is 1 — the port default the editor shows. The editor node's initialize used
  // 0 (a symbol no grid shows) while the RGS used 1, so the same game won jackpots on one side only.

  function checkJackpotArgs(a) {
    var n = Number(a.winningSymbol);
    return { reels: orEmpty(a.reels), winningSymbol: a.winningSymbol === undefined ? 1 : (Number.isFinite(n) ? n : 0) };
  }
  function checkJackpot(a) {
    var p = checkJackpotArgs(a);
    var reels = p.reels;
    var winningSymbol = p.winningSymbol;
    if (!Array.isArray(reels) || reels.length === 0) throw new Error('Reels must be a non-empty array');
    if (!reels.every(function (reel) { return Array.isArray(reel); })) throw new Error('Each reel must be an array');
    var matchingColumns = 0;
    var positions = [];
    for (var col = 0; col < reels.length; col++) {
      var reel = reels[col];
      var colHasSymbol = false;
      for (var row = 0; row < reel.length; row++) {
        if (reel[row] === winningSymbol) {
          positions.push([row, col]);
          colHasSymbol = true;
        }
      }
      if (colHasSymbol) matchingColumns += 1;
    }
    return {
      isWin: matchingColumns === reels.length,
      jackpotWinningPositions: positions,
      winningSymbol: winningSymbol,
      reelsCount: reels.length,
      matchingColumns: matchingColumns
    };
  }

  // ── Check Wins ─────────────────────────────────────────────────────────────────────────────────
  // The built-in table: twenty 5-long lines over columns 0-4, rows 0-2, [col, row]. The RGS once
  // stopped at the first five (2026-07-03); it is one table now.
  var DEFAULT_PAYLINES = [
    [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]], [[0, 1], [1, 1], [2, 1], [3, 1], [4, 1]],
    [[0, 2], [1, 2], [2, 2], [3, 2], [4, 2]], [[0, 0], [1, 1], [2, 2], [3, 1], [4, 0]],
    [[0, 2], [1, 1], [2, 0], [3, 1], [4, 2]], [[0, 0], [1, 0], [2, 1], [3, 2], [4, 2]],
    [[0, 2], [1, 2], [2, 1], [3, 0], [4, 0]], [[0, 0], [1, 1], [2, 0], [3, 1], [4, 0]],
    [[0, 2], [1, 1], [2, 2], [3, 1], [4, 2]], [[0, 1], [1, 0], [2, 0], [3, 0], [4, 1]],
    [[0, 1], [1, 2], [2, 2], [3, 2], [4, 1]], [[0, 1], [1, 0], [2, 1], [3, 2], [4, 1]],
    [[0, 1], [1, 2], [2, 1], [3, 0], [4, 1]], [[0, 0], [1, 1], [2, 1], [3, 1], [4, 0]],
    [[0, 2], [1, 1], [2, 1], [3, 1], [4, 2]], [[0, 0], [1, 0], [2, 2], [3, 2], [4, 0]],
    [[0, 2], [1, 2], [2, 0], [3, 0], [4, 2]], [[0, 0], [1, 2], [2, 0], [3, 2], [4, 0]],
    [[0, 2], [1, 0], [2, 2], [3, 0], [4, 2]], [[0, 1], [1, 2], [2, 0], [3, 2], [4, 1]]
  ];
  function defaultPaylines() {
    return DEFAULT_PAYLINES.map(function (line) { return line.map(function (cell) { return [cell[0], cell[1]]; }); });
  }
  function checkWinsArgs(a) {
    return {
      wildSymbol: numberOr(a.wildSymbol, 9),
      freeSpinsSymbol: numberOr(a.freeSpinsSymbol, 10),
      minConsecutiveSymbols: atLeastOne(a.minConsecutiveSymbols, 3),
      reels: orEmpty(a.reels),
      customPaylines: arrayInput(a.customPaylines) || null
    };
  }
  function checkWins(a) {
    var p = checkWinsArgs(a);
    var wildSymbol = p.wildSymbol;
    var freeSpinsSymbol = p.freeSpinsSymbol;
    var minConsecutiveSymbols = p.minConsecutiveSymbols;
    var reels = p.reels;
    if (!Array.isArray(reels) || reels.length === 0) throw new Error('Reels must be a non-empty array');

    var notes = [];
    var winningLines = [];
    var dropped = 0;
    var numRows = reels[0].length;
    var numCols = reels.length;
    var paylines = p.customPaylines ? p.customPaylines : defaultPaylines();

    for (const [lineIndex, lineValue] of paylines.entries()) {
      const line = [];
      for (const [idx, pos] of lineValue.entries()) {
        let tuple = pos;
        if (!Array.isArray(tuple) && typeof tuple === 'object' && tuple !== null && 'col' in tuple && 'row' in tuple) {
          tuple = [tuple.col, tuple.row];
          notes.push(['warn', 'Check Wins: Payline position at index ' + idx + ' was {col, row} object — auto-coerced to [' + tuple + ']. Use [col, row] tuples instead.']);
        }
        if (Array.isArray(tuple)) {
          const [col, row] = tuple;
          if (row >= numRows || col >= numCols) {
            notes.push(['error', 'Check Wins: Index out of range at payline position ' + idx + ': col=' + col + ', row=' + row + ', but reels are ' + numCols + '×' + numRows + '. Check your customPaylines match the grid size.']);
            continue;
          }
          line.push(reels[col][row]);
        } else {
          notes.push(['error', 'Check Wins: Expected [col, row] tuple at payline position ' + idx + ', got: ' + JSON.stringify(pos) + ' (type: ' + typeof pos + '). customPaylines must be Array<Array<[col, row]>>, e.g. [[[0,0],[1,0],[2,0]],...]']);
        }
      }

      // free spins symbol interference: a scatter before a run can form kills the line
      if (line.includes(wildSymbol) && line.includes(freeSpinsSymbol)) {
        const freeSpinsIndex = line.indexOf(freeSpinsSymbol);
        const winPossible = line
          .slice(0, Math.min(freeSpinsIndex, minConsecutiveSymbols))
          .some(function (sym) { return sym === wildSymbol || (sym === line[0] && line[0] !== freeSpinsSymbol); });
        if (!winPossible) {
          dropped++;
          notes.push(['info', 'Skipping line ' + lineIndex + ' due to free spins symbol interference.']);
          continue;
        }
      }
      if (line.every(function (symbol) { return symbol === wildSymbol; })) {
        notes.push(['info', 'Skipping line ' + lineIndex + ' because it consists entirely of wild symbols.']);
        continue;
      }
      if (line.every(function (symbol) { return symbol === freeSpinsSymbol; })) {
        notes.push(['info', 'Skipping line ' + lineIndex + ' because it consists entirely of free spins symbols.']);
        continue;
      }

      let firstNonWildSymbol = null;
      let isWin = true;
      let longestWinLine = [];
      for (let i = 0; i < line.length; i++) {
        const symbol = line[i];
        if (symbol !== wildSymbol) {
          if (firstNonWildSymbol === null) {
            firstNonWildSymbol = symbol;
          } else if (symbol !== firstNonWildSymbol) {
            isWin = false;
            break;
          }
        }
        if (isWin && i >= minConsecutiveSymbols - 1) longestWinLine = line.slice(0, i + 1);
      }
      if (longestWinLine.length) winningLines.push([lineIndex + 1, longestWinLine]);
    }
    return {
      winningLines: winningLines,
      paylines: paylines,
      droppedByFreeSpinsInterference: dropped,
      wildSymbol: wildSymbol,
      freeSpinsSymbol: freeSpinsSymbol,
      minConsecutiveSymbols: minConsecutiveSymbols,
      notes: notes
    };
  }

  // ── Calculate Winnings ─────────────────────────────────────────────────────────────────────────
  // The stake is per line (betAmount / paylines), each line rounded — unchanged; the unrounded value
  // is reported so the editor can say what the rounding cost.

  function calculateWinningsArgs(a) {
    return {
      winningLines: orEmpty(a.winningLines),
      betAmount: Math.min(Math.max(Number(a.betAmount) || 100, 1), 1000000),
      wildSymbol: numberOr(a.wildSymbol, 9),
      paytable: a.paytable || {},
      paylines: orEmpty(a.paylines)
    };
  }
  function paylineValueUnrounded(winLine, betAmount, wildSymbol, paytable, paylines) {
    const payoutMultiplier = winLine[1].length;
    const betAmountPerLine = betAmount / paylines.length;
    let payoutSymbol = null;
    for (const symbol of winLine[1]) {
      if (symbol !== wildSymbol) {
        payoutSymbol = symbol;
        break;
      }
    }
    if (payoutSymbol in paytable && payoutMultiplier in paytable[payoutSymbol]) {
      return betAmountPerLine * paytable[payoutSymbol][payoutMultiplier];
    }
    return 0;
  }
  function calculateSymbolsPosition(winLine, paylines) {
    const lineIndex = winLine[0] - 1;
    const sequenceLength = winLine[1].length;
    const positions = [];
    const lineToCheck = paylines[lineIndex];
    for (let i = 0; i < sequenceLength; i++) {
      const [col, row] = lineToCheck[i];
      positions.push([row, col]);
    }
    return positions;
  }
  function calculateWinnings(a) {
    var p = calculateWinningsArgs(a);
    var winningLines = p.winningLines;
    var betAmount = p.betAmount;
    var wildSymbol = p.wildSymbol;
    var paytable = p.paytable;
    var paylines = p.paylines;
    if (!Array.isArray(winningLines)) throw new Error('Winning lines must be an array');
    if (betAmount <= 0) return { spinWinnings: 0, winningLinesDetails: [], unroundedSpinWinnings: 0, linesQuantisedToZero: 0, firstQuantisedLine: null, betAmountPerLine: null };
    if (!paytable || typeof paytable !== 'object') throw new Error('Paytable must be a valid object');
    if (!Array.isArray(paylines) || paylines.length === 0) throw new Error('Paylines must be a non-empty array');

    var spinWinnings = 0;
    var winningLinesDetails = [];
    var unroundedSpinWinnings = 0;
    var linesQuantisedToZero = 0;
    var firstQuantisedLine = null;
    for (const winLine of winningLines) {
      const exactPayout = paylineValueUnrounded(winLine, betAmount, wildSymbol, paytable, paylines);
      const linePayout = Math.round(exactPayout);
      unroundedSpinWinnings += exactPayout;
      if (exactPayout > 0 && linePayout === 0) {
        linesQuantisedToZero++;
        if (!firstQuantisedLine) firstQuantisedLine = { line: winLine[0], symbols: winLine[1], exactPayout: exactPayout };
      }
      if (linePayout > 0) {
        spinWinnings += linePayout;
        winningLinesDetails.push({ line: winLine[0], symbols: winLine[1], positions: calculateSymbolsPosition(winLine, paylines), payout: linePayout });
      }
    }
    return {
      spinWinnings: spinWinnings,
      winningLinesDetails: winningLinesDetails,
      unroundedSpinWinnings: unroundedSpinWinnings,
      linesQuantisedToZero: linesQuantisedToZero,
      firstQuantisedLine: firstQuantisedLine,
      betAmountPerLine: betAmount / paylines.length
    };
  }

  // ── Get Paytable ───────────────────────────────────────────────────────────────────────────────

  function getPaytableArgs(a) {
    return {
      numberOfSymbols: atLeastOne(a.numberOfSymbols, 10),
      columnSize: atLeastOne(a.columnSize, 5),
      minConsecutiveSymbols: atLeastOne(a.minConsecutiveSymbols, 3),
      payoutFormula: a.payoutFormula || '2.25 + 0.75 * x'
    };
  }
  /** a.symbolPayout<N> (N = symbol, 1-based) overrides the formula for that symbol. */
  function getPaytable(a) {
    var p = getPaytableArgs(a);
    var paytable = {};
    for (var symbol = 1; symbol <= p.numberOfSymbols; symbol++) {
      for (var comboLength = p.minConsecutiveSymbols; comboLength <= p.columnSize; comboLength++) {
        if (!paytable[symbol]) paytable[symbol] = {};
        var override = overrideValue(a['symbolPayout' + symbol]);
        paytable[symbol][comboLength] = typeof override === 'number'
          ? override * comboLength
          : evaluateFormula(p.payoutFormula, symbol) * comboLength;
      }
    }
    return { paytable: paytable, numberOfSymbols: p.numberOfSymbols, columnSize: p.columnSize, minConsecutiveSymbols: p.minConsecutiveSymbols, payoutFormula: p.payoutFormula };
  }

  // ── Generate Symbol Weights ────────────────────────────────────────────────────────────────────

  function generateSymbolWeightsArgs(a) {
    return {
      numberOfSymbols: Math.max(Math.floor(Number(a.numberOfSymbols) || 10), 1),
      weightFormula: a.weightFormula || 'exp(-x / 15)'
    };
  }
  /** a.symbolWeight<N> (N = symbol, 1-based) overrides the formula for that symbol. */
  function generateSymbolWeights(a) {
    var p = generateSymbolWeightsArgs(a);
    var N = p.numberOfSymbols;
    var formula = p.weightFormula;
    var baseWeights = [];
    for (var i = 0; i < N; i++) {
      var x = i + 1;
      try {
        baseWeights.push(evaluateFormula(formula, x));
      } catch (e) {
        throw new Error('Generate Symbol Weights: weightFormula "' + formula + '" is not a valid formula in x (failed at x=' + x + ': ' + e.message +
          '). Use a formula such as "exp(-x / 15)", "10 - x", or "1 / x" — a bare word like "exponential" is NOT valid. Alternatively set per-symbol weights via the symbolWeight1..' + N + ' ports.');
      }
    }
    var finalWeights = baseWeights.map(function (w, j) {
      var override = overrideValue(a['symbolWeight' + (j + 1)]);
      return typeof override === 'number' ? override : w;
    });
    var totalWeight = finalWeights.reduce(function (s, w) { return s + w; }, 0);
    if (totalWeight === 0) {
      throw new Error('Generate Symbol Weights: total weight is zero — every symbol would have 0 probability, so reel strips can\'t be generated and the spin chain stops here (Done never fires → downstream reels never stop). Cause: weightFormula "' +
        formula + '" evaluates to 0 for all ' + N + ' symbols, OR all symbolWeight1..' + N + ' overrides are 0. Set a non-degenerate formula (e.g. "exp(-x / 15)") or non-zero custom weights.');
    }
    if (!isFinite(totalWeight)) {
      throw new Error('Generate Symbol Weights: total weight is ' + totalWeight + ' — a symbolWeight1..' + N + ' override is not a finite number, so no weight can be normalised. Give every override a finite number or clear it.');
    }
    return {
      normalizedBaseWeights: finalWeights.map(function (w) { return (w / totalWeight) * 100; }),
      baseWeights: baseWeights,
      finalWeights: finalWeights,
      totalWeight: totalWeight,
      numberOfSymbols: N,
      weightFormula: formula
    };
  }

  // ── Reel Strips Generator ──────────────────────────────────────────────────────────────────────
  // A missing input is a `failure` (the editor fires Failure as well as Done); the RGS refuses it.

  function lcg(seed) {
    var s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return function () {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }
  function shuffled(array, next) {
    var out = array.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(next() * (i + 1));
      var t = out[i];
      out[i] = out[j];
      out[j] = t;
    }
    return out;
  }
  /** One reel holding each symbol ceil(weight / smallest weight) times (also Weighted Reels' dynamic base reel). */
  function baseReelOf(symbolWeights) {
    var minWeight = Math.min.apply(null, symbolWeights);
    var relative = symbolWeights.map(function (w) { return Math.ceil(w / minWeight); });
    var baseReel = [];
    for (var i = 1; i <= symbolWeights.length; i++) baseReel.push(...Array(relative[i - 1]).fill(i));
    return { baseReel: baseReel, relative: relative };
  }
  function reelStripsGenerator(a) {
    var symbolWeights = arrayOrEmpty(a.symbolWeights);
    var randomSeeds = arrayOrEmpty(a.randomSeeds);
    var columnSize = atLeastOne(a.columnSize, 5);
    if (symbolWeights.length === 0) {
      return {
        failure: 'symbolWeights',
        message: 'Symbol weights not available — ensure data is connected and flows before Do signal',
        consoleMessage: 'Reel Strips Generator: symbolWeights not yet available, skipping generation'
      };
    }
    if (randomSeeds.length < columnSize) {
      return {
        failure: 'randomSeeds',
        message: 'Random seeds need ' + columnSize + ' elements — set randomSeeds to a FIXED list, one seed per strip (the strips are the game\'s odds: never wire TRNG/ISAAC into randomSeeds)',
        consoleMessage: 'Reel Strips Generator: randomSeeds needs at least ' + columnSize + ' elements, got ' + randomSeeds.length
      };
    }
    if (!symbolWeights.every(function (w) { return typeof w === 'number' && w > 0; })) throw new Error('All symbol weights must be positive numbers');
    var base = baseReelOf(symbolWeights);
    var reelStrips = [];
    for (var i = 0; i < columnSize; i++) reelStrips.push(shuffled(base.baseReel, lcg(randomSeeds[i])));
    return { reelStrips: reelStrips, baseReel: base.baseReel, symbolWeightsRelativeToMin: base.relative, columnSize: columnSize, symbolWeights: symbolWeights };
  }

  // ── Weighted Reels ─────────────────────────────────────────────────────────────────────────────
  // One certified value per outcome (2026-10-04, certification): every outcome takes its own Seeds
  // value, scaled as floor(v * n / 1e12); too few values, or one that is not ISAAC output, is refused.
  // `freeSpin: true` runs the Free Spin Trigger paths (the editor's freeSpinTrigger signal; on the RGS
  // a wired freeSpinTrigger that fired this round) — the RGS used to have no free-spin path at all.

  var SEED_RANGE = 1e12;
  function scaledIndex(v, n) {
    return Math.min(n - 1, Math.floor((v * n) / SEED_RANGE));
  }
  function requireReelSeeds(seeds, needed, sizeHint) {
    var have = Array.isArray(seeds) ? seeds.length : 0;
    if (have === 0) {
      throw new Error('[Weighted Reels] Seeds is required (' + needed + ' needed, got 0): wire ' +
        'ISAAC Random Number Array Generator.array → Seeds (ISAAC size >= ' + sizeHint + '). ' +
        'Unseeded spins are not provably fair and are refused.');
    }
    if (have < needed) {
      throw new Error('[Weighted Reels] Seeds has ' + have + ' values but ' + needed + ' are needed: every random outcome ' +
        'takes its own Seeds value and none is reused. Set the ISAAC Random Number Array Generator feeding ' +
        'Seeds to size >= ' + sizeHint + '.');
    }
    for (var k = 0; k < needed; k++) {
      var v = seeds[k];
      if (typeof v !== 'number' || !(v >= 0 && v < SEED_RANGE) || (v > 0 && v < 1)) {
        throw new Error('[Weighted Reels] Seeds[' + k + '] = ' + String(v) + ' is not an ISAAC Random Number Array Generator value ' +
          '(a number, 0 <= n < 1e12; a 0..1 float is refused). Wire ISAAC Random Number Array Generator.array → Seeds.');
      }
    }
    return seeds;
  }
  function weightedReelsArgs(a) {
    var fs = a.freeSpinSymbol;
    var parsed = Number(fs);
    return {
      reelStrips: arrayOrEmpty(a.reelStrips),
      seeds: arrayOrEmpty(a.Seeds),
      rowSize: atLeastOne(a.rowSize, 3),
      symbolWeights: arrayOrEmpty(a.symbolWeights),
      freeSpinSymbol: fs === undefined || fs === null ? null : (Number.isNaN(parsed) ? fs : parsed),
      blockedReels: a.blockedReels === undefined || a.blockedReels === null ? '0,4' : String(a.blockedReels),
      stopPosList: arrayOrEmpty(a.stopPosList),
      isDynamic: Boolean(a.isDynamic)
    };
  }
  function checkStrips(reelStrips) {
    if (!Array.isArray(reelStrips) || reelStrips.length === 0) throw new Error('Reel strips array is required and cannot be empty');
    if (!reelStrips.every(function (strip) { return Array.isArray(strip); })) throw new Error('All reel strips must be arrays');
    var reelStripLength = reelStrips[0].length;
    if (reelStripLength === 0) throw new Error('Reel strips cannot be empty');
    if (!reelStrips.every(function (strip) { return strip.length === reelStripLength; })) throw new Error('All reel strips must have the same length');
    return reelStripLength;
  }
  function inputStopsUsable(stops, reelStrips, reelStripLength) {
    return Array.isArray(stops) && stops.length === reelStrips.length &&
      stops.every(function (pos) { return Number.isInteger(pos) && pos >= 0 && pos < reelStripLength; });
  }
  function windowAt(strip, pointerPos, rowSize, length) {
    return Array.from({ length: rowSize }, function (_, i) { return strip[(pointerPos + i) % length]; });
  }
  function staticReels(p) {
    var reelStrips = p.reelStrips;
    var reelStripLength = checkStrips(reelStrips);
    var useInputStops = inputStopsUsable(p.stopPosList, reelStrips, reelStripLength);
    if (!useInputStops) requireReelSeeds(p.seeds, reelStrips.length, 'the number of reels (' + reelStrips.length + ')');
    var reels = [];
    var stopPosList = [];
    for (var idx = 0; idx < reelStrips.length; idx++) {
      var pointerPos = useInputStops ? p.stopPosList[idx] : scaledIndex(p.seeds[idx], reelStripLength);
      stopPosList.push(pointerPos);
      reels.push(windowAt(reelStrips[idx], pointerPos, p.rowSize, reelStripLength));
    }
    return { mode: 'static', reels: reels, stopPosList: stopPosList, reelStripLength: reelStripLength, stopPosSource: useInputStops ? 'input' : 'seeded' };
  }
  function staticReelsWithFreeSpin(p) {
    var reelStrips = p.reelStrips;
    var reelStripLength = checkStrips(reelStrips);
    var useInputStops = inputStopsUsable(p.stopPosList, reelStrips, reelStripLength);
    var freeSpinSymbol = p.freeSpinSymbol;
    var freeSpinPositionsOf = reelStrips.map(function (strip) {
      var positions = [];
      if (freeSpinSymbol !== null && freeSpinSymbol !== undefined) {
        for (var s = 0; s < reelStripLength; s++) if (strip[s] === freeSpinSymbol) positions.push(s);
      }
      return positions;
    });
    var reelCount = reelStrips.length;
    if (!useInputStops) {
      var anyFreeSpin = freeSpinPositionsOf.some(function (positions) { return positions.length > 0; });
      requireReelSeeds(p.seeds, anyFreeSpin ? 2 * reelCount : reelCount,
        anyFreeSpin ? '2 x the number of reels (' + 2 * reelCount + ')' : 'the number of reels (' + reelCount + ')');
    }
    var reels = [];
    var stopPosList = [];
    var freeSpinApplied = [];
    for (var idx = 0; idx < reelCount; idx++) {
      var pointerPos;
      var usedFreeSpin = false;
      if (useInputStops) {
        pointerPos = p.stopPosList[idx];
      } else if (freeSpinPositionsOf[idx].length > 0) {
        var positions = freeSpinPositionsOf[idx];
        var selectedIndex = positions[scaledIndex(p.seeds[idx], positions.length)];
        var rowOffset = scaledIndex(p.seeds[reelCount + idx], p.rowSize);
        // the view starting rowSize - 1 - rowOffset above the free-spin position shows it on row
        // rowSize - 1 - rowOffset: every visible row is equally likely
        var rawPointerPos = selectedIndex - (p.rowSize - 1) + rowOffset;
        pointerPos = ((rawPointerPos % reelStripLength) + reelStripLength) % reelStripLength;
        usedFreeSpin = true;
      } else {
        pointerPos = scaledIndex(p.seeds[idx], reelStripLength);
      }
      stopPosList.push(pointerPos);
      freeSpinApplied.push(usedFreeSpin);
      reels.push(windowAt(reelStrips[idx], pointerPos, p.rowSize, reelStripLength));
    }
    return {
      mode: 'static-free-spin', reels: reels, stopPosList: stopPosList, reelStripLength: reelStripLength, freeSpinApplied: freeSpinApplied,
      stopPosSource: useInputStops ? 'input' : freeSpinApplied.some(function (x) { return x; }) ? 'seeded-free-spin' : 'seeded'
    };
  }
  function checkDynamic(p) {
    if (!Array.isArray(p.reelStrips) || p.reelStrips.length === 0) throw new Error('Reel strips array is required and cannot be empty to determine column size');
    if (!Array.isArray(p.symbolWeights) || p.symbolWeights.length === 0) throw new Error('Symbol weights array is required and cannot be empty for dynamic mode');
    if (!p.symbolWeights.every(function (w) { return typeof w === 'number' && w > 0; })) throw new Error('All symbol weights must be positive numbers');
  }
  function dynamicReels(p) {
    checkDynamic(p);
    var columnSize = p.reelStrips.length;
    var rowSize = p.rowSize;
    var base = baseReelOf(p.symbolWeights);
    var seeds = requireReelSeeds(p.seeds, rowSize * columnSize, 'rows x columns (' + rowSize + ' x ' + columnSize + ' = ' + rowSize * columnSize + ')');
    var reels = [];
    for (var col = 0; col < columnSize; col++) {
      var reel = [];
      for (var row = 0; row < rowSize; row++) reel.push(base.baseReel[scaledIndex(seeds[col * rowSize + row], base.baseReel.length)]);
      reels.push(reel);
    }
    return { mode: 'dynamic', reels: reels, stopPosList: [], baseReel: base.baseReel, symbolWeightsRelativeToMin: base.relative, columnSize: columnSize };
  }
  function dynamicReelsWithFreeSpin(p) {
    checkDynamic(p);
    var freeSpinSymbol = p.freeSpinSymbol;
    if (!Number.isFinite(freeSpinSymbol)) return dynamicReels(p);
    if (typeof p.blockedReels !== 'string') throw new Error('Blocked reels must be a valid comma-separated string');
    // empty entries mean no blocked reel ("" is [], not [0])
    var blockedReelIndices = p.blockedReels.split(',')
      .map(function (idx) { return idx.trim(); })
      .filter(function (idx) { return idx.length > 0; })
      .map(function (idx) {
        var parsed = Number(idx);
        if (isNaN(parsed)) throw new Error('Invalid blocked reel index: "' + idx + '"');
        return parsed;
      });
    var columnSize = p.reelStrips.length;
    var rowSize = p.rowSize;
    var base = baseReelOf(p.symbolWeights);
    var withoutFreeSpin = base.baseReel.filter(function (s) { return s !== freeSpinSymbol; });
    var fallbackReel = withoutFreeSpin.length > 0 ? withoutFreeSpin : base.baseReel;
    var seeds = requireReelSeeds(p.seeds, rowSize * columnSize, 'rows x columns (' + rowSize + ' x ' + columnSize + ' = ' + rowSize * columnSize + ')');
    var reels = [];
    var freeSpinRows = [];
    for (var col = 0; col < columnSize; col++) {
      var reel = [];
      var next = col * rowSize;
      if (blockedReelIndices.indexOf(col) >= 0) {
        for (var r = 0; r < rowSize; r++) reel.push(base.baseReel[scaledIndex(seeds[next++], base.baseReel.length)]);
        freeSpinRows.push(null);
      } else {
        var freeSpinRow = scaledIndex(seeds[next++], rowSize);
        freeSpinRows.push(freeSpinRow);
        for (var row = 0; row < rowSize; row++) {
          reel.push(row === freeSpinRow ? freeSpinSymbol : fallbackReel[scaledIndex(seeds[next++], fallbackReel.length)]);
        }
      }
      reels.push(reel);
    }
    return {
      mode: 'dynamic-free-spin', reels: reels, stopPosList: [], baseReel: base.baseReel, symbolWeightsRelativeToMin: base.relative,
      baseReelWithoutFreeSpinLength: fallbackReel.length, columnSize: columnSize, blockedReelIndices: blockedReelIndices, freeSpinRows: freeSpinRows
    };
  }
  function weightedReels(a) {
    var p = weightedReelsArgs(a);
    var r = a.freeSpin === true
      ? (p.isDynamic ? dynamicReelsWithFreeSpin(p) : staticReelsWithFreeSpin(p))
      : (p.isDynamic ? dynamicReels(p) : staticReels(p));
    r.rowSize = p.rowSize;
    return r;
  }

  // ── Spin Calculate ─────────────────────────────────────────────────────────────────────────────
  // The stake is clamped to 1..1,000,000 like Calculate Winnings (the RGS used to charge it unclamped).

  function spinCalculate(a) {
    var betAmount = Math.min(Math.max(Number(a.betAmount) || 100, 1), 1000000);
    var capital = Number(a.capital) || 0;
    var totalBets = Number(a.totalBets) || 0;
    var spinWinnings = Number(a.spinWinnings) || 0;
    var totalWinnings = Number(a.totalWinnings) || 0;
    var currentFreeSpins = Number(a.currentFreeSpins) || 0;
    var totalWinningsFromFreeSpins = Number(a.totalWinningsFromFreeSpins) || 0;
    var spinCount = Number(a.spinCount) || 0;
    var hits = Number(a.hits) || 0;
    var jackpotWinnings = Number(a.jackpotWinnings) || 0;
    var winningJackpot = Boolean(a.winningJackpot);
    // "a mid-cascade payout, not the spin itself" — see the node description for the contract
    var isCascadingInProgress = Boolean(a.cascadingReelsEnabled) && spinWinnings > 0;
    var charged = false;
    if (!isCascadingInProgress && currentFreeSpins === 0) {
      capital -= betAmount;
      totalBets += betAmount;
      charged = true;
    }
    if (spinWinnings > 0) {
      capital += spinWinnings;
      if (!isCascadingInProgress) hits++;
      totalWinnings += spinWinnings;
      if (currentFreeSpins > 0) totalWinningsFromFreeSpins += spinWinnings;
    }
    if (winningJackpot && jackpotWinnings > 0) {
      capital += jackpotWinnings;
      totalWinnings += jackpotWinnings;
    }
    if (!isCascadingInProgress) spinCount++;
    return {
      capital: capital, totalBets: totalBets, totalWinnings: totalWinnings, totalWinningsFromFreeSpins: totalWinningsFromFreeSpins,
      spinCount: spinCount, hits: hits, charged: charged, betAmount: betAmount, spinWinnings: spinWinnings,
      inputCapital: Number(a.capital) || 0, inputTotalBets: Number(a.totalBets) || 0, inputSpinCount: Number(a.spinCount) || 0
    };
  }

  // ── Spin Result (state: the two simulation series) ─────────────────────────────────────────────

  function spinResult(state, a) {
    state = state || {};
    var reels = orEmpty(a.reels);
    var stopPosList = orEmpty(a.stopPosList);
    var spinWinnings = Number(a.spinWinnings) || 0;
    var betAmount = Number(a.betAmount) || 0;
    var totalBets = Number(a.totalBets) || 0;
    var totalWinnings = Number(a.totalWinnings) || 0;
    var hits = Number(a.hits) || 0;
    var spinCount = Number(a.spinCount) || 0;
    var currentFreeSpinsWon = Number(a.currentFreeSpinsWon) || 0;
    var totalFreeSpinsWon = Number(a.totalFreeSpinsWon) || 0;
    var currentFreeSpins = Number(a.currentFreeSpins) || 0;
    var freeSpinsSymbolCount = Number(a.freeSpinsSymbolCount) || 0;
    var currentFreeSpinsLines = orEmpty(a.currentFreeSpinsLines);
    var winningLinesDetails = orEmpty(a.winningLinesDetails);
    var hitFrequencyDataSeries = a.hitFrequencyDataSeries !== undefined ? orEmpty(a.hitFrequencyDataSeries) : (state.hitFrequencyDataSeries || []);
    var RTPDataSeries = a.RTPDataSeries !== undefined ? orEmpty(a.RTPDataSeries) : (state.RTPDataSeries || []);
    var jackpotWinnings = Number(a.jackpotWinnings) || 0;
    var winningJackpot = Boolean(a.winningJackpot);
    var jackpotWinningPositions = arrayOrEmpty(a.jackpotWinningPositions);

    var slotResults = reels.length > 0 && reels[0] ? reels[0].map(function (_, i) { return reels.map(function (col) { return col[i]; }); }) : [];
    var finalResult = {
      stopPosList: stopPosList,
      isBigWin: spinWinnings > betAmount * 1000,
      totalBets: totalBets,
      totalWinnings: totalWinnings,
      hitFrequency: spinCount > 0 ? (hits / spinCount) * 100 : 0,
      RTP: totalBets > 0 ? (totalWinnings / totalBets) * 100 : 0,
      currentFreeSpinsWon: currentFreeSpinsWon || 0,
      totalFreeSpinsWon: totalFreeSpinsWon || 0,
      currentFreeSpins: currentFreeSpins || 0,
      currentFreeSpinsLines: currentFreeSpinsLines || []
    };
    if (Boolean(a.enableSimulation)) {
      if (Array.isArray(hitFrequencyDataSeries)) hitFrequencyDataSeries = hitFrequencyDataSeries.concat([finalResult.hitFrequency]);
      if (Array.isArray(RTPDataSeries)) RTPDataSeries = RTPDataSeries.concat([finalResult.RTP]);
    }
    var symbols = [];
    var positions = [];
    var posCount = 0;
    for (const line of finalResult.currentFreeSpinsLines) {
      posCount++;
      if (line.symbols && line.symbols.length > 0) symbols.push(line.symbols[0]);
      if (line.positions && line.positions.length > 0) positions.push([line.positions[0], posCount - 1]);
    }
    var spinResults = {
      totalPayout: spinWinnings + (winningJackpot ? jackpotWinnings : 0),
      slotResults: slotResults,
      winningLinesDetails: JSON.parse(JSON.stringify(winningLinesDetails || [])),
      freeSpins: { awarded: currentFreeSpinsWon, count: freeSpinsSymbolCount, positions: positions, symbols: symbols }
    };
    if (winningJackpot) {
      var jackpotSymbol = null;
      if (Array.isArray(reels) && reels.length && jackpotWinningPositions.length) {
        const [row, col] = jackpotWinningPositions[0];
        if (Number.isInteger(col) && Number.isInteger(row) && col >= 0 && col < reels.length && Array.isArray(reels[col]) && row >= 0 && row < reels[col].length) {
          jackpotSymbol = reels[col][row];
        }
      }
      spinResults.jackpotWinningDetails = {
        symbols: jackpotSymbol != null ? Array(reels.length).fill(jackpotSymbol) : [],
        positions: jackpotWinningPositions,
        payout: jackpotWinnings
      };
    }
    finalResult.spinResults = spinResults;
    return {
      finalResult: finalResult,
      stopPosList: finalResult.stopPosList || [],
      isBigWin: !!finalResult.isBigWin,
      totalBets: finalResult.totalBets || 0,
      totalWinnings: finalResult.totalWinnings || 0,
      hitFrequency: finalResult.hitFrequency || 0,
      RTP: finalResult.RTP || 0,
      currentFreeSpinsWon: finalResult.currentFreeSpinsWon || 0,
      totalFreeSpinsWon: finalResult.totalFreeSpinsWon || 0,
      currentFreeSpins: finalResult.currentFreeSpins || 0,
      currentFreeSpinsLines: finalResult.currentFreeSpinsLines || [],
      spinResults: finalResult.spinResults || {},
      hitFrequencyDataSeries: hitFrequencyDataSeries || [],
      RTPDataSeries: RTPDataSeries || [],
      slotResultsRows: slotResults.length,
      updatedState: { hitFrequencyDataSeries: hitFrequencyDataSeries, RTPDataSeries: RTPDataSeries }
    };
  }

  // ── Calculate Free Spins States ────────────────────────────────────────────────────────────────

  var DEFAULT_FREE_SPINS_REWARD_FORMULA = 'x <= 1 ? 0 : (x * (x + 1)) / 2';
  /** a.freeSpinsRewardCount<N> (N = scatter count) overrides the reward formula for that count. */
  function calculateFreeSpinsStates(a) {
    var reels = arrayOrEmpty(a.engineReels);
    var currentFreeSpins = Number(a.currentFreeSpins) || 0;
    var betAmount = Number(a.betAmount) || 0;
    var capital = Number(a.capital) || 0;
    var totalBets = Number(a.totalBets) || 0;
    var totalFreeSpinsWon = Number(a.totalFreeSpinsWon) || 0;
    var blockedReels = blockedReelsInput(a.blockedReels);
    var freeSpinsSymbol = numberOr(a.freeSpinsSymbol, 10);
    var formula = a.freeSpinsRewardFormula || DEFAULT_FREE_SPINS_REWARD_FORMULA;
    if (reels.length === 0) throw new Error('Engine reels array is required and cannot be empty');
    var blockedReelIndices = parseBlockedReels(blockedReels);
    if (currentFreeSpins > 0) {
      capital += betAmount;
      totalBets -= betAmount;
      currentFreeSpins--;
    }
    var freeSpinsSymbolCount = 0;
    var currentFreeSpinsLines = [];
    for (var reelIdx = 0; reelIdx < reels.length; reelIdx++) {
      if (blockedReelIndices.includes(reelIdx)) continue;
      var reel = reels[reelIdx];
      if (!Array.isArray(reel)) continue;
      for (var lineIdx = 0; lineIdx < reel.length; lineIdx++) {
        if (reel[lineIdx] === freeSpinsSymbol) {
          freeSpinsSymbolCount++;
          currentFreeSpinsLines.push({ symbols: [reel[lineIdx]], positions: [[lineIdx, reelIdx]] });
          break; // once per reel
        }
      }
    }
    var won;
    var raw = a['freeSpinsRewardCount' + freeSpinsSymbolCount];
    var override = raw === undefined || raw === null || raw === '' ? NaN : Number(raw);
    if (Number.isFinite(override)) {
      won = override;
    } else {
      try {
        won = evaluateFormula(formula, freeSpinsSymbolCount);
      } catch (e) {
        throw new Error('Free spins reward formula error: ' + e.message);
      }
    }
    return {
      capital: capital,
      totalBets: totalBets,
      currentFreeSpins: currentFreeSpins + won,
      freeSpinsSymbolCount: freeSpinsSymbolCount,
      currentFreeSpinsWon: won,
      totalFreeSpinsWon: totalFreeSpinsWon + won,
      currentFreeSpinsLines: currentFreeSpinsLines,
      blockedReels: blockedReels,
      blockedReelIndices: blockedReelIndices,
      freeSpinsSymbol: freeSpinsSymbol,
      freeSpinsRewardFormula: formula
    };
  }

  // ── Init Free Spins ────────────────────────────────────────────────────────────────────────────
  // Replaces the first free-spins symbol of each blocked reel with symbol 1, on a COPY of the input.

  function initFreeSpins(a) {
    var reelStrips = arrayOrEmpty(a.reelStrips);
    var freeSpinsSymbol = numberOr(a.freeSpinsSymbol, 10);
    var blockedReels = blockedReelsInput(a.blockedReels);
    if (reelStrips.length === 0) throw new Error('Reel strips array is required and cannot be empty');
    var modified = reelStrips.map(function (reel) { return [...reel]; });
    var blockedReelIndices = parseBlockedReels(blockedReels);
    var notes = [];
    for (var i = 0; i < blockedReelIndices.length; i++) {
      var reelIdx = blockedReelIndices[i];
      if (reelIdx < 0 || reelIdx >= modified.length) {
        notes.push(['warn', 'Blocked reel index ' + reelIdx + ' is out of bounds, skipping']);
        continue;
      }
      var at = modified[reelIdx].indexOf(freeSpinsSymbol);
      if (at !== -1) modified[reelIdx][at] = 1;
    }
    return { reelStrips: modified, freeSpinsSymbol: freeSpinsSymbol, blockedReels: blockedReels, blockedReelIndices: blockedReelIndices, notes: notes };
  }

  // ── Reel Ways Check Wins ───────────────────────────────────────────────────────────────────────

  function cartesianProduct(arrays) {
    return arrays.reduce(function (acc, b) { return acc.flatMap(function (d) { return b.map(function (e) { return d.concat([e]); }); }); }, [[]]);
  }
  function checkReelWaysWinsArgs(a) {
    return {
      numberOfSymbols: numberOr(a.numberOfSymbols, 8),
      wildSymbol: numberOr(a.wildSymbol, 9),
      freeSpinsSymbol: numberOr(a.freeSpinsSymbol, 10),
      reels: arrayOrEmpty(a.reels),
      minConsecutiveSymbols: atLeastOne(a.minConsecutiveSymbols, 3)
    };
  }
  function checkReelWaysWins(a) {
    var p = checkReelWaysWinsArgs(a);
    var reels = p.reels;
    var wildSymbol = p.wildSymbol;
    if (reels.length === 0) throw new Error('Reels array is required and cannot be empty');
    if (!reels.every(function (reel) { return Array.isArray(reel); })) throw new Error('All reels must be arrays');
    var winningLines = [];
    var symbolSet = new Set(Array.from({ length: p.numberOfSymbols }, function (_, i) { return i + 1; }));
    var symbolSetList = [];
    symbolSet.delete(p.freeSpinsSymbol); // the scatter never pays a way
    for (var i = 0; i < reels.length; i++) {
      const reel = reels[i];
      if (!reel.includes(wildSymbol)) {
        if (i >= p.minConsecutiveSymbols) symbolSetList.push([new Set([...symbolSet].filter(function (x) { return !reel.includes(x); })), i]);
        symbolSet = new Set([...symbolSet].filter(function (x) { return reel.includes(x); }));
      }
    }
    symbolSetList.push([symbolSet, reels.length]);
    for (const [symbols, comboLength] of symbolSetList) {
      for (const symbol of symbols) {
        var winningSymbols = [];
        var winningPositions = [];
        for (var c = 0; c < comboLength; c++) {
          var newSymbols = [];
          var newPositions = [];
          for (var j = 0; j < reels[c].length; j++) {
            if (reels[c][j] === symbol || reels[c][j] === wildSymbol) {
              newSymbols.push(reels[c][j]);
              newPositions.push([j, c]);
            }
          }
          winningSymbols.push(newSymbols);
          winningPositions.push(newPositions);
        }
        var symbolCombos = cartesianProduct(winningSymbols);
        var positionCombos = cartesianProduct(winningPositions);
        for (var k = 0; k < symbolCombos.length; k++) winningLines.push([symbolCombos[k], positionCombos[k]]);
      }
    }
    return { winningLines: winningLines, numberOfSymbols: p.numberOfSymbols, wildSymbol: wildSymbol, freeSpinsSymbol: p.freeSpinsSymbol, minConsecutiveSymbols: p.minConsecutiveSymbols };
  }

  // ── Reel Ways Calculate Winnings ───────────────────────────────────────────────────────────────
  // A way pays betAmount x paytable[first non-wild symbol][reels spanned], rounded; that symbol decides
  // (the RGS used to look past it to a later symbol), and a way made of wilds pays 0.

  function calculateReelWaysWinningsArgs(a) {
    var pt = a.paytable;
    return {
      winningLines: arrayOrEmpty(a.winningLines),
      betAmount: numberOr(a.betAmount, 100),
      wildSymbol: numberOr(a.wildSymbol, 9),
      paytable: typeof pt === 'object' && pt !== null ? pt : {}
    };
  }
  function wayPayout(winningLine, betAmount, paytable, wildSymbol) {
    const symbols = winningLine[0];
    const comboLength = symbols.length;
    for (const symbol of symbols) {
      if (symbol !== wildSymbol) {
        if (paytable[symbol] && paytable[symbol][comboLength] !== undefined) return Math.round(betAmount * paytable[symbol][comboLength]);
        return 0;
      }
    }
    return 0;
  }
  function calculateReelWaysWinnings(a) {
    var p = calculateReelWaysWinningsArgs(a);
    if (typeof p.betAmount !== 'number' || p.betAmount <= 0) throw new Error('Bet amount must be a positive number');
    var spinWinnings = 0;
    var winningLinesDetails = [];
    var notes = [];
    for (const winLine of p.winningLines) {
      if (!Array.isArray(winLine) || winLine.length !== 2) {
        notes.push(['warn', 'Invalid winning line structure, skipping:', winLine]);
        continue;
      }
      if (!Array.isArray(winLine[0]) || !Array.isArray(winLine[1])) {
        notes.push(['warn', 'Invalid winning line symbols or positions structure, skipping:', winLine]);
        continue;
      }
      const payout = wayPayout(winLine, p.betAmount, p.paytable, p.wildSymbol);
      spinWinnings += payout;
      if (payout > 0) winningLinesDetails.push({ symbols: winLine[0], positions: winLine[1], payout: payout });
    }
    winningLinesDetails.sort(function (x, y) { return y.payout - x.payout; });
    return { spinWinnings: spinWinnings, winningLinesDetails: winningLinesDetails, betAmount: p.betAmount, wildSymbol: p.wildSymbol, paytable: p.paytable, notes: notes };
  }

  // ── Volatility Estimator (state: the cumulative payout series) ─────────────────────────────────

  function payoutValuesOf(spinResults) {
    var finite = function (v) { return typeof v === 'number' && Number.isFinite(v); };
    var numbersIn = function (arr) { return arr.filter(function (v) { return typeof v === 'number'; }); };
    if (Array.isArray(spinResults)) {
      var sumFromArray = function (arr) {
        var sum = 0;
        for (var i = 0; i < arr.length; i++) {
          var entry = arr[i];
          if (finite(entry)) sum += entry;
          else if (Array.isArray(entry)) sum += sumFromArray(entry);
          else if (entry && typeof entry === 'object' && finite(entry.totalPayout)) sum += entry.totalPayout;
        }
        return sum;
      };
      var total = sumFromArray(spinResults);
      return Number.isFinite(total) ? [total] : [];
    }
    if (Array.isArray(spinResults.values)) return numbersIn(spinResults.values);
    if (Array.isArray(spinResults.RTPDataSeries)) return numbersIn(spinResults.RTPDataSeries);
    if (Array.isArray(spinResults.payoutSeries)) return numbersIn(spinResults.payoutSeries);
    if (Array.isArray(spinResults.totalPayouts)) return numbersIn(spinResults.totalPayouts);
    if (Array.isArray(spinResults.cascades)) {
      var cascadeTotal = 0;
      var cascades = spinResults.cascades;
      for (var c = 0; c < cascades.length; c++) {
        var cv = cascades[c];
        if (finite(cv)) cascadeTotal += cv;
        else if (cv && typeof cv === 'object' && finite(cv.totalPayout)) cascadeTotal += cv.totalPayout;
        else if (Array.isArray(cv)) {
          for (var j = 0; j < cv.length; j++) {
            var e = cv[j];
            if (finite(e)) cascadeTotal += e;
            else if (e && typeof e === 'object' && finite(e.totalPayout)) cascadeTotal += e.totalPayout;
          }
        }
      }
      return Number.isFinite(cascadeTotal) ? [cascadeTotal] : [];
    }
    if (typeof spinResults.totalPayout === 'number') return [spinResults.totalPayout];
    return [];
  }
  function volatilityEstimator(state, a) {
    var previous = a.reset === true || !state || !Array.isArray(state.cumulativeValues) ? [] : state.cumulativeValues;
    var values = payoutValuesOf(a.spinResults || {});
    var cumulativeValues = previous.slice();
    for (var i = 0; i < values.length; i++) if (typeof values[i] === 'number' && Number.isFinite(values[i])) cumulativeValues.push(values[i]);
    var n = cumulativeValues.length;
    var mean = 0;
    var variance = 0;
    var standardDeviation = 0;
    if (n > 0) {
      mean = cumulativeValues.reduce(function (s, v) { return s + v; }, 0) / n;
      if (n > 1) {
        variance = cumulativeValues.map(function (v) { var d = v - mean; return d * d; }).reduce(function (s, v) { return s + v; }, 0) / (n - 1);
      }
      standardDeviation = Math.sqrt(variance);
    }
    var volatilityPercentage = 0;
    if (mean > 0) volatilityPercentage = (standardDeviation / mean) * 100;
    else if (standardDeviation > 0) volatilityPercentage = 100;
    var amplitude = 0;
    if (n > 0) {
      var minV = cumulativeValues[0];
      var maxV = cumulativeValues[0];
      for (var k = 1; k < n; k++) {
        if (cumulativeValues[k] < minV) minV = cumulativeValues[k];
        if (cumulativeValues[k] > maxV) maxV = cumulativeValues[k];
      }
      amplitude = mean !== 0 ? (maxV - minV) / Math.abs(mean) : maxV - minV;
    }
    return {
      volatilityResult: volatilityPercentage, standardDeviation: standardDeviation, mean: mean, variance: variance, amplitude: amplitude,
      count: n, updatedState: { cumulativeValues: cumulativeValues }
    };
  }

  // ── Symbol Frequency Tracker (state: the running counts) ───────────────────────────────────────

  function symbolFrequencyTracker(state, a) {
    var numSymbols = Math.max(Math.floor(Number(a.numberOfSymbols) || 10), 1);
    var reels = arrayOrEmpty(a.reels);
    var allSymbols = [];
    for (var i = 0; i < reels.length; i++) {
      var reel = reels[i];
      if (!Array.isArray(reel)) throw new Error('Reel at index ' + i + ' must be an array.');
      for (var j = 0; j < reel.length; j++) if (typeof reel[j] === 'number') allSymbols.push(reel[j]);
    }
    var counts = a.reset === true || !state ? {} : copyKeys(state.symbolCountResults);
    for (var s = 1; s <= numSymbols; s++) if (typeof counts[String(s)] !== 'number') counts[String(s)] = 0;
    for (var k = 0; k < allSymbols.length; k++) {
      var value = allSymbols[k];
      if (value >= 1 && value <= numSymbols) counts[String(value)] = (counts[String(value)] || 0) + 1;
    }
    var totalCount = Object.keys(counts).reduce(function (sum, key) { return sum + (typeof counts[key] === 'number' ? counts[key] : 0); }, 0);
    var percentages = {};
    if (totalCount > 0) {
      for (var t = 1; t <= numSymbols; t++) percentages[String(t)] = ((counts[String(t)] || 0) / totalCount) * 100;
    }
    return {
      symbolCountResults: counts, symbolFrequencyResults: percentages, numberOfSymbols: numSymbols, totalCount: totalCount,
      updatedState: { symbolCountResults: counts, symbolFrequencyResults: percentages }
    };
  }

  return {
    checkJackpotArgs: checkJackpotArgs,
    checkJackpot: checkJackpot,
    checkWinsArgs: checkWinsArgs,
    checkWins: checkWins,
    calculateWinningsArgs: calculateWinningsArgs,
    calculateWinnings: calculateWinnings,
    paylineValueUnrounded: paylineValueUnrounded,
    getPaytableArgs: getPaytableArgs,
    getPaytable: getPaytable,
    generateSymbolWeightsArgs: generateSymbolWeightsArgs,
    generateSymbolWeights: generateSymbolWeights,
    reelStripsGenerator: reelStripsGenerator,
    weightedReelsArgs: weightedReelsArgs,
    weightedReels: weightedReels,
    spinCalculate: spinCalculate,
    spinResult: spinResult,
    calculateFreeSpinsStates: calculateFreeSpinsStates,
    initFreeSpins: initFreeSpins,
    checkReelWaysWinsArgs: checkReelWaysWinsArgs,
    checkReelWaysWins: checkReelWaysWins,
    calculateReelWaysWinningsArgs: calculateReelWaysWinningsArgs,
    calculateReelWaysWinnings: calculateReelWaysWinnings,
    volatilityEstimator: volatilityEstimator,
    symbolFrequencyTracker: symbolFrequencyTracker,
    evaluateFormula: evaluateFormula
  };
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
var formulaCore = require('./formula-eval-core');
var SLOT_GAME_CORES = defineSlotGameCores(formulaCore.defineFormulaEvaluator());

module.exports = Object.assign(
  {
    defineSlotGameCores: defineSlotGameCores,
    /** The exact text the RGS compiler embeds: `const __sgc = (<CORES_SOURCE>)((<FORMULA_SOURCE>)());` */
    CORES_SOURCE: String(defineSlotGameCores),
    FORMULA_SOURCE: formulaCore.FORMULA_SOURCE,
    coreNames: Object.keys(SLOT_GAME_CORES)
  },
  SLOT_GAME_CORES
);
