'use strict';

/**
 * Slot feature cores — the maths behind the "Slot Features" nodes, written ONCE.
 *
 * Both consumers run this SAME function body:
 *   * the editor/browser nodes (private/xgenia-pro-nodes/src/slot-games/features/*.js) require this
 *     module and call the returned functions directly;
 *   * the RGS script compiler (slot-feature-node-converter.ts) embeds String(defineSlotFeatureCores)
 *     into the generated evaluate(ctx) script and calls __sfc.<core>(...) from each node function.
 * So an editor preview and a round on the XRGS sandbox compute the same outcome for the same
 * inputs and seeds — parity by construction instead of by hand-duplicated bodies.
 *
 * RULES FOR THIS FILE (the body runs inside the XRGS script sandbox after sanitizeForSandbox):
 *   * everything lives INSIDE defineSlotFeatureCores() and references nothing outside it, so a
 *     minified editor bundle still embeds a self-consistent text (names are renamed together);
 *   * no classes, no prototypes, no Math.random, no timers, no eval/Function, no globals — see
 *     XRGS _shared/script-sandbox.ts BLOCKED_PATTERNS; ES2017 syntax only; no `x: number`-shaped
 *     text (sanitizeForSandbox strips TypeScript annotations by regex);
 *   * pure functions: (state, args) -> result; state is a small bounded plain object.
 *
 * Grid conventions (identical to the existing slot nodes): reels[col][row], 1-based integer
 * symbols, 0 = blank; positions are [row, col]; paytable[symbol][count] = multiplier; money in
 * integer minor units; randomness from `Seeds` (ISAAC Random Number Array Generator integers,
 * 0..1e12) through the same Park-Miller LCG that Weighted Reels and Cascade The Reels use.
 * Unseeded => throw (fail closed, the 2026-09-08 product rule).
 */
function defineSlotFeatureCores() {
  var LCG_MOD = 2147483647;
  var LCG_MUL = 16807;

  // ── generic helpers ──────────────────────────────────────────────────────

  function fail(nodeName, message) {
    throw new Error('[' + nodeName + '] ' + message);
  }
  function isObj(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }
  function toNum(v, def) {
    var n = Number(v);
    return isFinite(n) ? n : def;
  }
  function toInt(v, def) {
    var n = Number(v);
    if (!isFinite(n)) return def;
    return n < 0 ? Math.ceil(n) : Math.floor(n);
  }
  function toBool(v) {
    return v === true || v === 'true' || v === 1;
  }
  function toList(v) {
    if (Array.isArray(v)) return v;
    if (v === undefined || v === null || v === '') return [];
    if (typeof v === 'string') {
      return v.split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; });
    }
    return [v];
  }
  function toIntList(v) {
    return toList(v).map(function (x) { return toInt(x, NaN); }).filter(function (n) { return !isNaN(n); });
  }
  function parseObject(v) {
    if (isObj(v)) return v;
    if (typeof v === 'string' && v.trim().length > 0) {
      try { var p = JSON.parse(v); return isObj(p) ? p : {}; } catch (e) { return {}; }
    }
    return {};
  }
  function parseArray(v) {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string' && v.trim().length > 0) {
      try { var p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch (e) { return []; }
    }
    return [];
  }
  function roundMoney(x) {
    return Math.round(toNum(x, 0));
  }
  function posKey(row, col) {
    return row + ':' + col;
  }

  // ── randomness: Seeds -> Park-Miller LCG (same generator as Weighted Reels) ──

  function normaliseSeed(seed) {
    var n = Number(seed);
    if (!isFinite(n)) return NaN;
    n = Math.abs(n);
    if (n > 0 && n < 1) n = Math.floor(n * (LCG_MOD - 1)); // a 0..1 float still seeds distinctly
    n = Math.floor(n) % LCG_MOD;
    if (n <= 0) n += LCG_MOD - 1;
    return n;
  }
  function requireSeeds(seeds, needed, nodeName) {
    var have = Array.isArray(seeds) ? seeds.length : 0;
    if (have < needed) {
      fail(nodeName, 'Seeds is required (' + needed + ' needed, got ' + have + '): wire ISAAC Random Number Array Generator.array -> Seeds. Unseeded outcomes are not provably fair and are refused.');
    }
    for (var i = 0; i < needed; i++) {
      if (isNaN(normaliseSeed(seeds[i]))) fail(nodeName, 'Seeds[' + i + '] is not a number.');
    }
    return seeds;
  }
  function lcg(seed) {
    var s = normaliseSeed(seed);
    function next() { s = (s * LCG_MUL) % LCG_MOD; return s; }
    function nextFloat() { return (next() - 1) / (LCG_MOD - 1); }
    return {
      nextFloat: nextFloat,
      integer: function (min, max) { return Math.floor(nextFloat() * (max - min + 1)) + min; },
      pick: function (list) { return list[Math.floor(nextFloat() * list.length)]; },
      weightedIndex: function (weights) {
        var total = 0, i;
        for (i = 0; i < weights.length; i++) total += Math.max(0, toNum(weights[i], 0));
        if (total <= 0) return -1;
        var r = nextFloat() * total;
        for (i = 0; i < weights.length; i++) {
          r -= Math.max(0, toNum(weights[i], 0));
          if (r < 0) return i;
        }
        return weights.length - 1;
      },
      shuffle: function (list) {
        var out = list.slice();
        for (var i = out.length - 1; i > 0; i--) {
          var j = Math.floor(nextFloat() * (i + 1));
          var t = out[i]; out[i] = out[j]; out[j] = t;
        }
        return out;
      }
    };
  }

  // ── grid helpers ─────────────────────────────────────────────────────────

  function gridDims(reels, nodeName) {
    if (!Array.isArray(reels) || reels.length === 0 || !Array.isArray(reels[0])) {
      fail(nodeName, 'reels must be a non-empty array of columns (reels[col][row]); wire Weighted Reels.reels or another grid.');
    }
    var rows = reels[0].length;
    if (rows === 0) fail(nodeName, 'reels columns are empty.');
    for (var c = 0; c < reels.length; c++) {
      if (!Array.isArray(reels[c]) || reels[c].length !== rows) {
        fail(nodeName, 'reels must be rectangular: column ' + c + ' has ' + (Array.isArray(reels[c]) ? reels[c].length : 'no') + ' rows, expected ' + rows + '.');
      }
    }
    return { cols: reels.length, rows: rows };
  }
  function cloneGrid(reels) {
    var out = [];
    for (var c = 0; c < reels.length; c++) out.push(Array.isArray(reels[c]) ? reels[c].slice() : []);
    return out;
  }
  function blankGrid(cols, rows, fillValue) {
    var out = [];
    for (var c = 0; c < cols; c++) {
      var col = [];
      for (var r = 0; r < rows; r++) col.push(fillValue);
      out.push(col);
    }
    return out;
  }
  /** [row, col] pairs from winningLinesDetails entries, {row, col} objects or bare pairs. */
  function readPositions(entries) {
    var out = [];
    var list = parseArray(entries);
    function pushPair(p) {
      if (Array.isArray(p) && p.length >= 2) {
        var r = toInt(p[0], NaN), c = toInt(p[1], NaN);
        if (!isNaN(r) && !isNaN(c)) out.push([r, c]);
      } else if (isObj(p) && p.row !== undefined && p.col !== undefined) {
        var r2 = toInt(p.row, NaN), c2 = toInt(p.col, NaN);
        if (!isNaN(r2) && !isNaN(c2)) out.push([r2, c2]);
      }
    }
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (Array.isArray(item) && item.length >= 2 && typeof item[0] === 'number') pushPair(item);
      else if (isObj(item) && Array.isArray(item.positions)) item.positions.forEach(pushPair);
      else if (isObj(item)) pushPair(item);
    }
    return out;
  }
  /** Refill alphabet with Cascade The Reels' semantics: replicate symbols by ceil(w / min w), else the grid's symbols. */
  function weightedBaseReel(symbolWeights, reels, nodeName) {
    var weights = parseArray(symbolWeights);
    var base = [];
    var allPositive = weights.length > 0 && weights.every(function (w) { return typeof w === 'number' && w > 0; });
    if (allPositive) {
      var minW = Math.min.apply(null, weights);
      for (var s = 1; s <= weights.length; s++) {
        var reps = Math.ceil(weights[s - 1] / minW);
        for (var k = 0; k < reps; k++) base.push(s);
      }
    } else {
      var seen = {};
      for (var c = 0; c < reels.length; c++) {
        for (var r = 0; r < reels[c].length; r++) {
          var v = reels[c][r];
          if (typeof v === 'number' && v > 0 && !seen[v]) { seen[v] = true; base.push(v); }
        }
      }
      if (base.length === 0) fail(nodeName, 'Cannot infer symbols for refill: provide symbolWeights or a grid with symbols.');
    }
    return base;
  }
  /** Largest paytable key <= size (size-bracketed cluster pays). */
  function bracketMultiplier(row, size) {
    if (!isObj(row)) return 0;
    var best = -1, mult = 0;
    var keys = Object.keys(row);
    for (var i = 0; i < keys.length; i++) {
      var n = toNum(keys[i], NaN);
      if (isNaN(n)) continue;
      if (n <= size && n > best) { best = n; mult = toNum(row[keys[i]], 0); }
    }
    return mult;
  }

  // ── 1. Cluster Pays ───────────────────────────────────────────────────────

  function evaluateClusterPays(args) {
    var a = args || {};
    var NODE = 'Cluster Pays';
    var reels = a.reels;
    var dims = gridDims(reels, NODE);
    var minSize = Math.max(2, toInt(a.minClusterSize, 5));
    var wild = toInt(a.wildSymbol, 0);
    var paytable = parseObject(a.paytable);
    var bet = Math.max(0, toNum(a.betAmount, 0));
    var diagonal = a.adjacency === 'diagonal';
    var wildsCount = a.wildsCountTowardSize === undefined ? true : toBool(a.wildsCountTowardSize);
    var dirs = diagonal
      ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
      : [[1, 0], [-1, 0], [0, 1], [0, -1]];
    var visited = {};
    var clusters = [];
    for (var c = 0; c < dims.cols; c++) {
      for (var r = 0; r < dims.rows; r++) {
        var sym = reels[c][r];
        if (typeof sym !== 'number' || sym <= 0 || sym === wild) continue;
        if (!visited[sym]) visited[sym] = {};
        if (visited[sym][posKey(r, c)]) continue;
        var stack = [[r, c]];
        var cells = [];
        var wildCells = 0;
        visited[sym][posKey(r, c)] = true;
        while (stack.length > 0) {
          var cur = stack.pop();
          var cr = cur[0], cc = cur[1];
          cells.push([cr, cc]);
          if (wild > 0 && reels[cc][cr] === wild) wildCells++;
          for (var d = 0; d < dirs.length; d++) {
            var nr = cr + dirs[d][0], nc = cc + dirs[d][1];
            if (nr < 0 || nc < 0 || nr >= dims.rows || nc >= dims.cols) continue;
            var nv = reels[nc][nr];
            if (nv !== sym && !(wild > 0 && nv === wild)) continue;
            var key = posKey(nr, nc);
            if (visited[sym][key]) continue;
            visited[sym][key] = true;
            stack.push([nr, nc]);
          }
        }
        var size = wildsCount ? cells.length : cells.length - wildCells;
        if (size < minSize) continue;
        var mult = bracketMultiplier(paytable[sym], size);
        if (mult <= 0) continue;
        cells.sort(function (p, q) { return p[0] - q[0] || p[1] - q[1]; });
        clusters.push({ symbol: sym, size: size, cells: cells.length, wilds: wildCells, positions: cells, multiplier: mult, payout: roundMoney(bet * mult) });
      }
    }
    var winningLinesDetails = [];
    var total = 0, largest = 0;
    for (var i = 0; i < clusters.length; i++) {
      var cl = clusters[i];
      total += cl.payout;
      if (cl.size > largest) largest = cl.size;
      var symbols = [];
      for (var j = 0; j < cl.size; j++) symbols.push(cl.symbol);
      winningLinesDetails.push({ line: i + 1, symbols: symbols, positions: cl.positions, payout: cl.payout });
    }
    return { clusters: clusters, winningLinesDetails: winningLinesDetails, clusterWinnings: total, clusterCount: clusters.length, hasWin: total > 0, largestCluster: largest };
  }

  // ── 2. Progressive Meter (stateful) ──────────────────────────────────────

  function applyProgressiveMeter(state, args) {
    var a = args || {};
    var st = isObj(state) ? state : {};
    var startValue = toNum(a.startValue, 0);
    var increment = toNum(a.increment, 1);
    var target = toNum(a.target, 100);
    var resetOnFill = a.resetOnFill === undefined ? true : toBool(a.resetOnFill);
    var carry = a.carryOverflow === undefined ? true : toBool(a.carryOverflow);
    var value = typeof st.value === 'number' && isFinite(st.value) ? st.value : startValue;
    var fillCount = toInt(st.fillCount, 0);
    var filled = false;
    if (toBool(a.reset)) value = startValue;
    if (a.setValue !== undefined && a.setValue !== null && a.setValue !== '' && isFinite(Number(a.setValue))) value = Number(a.setValue);
    if (toBool(a.add)) value += increment;
    if (target > 0 && value >= target) {
      filled = true;
      fillCount++;
      if (resetOnFill) value = startValue + (carry ? value - target : 0);
    }
    var progress = target > 0 ? Math.max(0, Math.min(1, value / target)) : 0;
    return {
      value: value, progress: progress, filled: filled, fillCount: fillCount,
      remaining: target > 0 ? Math.max(0, target - value) : 0,
      updatedState: { value: value, fillCount: fillCount }
    };
  }

  // ── 3. Multiplier Ladder (stateful) ──────────────────────────────────────

  function stepMultiplierLadder(state, args) {
    var a = args || {};
    var st = isObj(state) ? state : {};
    var ladder = parseArray(a.ladder).map(function (x) { return toNum(x, 1); });
    if (ladder.length === 0) ladder = [1];
    var startIndex = Math.max(0, Math.min(ladder.length - 1, toInt(a.startIndex, 0)));
    var index = typeof st.index === 'number' ? st.index : startIndex;
    var changed = false;
    if (toBool(a.reset)) { index = startIndex; changed = true; }
    if (toBool(a.step)) {
      var nxt = Math.min(ladder.length - 1, Math.max(0, index + toInt(a.stepBy, 1)));
      if (nxt !== index) changed = true;
      index = nxt;
    }
    index = Math.max(0, Math.min(ladder.length - 1, index));
    return { multiplier: ladder[index], index: index, atMax: index >= ladder.length - 1, changed: changed, ladder: ladder, updatedState: { index: index } };
  }

  // ── 4. Symbol Value Grid ─────────────────────────────────────────────────

  function buildSymbolValueGrid(args) {
    var a = args || {};
    var NODE = 'Symbol Value Grid';
    var reels = a.reels;
    var dims = gridDims(reels, NODE);
    var valueSymbol = toInt(a.valueSymbol, 0);
    var values = parseArray(a.values).map(function (v) { return toNum(v, 0); });
    var weights = parseArray(a.weights).map(function (w) { return Math.max(0, toNum(w, 0)); });
    if (values.length === 0) fail(NODE, 'values must be a non-empty array of coin values.');
    if (weights.length !== values.length) weights = values.map(function () { return 1; });
    var bet = Math.max(0, toNum(a.betAmount, 0));
    var asMultiples = a.valuesAreBetMultiples === undefined ? true : toBool(a.valuesAreBetMultiples);
    var coinPositions = [];
    for (var c = 0; c < dims.cols; c++) {
      for (var r = 0; r < dims.rows; r++) {
        if (reels[c][r] === valueSymbol) coinPositions.push([r, c]);
      }
    }
    var valueGrid = blankGrid(dims.cols, dims.rows, 0);
    var total = 0;
    if (coinPositions.length > 0) {
      requireSeeds(a.seeds, 1, NODE);
      var rng = lcg(a.seeds[0]);
      for (var i = 0; i < coinPositions.length; i++) {
        var idx = rng.weightedIndex(weights);
        var v = idx >= 0 ? values[idx] : 0;
        var amount = asMultiples ? roundMoney(v * bet) : roundMoney(v);
        valueGrid[coinPositions[i][1]][coinPositions[i][0]] = amount;
        total += amount;
      }
    }
    return { valueGrid: valueGrid, coinPositions: coinPositions, coinCount: coinPositions.length, totalValue: total };
  }

  // ── 5. Coin Collector ────────────────────────────────────────────────────

  function collectCoins(args) {
    var a = args || {};
    var NODE = 'Coin Collector';
    var reels = a.reels;
    var dims = gridDims(reels, NODE);
    var valueGrid = parseArray(a.valueGrid);
    var collector = toInt(a.collectorSymbol, 0);
    var requireCollector = a.requireCollector === undefined ? true : toBool(a.requireCollector);
    var multiply = toBool(a.multiplyByCollectors);
    var coinPositions = [], collectorPositions = [];
    var totalOnGrid = 0;
    for (var c = 0; c < dims.cols; c++) {
      for (var r = 0; r < dims.rows; r++) {
        var v = Array.isArray(valueGrid[c]) && typeof valueGrid[c][r] === 'number' ? valueGrid[c][r] : 0;
        if (v > 0) { coinPositions.push([r, c]); totalOnGrid += v; }
        if (collector > 0 && reels[c][r] === collector) collectorPositions.push([r, c]);
      }
    }
    var hasCollector = collectorPositions.length > 0;
    var paid = requireCollector ? hasCollector : true;
    var factor = multiply ? Math.max(1, collectorPositions.length) : 1;
    var collected = paid ? roundMoney(totalOnGrid * factor) : 0;
    return {
      collected: collected, totalOnGrid: totalOnGrid, coinPositions: coinPositions, coinCount: coinPositions.length,
      collectorPositions: collectorPositions, collectorCount: collectorPositions.length, hasCollector: hasCollector, paid: paid
    };
  }

  // ── 6. Jackpot Tiers ─────────────────────────────────────────────────────

  function evaluateJackpotTiers(args) {
    var a = args || {};
    var NODE = 'Jackpot Tiers';
    var reels = a.reels;
    var dims = gridDims(reels, NODE);
    var sym = toInt(a.jackpotSymbol, 0);
    var tiers = parseArray(a.tiers).map(function (t, i) {
      if (!isObj(t)) return null;
      return { name: String(t.name !== undefined ? t.name : 'Tier ' + (i + 1)), count: toInt(t.count, 0), multiplier: toNum(t.multiplier, 0), fixed: toNum(t.fixed, 0) };
    }).filter(function (t) { return t !== null; });
    var bet = Math.max(0, toNum(a.betAmount, 0));
    var positions = [];
    for (var c = 0; c < dims.cols; c++) {
      for (var r = 0; r < dims.rows; r++) {
        if (sym > 0 && reels[c][r] === sym) positions.push([r, c]);
      }
    }
    var count = positions.length;
    var best = -1;
    for (var i = 0; i < tiers.length; i++) {
      if (tiers[i].count > 0 && tiers[i].count <= count && (best < 0 || tiers[i].count > tiers[best].count)) best = i;
    }
    var tier = best >= 0 ? tiers[best] : null;
    var award = tier ? roundMoney(tier.fixed > 0 ? tier.fixed : bet * tier.multiplier) : 0;
    return {
      symbolCount: count, positions: positions, tierIndex: best, tierName: tier ? tier.name : '',
      multiplier: tier ? tier.multiplier : 0, award: award, hasTier: best >= 0, tiers: tiers
    };
  }

  // ── 7. RGS Jackpot Pools (reads ctx.jackpots on the server) ──────────────

  function resolveJackpotPools(args) {
    var a = args || {};
    var pools = parseArray(a.pools).map(function (p) {
      if (!isObj(p)) return null;
      return {
        id: p.id === undefined || p.id === null ? '' : String(p.id),
        name: String(p.name === undefined || p.name === null ? '' : p.name),
        pool_type: String(p.pool_type === undefined || p.pool_type === null ? '' : p.pool_type),
        current_value: toNum(p.current_value, 0),
        claimable: toBool(p.claimable)
      };
    }).filter(function (p) { return p !== null; });
    var name = String(a.poolName === undefined || a.poolName === null ? '' : a.poolName).trim();
    var key = name.toLowerCase();
    var found = null;
    var poolValues = {};
    var names = [];
    var total = 0;
    for (var i = 0; i < pools.length; i++) {
      var p = pools[i];
      poolValues[p.name] = p.current_value;
      names.push(p.name);
      total += p.current_value;
      if (key.length > 0 && (p.name.toLowerCase() === key || p.id === name)) found = p;
    }
    var onlyClaimable = a.claimOnlyIfClaimable === undefined ? true : toBool(a.claimOnlyIfClaimable);
    var claims = [];
    if (toBool(a.shouldClaim) && found && (found.claimable || !onlyClaimable)) claims.push(found.name);
    return {
      pools: pools, poolNames: names, poolCount: pools.length, poolValues: poolValues,
      poolValue: found ? found.current_value : 0, poolFound: found !== null, claimable: found ? found.claimable : false,
      claims: claims, claimed: claims.length > 0, totalPoolValue: total
    };
  }

  // ── 8. Bet Mode ──────────────────────────────────────────────────────────

  function computeBetMode(args) {
    var a = args || {};
    var amount = Math.max(0, toNum(a.betAmount, 0));
    var mode = String(a.mode === undefined || a.mode === null ? 'base' : a.mode).trim();
    var key = mode.toLowerCase().replace(/[\s-]+/g, '_');
    var ante = Math.max(0, toNum(a.anteMultiplier, 1.25));
    var buy = Math.max(0, toNum(a.bonusBuyMultiplier, 100));
    var custom = parseObject(a.customMultipliers);
    var isAnte = key === 'ante' || key === 'ante_bet';
    var isBuy = key === 'bonus_buy' || key === 'bonusbuy' || key === 'feature_buy' || key === 'buy';
    var known = true;
    var mult = 1;
    if (key === 'base' || key === '') mult = 1;
    else if (isAnte) mult = ante;
    else if (isBuy) mult = buy;
    else if (custom[mode] !== undefined || custom[key] !== undefined) mult = Math.max(0, toNum(custom[mode] !== undefined ? custom[mode] : custom[key], 1));
    else { known = false; mult = 1; }
    var direction = a.direction === 'cost-to-base' ? 'cost-to-base' : 'base-to-cost';
    var baseBet, cost;
    if (direction === 'base-to-cost') { baseBet = amount; cost = roundMoney(amount * mult); }
    else { cost = amount; baseBet = mult > 0 ? roundMoney(amount / mult) : amount; }
    return {
      mode: known ? key : 'base', modeKnown: known, multiplier: mult, cost: cost, baseBet: baseBet, stakeForPaytable: baseBet,
      isBase: !isAnte && !isBuy, isAnte: isAnte, isBonusBuy: isBuy, forceFeature: isBuy, direction: direction
    };
  }

  // ── 9. Variant Selector ──────────────────────────────────────────────────

  function selectVariant(args) {
    var a = args || {};
    var variants = parseObject(a.variants);
    var key = String(a.key === undefined || a.key === null ? '' : a.key).trim();
    var fallback = String(a.fallbackKey === undefined || a.fallbackKey === null ? '' : a.fallbackKey).trim();
    var keys = Object.keys(variants);
    var selectedKey = '';
    if (key.length > 0 && isObj(variants[key])) selectedKey = key;
    else if (fallback.length > 0 && isObj(variants[fallback])) selectedKey = fallback;
    else if (key.length === 0 && keys.length > 0 && isObj(variants[keys[0]])) selectedKey = keys[0];
    var v = selectedKey.length > 0 ? variants[selectedKey] : {};
    return {
      variant: v, selectedKey: selectedKey, found: selectedKey.length > 0, keys: keys,
      reelStrips: parseArray(v.reelStrips), symbolWeights: parseArray(v.symbolWeights), paytable: parseObject(v.paytable),
      paytableScale: toNum(v.paytableScale, 1), rtp: toNum(v.rtp, 0)
    };
  }

  // ── 10. Sticky Symbols (stateful) ────────────────────────────────────────

  function applyStickySymbols(state, args) {
    var a = args || {};
    var NODE = 'Sticky Symbols';
    var st = isObj(state) ? state : {};
    var reels = a.reels;
    var dims = gridDims(reels, NODE);
    var stickySymbol = toInt(a.stickySymbol, 0);
    var replaceWith = a.replaceWith === undefined || a.replaceWith === null || a.replaceWith === '' ? null : toInt(a.replaceWith, null);
    var duration = Math.max(0, toInt(a.duration, 0));
    var tick = a.tick === undefined ? true : toBool(a.tick);
    var stickies = Array.isArray(st.stickies) ? st.stickies.filter(isObj).map(function (s) {
      return { r: toInt(s.r, 0), c: toInt(s.c, 0), s: toInt(s.s, 0), ttl: toInt(s.ttl, -1) };
    }) : [];
    var changed = false;
    if (toBool(a.reset)) { if (stickies.length > 0) changed = true; stickies = []; }
    var out = cloneGrid(reels);
    // 1) merge the stickies that are still alive into the incoming grid
    var live = [];
    for (var i = 0; i < stickies.length; i++) {
      var s = stickies[i];
      if (s.r < 0 || s.c < 0 || s.r >= dims.rows || s.c >= dims.cols) continue;
      var sym = replaceWith !== null ? replaceWith : s.s;
      if (out[s.c][s.r] !== sym) { out[s.c][s.r] = sym; changed = true; }
      live.push(s);
    }
    // 2) age the stickies that existed before this spin (ttl -1 = until reset)
    if (tick) {
      live = live.map(function (s2) { return s2.ttl > 0 ? { r: s2.r, c: s2.c, s: s2.s, ttl: s2.ttl - 1 } : s2; })
        .filter(function (s3) { return s3.ttl !== 0; });
    }
    // 3) capture new stickies from what the SPIN landed (not from the merged grid, or an expired
    //    sticky would be re-captured forever)
    if (toBool(a.capture) && stickySymbol > 0) {
      var have = {};
      for (var k = 0; k < live.length; k++) have[posKey(live[k].r, live[k].c)] = true;
      for (var c = 0; c < dims.cols; c++) {
        for (var r = 0; r < dims.rows; r++) {
          if (reels[c][r] === stickySymbol && !have[posKey(r, c)]) {
            live.push({ r: r, c: c, s: stickySymbol, ttl: duration > 0 ? duration : -1 });
            changed = true;
          }
        }
      }
    }
    live.sort(function (p, q) { return p.c - q.c || p.r - q.r; });
    var positions = live.map(function (s4) { return [s4.r, s4.c]; });
    return { reels: out, stickyPositions: positions, stickyCount: live.length, changed: changed, updatedState: { stickies: live } };
  }

  // ── 11. Expand Symbols ───────────────────────────────────────────────────

  function expandSymbols(args) {
    var a = args || {};
    var NODE = 'Expand Symbols';
    var reels = a.reels;
    var dims = gridDims(reels, NODE);
    var symbol = toInt(a.symbol, 0);
    var mode = String(a.mode === undefined || a.mode === null ? 'column' : a.mode);
    var replaceWith = a.replaceWith === undefined || a.replaceWith === null || a.replaceWith === '' ? symbol : toInt(a.replaceWith, symbol);
    var minCount = Math.max(1, toInt(a.minCount, 1));
    var out = cloneGrid(reels);
    var spans = [];
    var anchors = [];
    for (var c = 0; c < dims.cols; c++) {
      for (var r = 0; r < dims.rows; r++) {
        if (symbol > 0 && reels[c][r] === symbol) anchors.push([r, c]);
      }
    }
    if (symbol <= 0 || anchors.length < minCount) {
      return { reels: out, spans: [], anchors: anchors, expandedCount: 0, changed: false };
    }
    function writeRect(row, col, rows, cols) {
      for (var cc = col; cc < col + cols; cc++) {
        for (var rr = row; rr < row + rows; rr++) {
          if (cc >= 0 && rr >= 0 && cc < dims.cols && rr < dims.rows) out[cc][rr] = replaceWith;
        }
      }
      spans.push({ row: row, col: col, rows: rows, cols: cols, symbol: replaceWith });
    }
    var seenCols = {}, seenRows = {};
    for (var i = 0; i < anchors.length; i++) {
      var ar = anchors[i][0], ac = anchors[i][1];
      if (mode === 'column') {
        if (!seenCols[ac]) { seenCols[ac] = true; writeRect(0, ac, dims.rows, 1); }
      } else if (mode === 'row') {
        if (!seenRows[ar]) { seenRows[ar] = true; writeRect(ar, 0, 1, dims.cols); }
      } else if (mode === 'cross') {
        if (!seenCols[ac]) { seenCols[ac] = true; writeRect(0, ac, dims.rows, 1); }
        if (!seenRows[ar]) { seenRows[ar] = true; writeRect(ar, 0, 1, dims.cols); }
      } else if (mode === 'block2x2' || mode === 'block3x3') {
        var n = mode === 'block2x2' ? 2 : 3;
        var rows = Math.min(n, dims.rows), cols = Math.min(n, dims.cols);
        var row0 = Math.max(0, Math.min(dims.rows - rows, ar - Math.floor((n - 1) / 2)));
        var col0 = Math.max(0, Math.min(dims.cols - cols, ac - Math.floor((n - 1) / 2)));
        writeRect(row0, col0, rows, cols);
      } else {
        writeRect(ar, ac, 1, 1);
      }
    }
    var expandedCount = 0;
    for (var c2 = 0; c2 < dims.cols; c2++) {
      for (var r2 = 0; r2 < dims.rows; r2++) {
        if (out[c2][r2] !== reels[c2][r2]) expandedCount++;
      }
    }
    return { reels: out, spans: spans, anchors: anchors, expandedCount: expandedCount, changed: expandedCount > 0 };
  }

  // ── 12. Locked Reels (stateful, column-level) ────────────────────────────

  function applyLockedReels(state, args) {
    var a = args || {};
    var NODE = 'Locked Reels';
    var st = isObj(state) ? state : {};
    var reels = a.reels;
    var dims = gridDims(reels, NODE);
    var lockSymbol = toInt(a.lockSymbol, 0);
    var forceCols = toIntList(a.lockColumns);
    var respins = Math.max(0, toInt(a.respins, 3));
    var resetOnNewLock = a.resetOnNewLock === undefined ? true : toBool(a.resetOnNewLock);
    var locked = Array.isArray(st.locked) && st.locked.length === dims.cols ? st.locked.map(toBool) : blankGrid(dims.cols, 1, false).map(function () { return false; });
    var lockedGrid = Array.isArray(st.lockedGrid) && st.lockedGrid.length === dims.cols ? cloneGrid(st.lockedGrid) : cloneGrid(reels);
    var respinsLeft = toInt(st.respinsLeft, 0);
    var active = toBool(st.active);
    var doStart = toBool(a.start);
    if (toBool(a.reset)) {
      locked = locked.map(function () { return false; });
      lockedGrid = cloneGrid(reels);
      respinsLeft = 0;
      active = false;
    }
    function colHas(grid, c) {
      if (lockSymbol <= 0) return false;
      for (var r = 0; r < dims.rows; r++) if (grid[c][r] === lockSymbol) return true;
      return false;
    }
    var out = cloneGrid(reels);
    var newLocks = 0;
    if (doStart || !active) {
      for (var c = 0; c < dims.cols; c++) {
        locked[c] = colHas(reels, c) || forceCols.indexOf(c) >= 0;
        if (locked[c]) newLocks++;
      }
      lockedGrid = cloneGrid(reels);
      respinsLeft = respins;
      active = newLocks > 0 || doStart;
    } else {
      for (var c2 = 0; c2 < dims.cols; c2++) {
        if (locked[c2]) {
          out[c2] = lockedGrid[c2].slice();
        } else if (colHas(reels, c2) || forceCols.indexOf(c2) >= 0) {
          locked[c2] = true;
          lockedGrid[c2] = reels[c2].slice();
          newLocks++;
        }
      }
      if (newLocks > 0 && resetOnNewLock) respinsLeft = respins;
      else respinsLeft = Math.max(0, respinsLeft - 1);
    }
    var lockedColumns = [], freeColumns = [];
    for (var c3 = 0; c3 < dims.cols; c3++) (locked[c3] ? lockedColumns : freeColumns).push(c3);
    var roundOver = active && (respinsLeft <= 0 || freeColumns.length === 0);
    if (roundOver) active = false;
    return {
      reels: out, lockedColumns: lockedColumns, freeColumns: freeColumns, lockedCount: lockedColumns.length,
      newLocks: newLocks, respinsLeft: respinsLeft, roundOver: roundOver, active: active,
      updatedState: { locked: locked, lockedGrid: lockedGrid, respinsLeft: respinsLeft, active: active }
    };
  }

  // ── 13. Hold And Win Grid (stateful, per-cell coins) ─────────────────────

  function holdAndWin(state, args) {
    var a = args || {};
    var NODE = 'Hold And Win Grid';
    var st = isObj(state) ? state : {};
    var reels = a.reels;
    var dims = gridDims(reels, NODE);
    var coin = toInt(a.coinSymbol, 0);
    if (coin <= 0) fail(NODE, 'coinSymbol must be a positive symbol id.');
    var blank = toInt(a.blankSymbol, 0);
    var respins = Math.max(0, toInt(a.respins, 3));
    var resetOnNewCoin = a.resetOnNewCoin === undefined ? true : toBool(a.resetOnNewCoin);
    var coinValues = parseArray(a.coinValues).map(function (v) { return toNum(v, 0); });
    if (coinValues.length === 0) coinValues = [1];
    var coinWeights = parseArray(a.coinValueWeights).map(function (w) { return Math.max(0, toNum(w, 0)); });
    if (coinWeights.length !== coinValues.length) coinWeights = coinValues.map(function () { return 1; });
    var bet = Math.max(0, toNum(a.betAmount, 0));
    var asMultiples = a.valuesAreBetMultiples === undefined ? true : toBool(a.valuesAreBetMultiples);
    var valueGridIn = parseArray(a.valueGrid);
    var grid = Array.isArray(st.grid) && st.grid.length === dims.cols ? cloneGrid(st.grid) : null;
    var values = Array.isArray(st.values) && st.values.length === dims.cols ? cloneGrid(st.values) : null;
    var respinsLeft = toInt(st.respinsLeft, 0);
    var active = toBool(st.active);
    var doReset = toBool(a.reset), doStart = toBool(a.start), doRespin = toBool(a.respin);
    var newCoins = 0;
    var rng = null;
    function ensureRng() {
      if (rng === null) { requireSeeds(a.seeds, 1, NODE); rng = lcg(a.seeds[0]); }
      return rng;
    }
    function drawValue() {
      var idx = ensureRng().weightedIndex(coinWeights);
      var v = idx >= 0 ? coinValues[idx] : 0;
      return asMultiples ? roundMoney(v * bet) : roundMoney(v);
    }
    if (doReset) { grid = null; values = null; respinsLeft = 0; active = false; }
    if (doStart || (!active && !doRespin)) {
      grid = [];
      values = [];
      for (var c = 0; c < dims.cols; c++) {
        grid.push([]);
        values.push([]);
        for (var r = 0; r < dims.rows; r++) {
          if (reels[c][r] === coin) {
            var given = Array.isArray(valueGridIn[c]) && typeof valueGridIn[c][r] === 'number' && valueGridIn[c][r] > 0 ? valueGridIn[c][r] : 0;
            grid[c].push(coin);
            values[c].push(given > 0 ? given : drawValue());
            newCoins++;
          } else {
            grid[c].push(blank);
            values[c].push(0);
          }
        }
      }
      respinsLeft = respins;
      active = newCoins > 0 || doStart;
    } else if (doRespin && active && grid !== null) {
      var base = weightedBaseReel(a.symbolWeights, reels, NODE);
      var r2 = ensureRng();
      for (var c2 = 0; c2 < dims.cols; c2++) {
        for (var rr = 0; rr < dims.rows; rr++) {
          if (grid[c2][rr] === coin) continue;
          var drawn = r2.pick(base);
          if (drawn === coin) { grid[c2][rr] = coin; values[c2][rr] = drawValue(); newCoins++; }
          else { grid[c2][rr] = blank; values[c2][rr] = 0; }
        }
      }
      if (newCoins > 0 && resetOnNewCoin) respinsLeft = respins;
      else respinsLeft = Math.max(0, respinsLeft - 1);
    }
    if (grid === null) { grid = cloneGrid(reels); values = blankGrid(dims.cols, dims.rows, 0); }
    var lockedCells = [];
    var total = 0, filled = 0;
    for (var c3 = 0; c3 < dims.cols; c3++) {
      for (var r3 = 0; r3 < dims.rows; r3++) {
        if (grid[c3][r3] === coin) { lockedCells.push([r3, c3]); total += values[c3][r3]; filled++; }
      }
    }
    var full = filled === dims.cols * dims.rows;
    var isComplete = active && (respinsLeft <= 0 || full);
    if (isComplete) active = false;
    return {
      grid: grid, valueGrid: values, lockedCells: lockedCells, lockedCount: filled, newCoins: newCoins,
      respinsLeft: respinsLeft, isComplete: isComplete, active: active, totalValue: total, isFull: full,
      updatedState: { grid: grid, values: values, respinsLeft: respinsLeft, active: active }
    };
  }

  // ── 14. Symbol Upgrade (stateful) ────────────────────────────────────────

  function applySymbolUpgrade(state, args) {
    var a = args || {};
    var NODE = 'Symbol Upgrade';
    var st = isObj(state) ? state : {};
    var reels = a.reels;
    var dims = gridDims(reels, NODE);
    var from = toInt(a.fromSymbol, 0), to = toInt(a.toSymbol, 0);
    var duration = Math.max(0, toInt(a.duration, 0));
    var remaining = toInt(st.remaining, 0);
    var active = toBool(st.active);
    if (toBool(a.reset)) { remaining = 0; active = false; }
    if (toBool(a.activate)) { remaining = duration > 0 ? duration : -1; active = true; }
    var out = cloneGrid(reels);
    var count = 0;
    if (active && from > 0 && to > 0) {
      for (var c = 0; c < dims.cols; c++) {
        for (var r = 0; r < dims.rows; r++) {
          if (out[c][r] === from) { out[c][r] = to; count++; }
        }
      }
    }
    if (active && remaining > 0) { remaining -= 1; if (remaining === 0) active = false; }
    return { reels: out, active: active, remaining: remaining < 0 ? -1 : remaining, upgradedCount: count, changed: count > 0, updatedState: { remaining: remaining, active: active } };
  }

  // ── 15. Feature Trigger ──────────────────────────────────────────────────

  function rollFeatureTrigger(args) {
    var a = args || {};
    var NODE = 'Feature Trigger';
    var chance = Math.max(0, Math.min(1, toNum(a.chance, 0.05)));
    requireSeeds(a.seeds, 1, NODE);
    var roll = lcg(a.seeds[0]).nextFloat();
    return { triggered: roll < chance, roll: roll, chance: chance };
  }

  // ── 16. Directional Cascade ──────────────────────────────────────────────

  function cascadeDirectional(args) {
    var a = args || {};
    var NODE = 'Directional Cascade';
    var reels = a.reels;
    var dims = gridDims(reels, NODE);
    var direction = String(a.direction === undefined || a.direction === null ? 'down' : a.direction);
    if (direction !== 'down' && direction !== 'up' && direction !== 'left' && direction !== 'right') direction = 'down';
    var positions = readPositions(a.winningLinesDetails);
    if (positions.length === 0 && a.positions !== undefined) positions = readPositions(a.positions);
    var clear = {};
    var cleared = [];
    for (var i = 0; i < positions.length; i++) {
      var pr = positions[i][0], pc = positions[i][1];
      if (pr >= 0 && pc >= 0 && pr < dims.rows && pc < dims.cols) {
        var k = posKey(pr, pc);
        if (!clear[k]) { clear[k] = true; cleared.push([pr, pc]); }
      }
    }
    var out = cloneGrid(reels);
    if (cleared.length === 0) return { reels: out, removedPositions: [], removedCount: 0, hadRemoval: false, direction: direction };
    var base = weightedBaseReel(a.symbolWeights, reels, NODE);
    requireSeeds(a.seeds, 1, NODE);
    var rng = lcg(a.seeds[0]);
    function pickSymbol() { return base[Math.floor(rng.nextFloat() * base.length)]; }
    var c, r, kept, empties, fill, n;
    if (direction === 'down' || direction === 'up') {
      for (c = 0; c < dims.cols; c++) {
        kept = [];
        for (r = 0; r < dims.rows; r++) if (!clear[posKey(r, c)]) kept.push(reels[c][r]);
        empties = dims.rows - kept.length;
        fill = [];
        for (n = 0; n < empties; n++) fill.push(pickSymbol());
        out[c] = direction === 'down' ? fill.concat(kept) : kept.concat(fill);
      }
    } else {
      for (r = 0; r < dims.rows; r++) {
        kept = [];
        for (c = 0; c < dims.cols; c++) if (!clear[posKey(r, c)]) kept.push(reels[c][r]);
        empties = dims.cols - kept.length;
        fill = [];
        for (n = 0; n < empties; n++) fill.push(pickSymbol());
        var line = direction === 'right' ? fill.concat(kept) : kept.concat(fill);
        for (c = 0; c < dims.cols; c++) out[c][r] = line[c];
      }
    }
    return { reels: out, removedPositions: cleared, removedCount: cleared.length, hadRemoval: true, direction: direction };
  }

  // ── 17. Wheel Spin ───────────────────────────────────────────────────────

  function spinWheel(args) {
    var a = args || {};
    var NODE = 'Wheel Spin';
    var raw = parseArray(a.segments);
    var weightsIn = parseArray(a.weights);
    var prizesIn = parseArray(a.prizes);
    var n = Math.max(raw.length, weightsIn.length, prizesIn.length);
    var segments = [];
    for (var i = 0; i < n; i++) {
      var s = raw[i];
      var seg;
      if (isObj(s)) {
        seg = {
          label: String(s.label !== undefined ? s.label : (s.name !== undefined ? s.name : i + 1)),
          weight: Math.max(0, toNum(s.weight, 1)),
          prize: s.prize !== undefined ? s.prize : (prizesIn[i] !== undefined ? prizesIn[i] : 0)
        };
      } else {
        seg = {
          label: s !== undefined && s !== null ? String(s) : String(i + 1),
          weight: 1,
          prize: prizesIn[i] !== undefined ? prizesIn[i] : (typeof s === 'number' ? s : 0)
        };
      }
      if (weightsIn[i] !== undefined) seg.weight = Math.max(0, toNum(weightsIn[i], 0));
      segments.push(seg);
    }
    if (segments.length === 0) fail(NODE, 'segments is empty: provide an array of labels or of { label, weight, prize } objects.');
    requireSeeds(a.seeds, 1, NODE);
    var idx = lcg(a.seeds[0]).weightedIndex(segments.map(function (sg) { return sg.weight; }));
    if (idx < 0) fail(NODE, 'all segment weights are zero.');
    var sweep = 360 / segments.length;
    return {
      segmentIndex: idx, prize: segments[idx].prize, prizeValue: toNum(segments[idx].prize, 0), label: segments[idx].label,
      angle: (idx + 0.5) * sweep, sweep: sweep, segmentCount: segments.length, segments: segments
    };
  }

  // ── 18. Pick Bonus (stateful) ────────────────────────────────────────────

  function pickBonus(state, args) {
    var a = args || {};
    var NODE = 'Pick Bonus';
    var st = isObj(state) ? state : {};
    var prizes = parseArray(a.prizes);
    var endMarkers = Math.max(0, toInt(a.endMarkers, 1));
    var endValue = a.endValue === undefined || a.endValue === null ? 'END' : a.endValue;
    var maxPicks = Math.max(0, toInt(a.picks, 0));
    var pool = Array.isArray(st.pool) ? st.pool.slice() : [];
    var revealedIdx = Array.isArray(st.revealedIdx) ? st.revealedIdx.slice() : [];
    var total = toNum(st.total, 0);
    var active = toBool(st.active);
    var ended = toBool(st.ended);
    var picksMade = toInt(st.picksMade, 0);
    var lastPrize = null, lastIsEnd = false, revealedNow = false;
    if (toBool(a.reset)) { pool = []; revealedIdx = []; total = 0; active = false; ended = false; picksMade = 0; }
    if (toBool(a.start)) {
      if (prizes.length === 0) fail(NODE, 'prizes is empty.');
      requireSeeds(a.seeds, 1, NODE);
      var full = prizes.slice();
      for (var e = 0; e < endMarkers; e++) full.push(endValue);
      pool = lcg(a.seeds[0]).shuffle(full);
      revealedIdx = []; total = 0; picksMade = 0; ended = false; active = true;
    }
    if (toBool(a.pick) && active && !ended) {
      var idx = toInt(a.pickIndex, -1);
      if (idx >= 0 && idx < pool.length && revealedIdx.indexOf(idx) < 0) {
        revealedIdx.push(idx);
        picksMade++;
        lastPrize = pool[idx];
        revealedNow = true;
        if (lastPrize === endValue) { lastIsEnd = true; ended = true; }
        else total += toNum(lastPrize, 0);
        if (maxPicks > 0 && picksMade >= maxPicks) ended = true;
        if (revealedIdx.length >= pool.length) ended = true;
      }
    }
    if (ended) active = false;
    var revealed = revealedIdx.map(function (i2) { return { index: i2, prize: pool[i2] }; });
    return {
      revealed: revealed, total: total, remaining: maxPicks > 0 ? Math.max(0, maxPicks - picksMade) : -1,
      ended: ended, active: active, lastPrize: lastPrize, lastIsEnd: lastIsEnd, revealedNow: revealedNow,
      poolSize: pool.length, picksMade: picksMade, hiddenCount: pool.length - revealedIdx.length,
      updatedState: { pool: pool, revealedIdx: revealedIdx, total: total, picksMade: picksMade, active: active, ended: ended }
    };
  }

  // ── 19. Paytable Modifier ────────────────────────────────────────────────

  function modifyPaytable(args) {
    var a = args || {};
    var paytable = parseObject(a.paytable);
    var scale = toNum(a.scale, 1);
    var overrides = parseObject(a.symbolOverrides);
    var mode = a.mode === 'absolute' ? 'absolute' : 'scale';
    var roundTo = Math.max(0, toInt(a.roundTo, 4));
    var f = Math.pow(10, roundTo);
    var out = {};
    var changed = false;
    var syms = Object.keys(paytable);
    for (var i = 0; i < syms.length; i++) {
      var sym = syms[i];
      var row = paytable[sym];
      if (!isObj(row)) { out[sym] = row; continue; }
      var ov = overrides[sym];
      var newRow = {};
      var counts = Object.keys(row);
      var k;
      if (mode === 'absolute' && isObj(ov)) {
        for (k = 0; k < counts.length; k++) {
          newRow[counts[k]] = ov[counts[k]] !== undefined ? toNum(ov[counts[k]], toNum(row[counts[k]], 0)) : toNum(row[counts[k]], 0) * scale;
        }
        var extra = Object.keys(ov);
        for (k = 0; k < extra.length; k++) if (newRow[extra[k]] === undefined) newRow[extra[k]] = toNum(ov[extra[k]], 0);
      } else {
        var symScale = isObj(ov) ? 1 : (ov !== undefined ? toNum(ov, 1) : 1);
        for (k = 0; k < counts.length; k++) newRow[counts[k]] = toNum(row[counts[k]], 0) * scale * symScale;
      }
      var outKeys = Object.keys(newRow);
      for (k = 0; k < outKeys.length; k++) {
        newRow[outKeys[k]] = Math.round(newRow[outKeys[k]] * f) / f;
        if (newRow[outKeys[k]] !== toNum(row[outKeys[k]], 0)) changed = true;
      }
      out[sym] = newRow;
    }
    return { paytable: out, changed: changed, scale: scale };
  }

  // ── 20. Chapter Branch (stateful) ────────────────────────────────────────

  function nextOptions(chapter) {
    var n = isObj(chapter) ? chapter.next : undefined;
    if (Array.isArray(n)) return n.map(String);
    if (isObj(n)) return Object.keys(n).map(function (k) { return String(n[k]); });
    if (typeof n === 'string') return [n];
    return [];
  }
  function resolveNext(chapter, choice) {
    var n = isObj(chapter) ? chapter.next : undefined;
    if (isObj(n)) return n[choice] !== undefined ? String(n[choice]) : '';
    if (Array.isArray(n)) {
      if (n.map(String).indexOf(choice) >= 0) return choice;
      var i = toInt(choice, -1);
      if (i >= 0 && i < n.length) return String(n[i]);
      return n.length === 1 ? String(n[0]) : '';
    }
    if (typeof n === 'string') return n;
    return '';
  }
  function chapterBranch(state, args) {
    var a = args || {};
    var st = isObj(state) ? state : {};
    var chapters = parseObject(a.chapters);
    var keys = Object.keys(chapters);
    var startKey = String(a.startKey !== undefined && a.startKey !== null && a.startKey !== '' ? a.startKey : (keys.length > 0 ? keys[0] : ''));
    var current = typeof st.currentKey === 'string' && chapters[st.currentKey] !== undefined ? st.currentKey : startKey;
    var changed = false;
    if (toBool(a.reset)) { current = startKey; changed = true; }
    var chapter = isObj(chapters[current]) ? chapters[current] : {};
    var options = nextOptions(chapter);
    if (toBool(a.advance)) {
      var choice = a.choice === undefined || a.choice === null ? '' : String(a.choice);
      var target = resolveNext(chapter, choice);
      if (target.length > 0 && chapters[target] !== undefined) {
        current = target;
        changed = true;
        chapter = isObj(chapters[current]) ? chapters[current] : {};
        options = nextOptions(chapter);
      }
    }
    return { chapter: chapter, currentKey: current, nextKeys: options, isEnd: options.length === 0, changed: changed, chapterIndex: keys.indexOf(current), updatedState: { currentKey: current } };
  }

  // ── 21. Paytable Rows (presentation data) ────────────────────────────────

  function paytableRows(args) {
    var a = args || {};
    var paytable = parseObject(a.paytable);
    var names = a.symbolNames;
    var bet = Math.max(0, toNum(a.betAmount, 0));
    var lines = Math.max(1, toInt(a.paylinesCount, 1));
    var perLine = bet / lines;
    function nameOf(sym) {
      if (Array.isArray(names)) { var v = names[sym - 1]; return v === undefined ? String(sym) : String(v); }
      if (isObj(names)) return names[sym] === undefined ? String(sym) : String(names[sym]);
      return String(sym);
    }
    var syms = Object.keys(paytable).map(function (k) { return toNum(k, NaN); }).filter(function (n) { return !isNaN(n); }).sort(function (x, y) { return x - y; });
    var rows = [], flat = [];
    for (var i = 0; i < syms.length; i++) {
      var sym = syms[i];
      var row = paytable[sym];
      if (!isObj(row)) continue;
      var entries = Object.keys(row).map(function (k2) { return { count: toNum(k2, 0), multiplier: toNum(row[k2], 0) }; })
        .filter(function (e) { return e.count > 0; })
        .sort(function (p, q) { return p.count - q.count; })
        .map(function (e2) { return { count: e2.count, multiplier: e2.multiplier, payout: roundMoney(perLine * e2.multiplier) }; });
      rows.push({ symbol: sym, name: nameOf(sym), entries: entries });
      for (var j = 0; j < entries.length; j++) flat.push({ symbol: sym, name: nameOf(sym), count: entries[j].count, multiplier: entries[j].multiplier, payout: entries[j].payout });
    }
    return { rows: rows, flatRows: flat, symbolCount: rows.length, betPerLine: perLine };
  }

  return {
    // helpers (also useful to the client nodes)
    normaliseSeed: normaliseSeed, requireSeeds: requireSeeds, lcg: lcg, gridDims: gridDims, cloneGrid: cloneGrid,
    readPositions: readPositions, weightedBaseReel: weightedBaseReel, bracketMultiplier: bracketMultiplier,
    // cores
    evaluateClusterPays: evaluateClusterPays,
    applyProgressiveMeter: applyProgressiveMeter,
    stepMultiplierLadder: stepMultiplierLadder,
    buildSymbolValueGrid: buildSymbolValueGrid,
    collectCoins: collectCoins,
    evaluateJackpotTiers: evaluateJackpotTiers,
    resolveJackpotPools: resolveJackpotPools,
    computeBetMode: computeBetMode,
    selectVariant: selectVariant,
    applyStickySymbols: applyStickySymbols,
    expandSymbols: expandSymbols,
    applyLockedReels: applyLockedReels,
    holdAndWin: holdAndWin,
    applySymbolUpgrade: applySymbolUpgrade,
    rollFeatureTrigger: rollFeatureTrigger,
    cascadeDirectional: cascadeDirectional,
    spinWheel: spinWheel,
    pickBonus: pickBonus,
    modifyPaytable: modifyPaytable,
    chapterBranch: chapterBranch,
    paytableRows: paytableRows
  };
}

var SLOT_FEATURE_CORES = defineSlotFeatureCores();

module.exports = Object.assign(
  {
    defineSlotFeatureCores: defineSlotFeatureCores,
    /** The exact text the RGS compiler embeds: `const __sfc = (<CORES_SOURCE>)();` */
    CORES_SOURCE: String(defineSlotFeatureCores),
    coreNames: Object.keys(SLOT_FEATURE_CORES)
  },
  SLOT_FEATURE_CORES
);
