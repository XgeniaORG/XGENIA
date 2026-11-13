/**
 * A Stake Engine maths package, read the way Stake's RGS reads it.
 *
 * The upload is a directory (the editor writes it as `<folder>/math/publish_files/`):
 *   index.json                     {"modes":[{"name","cost","events","weights"}]}
 *   books_<mode>.jsonl.zst         one book per line: {"id","payoutMultiplier","events":[...]}
 *   lookUpTable_<mode>_0.csv       no header, rows `id,weight,payoutMultiplier` (uint64)
 *
 * Books stay as one decompressed Buffer per mode and are parsed on demand: a real package is
 * 100k–1M books per mode, and the emulator only ever needs the one it draws. Weights are BigInt,
 * because an optimised table's weights sum past 2^53.
 *
 * Sources: StakeEngine/math-sdk docs/rgs_docs/data_format.md, utils/rgs_verification.py.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export class PackageError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Read a books file: `.jsonl.zst`/`.jsonl.zstd` (what Stake accepts) or plain `.jsonl` (local debugging). */
export function readBooksBuffer(file) {
  const raw = fs.readFileSync(file);
  if (/\.zstd?$/.test(file)) {
    if (typeof zlib.zstdDecompressSync !== 'function') {
      throw new PackageError('NO_ZSTD', 'This Node has no zstd (22.15+ needed) and the books are zstd-compressed.');
    }
    return zlib.zstdDecompressSync(raw);
  }
  return raw;
}

/** [start, end) byte offsets of every non-empty line. */
function lineOffsets(buf) {
  const starts = [];
  const ends = [];
  let s = 0;
  for (let i = 0; i <= buf.length; i++) {
    if (i === buf.length || buf[i] === 0x0a) {
      let e = i;
      if (e > s && buf[e - 1] === 0x0d) e--;
      if (e > s) {
        starts.push(s);
        ends.push(e);
      }
      s = i + 1;
    }
  }
  return { starts, ends };
}

/**
 * Parse a lookup table. Returns rows and the problems found; never throws on content, because the
 * validator wants every problem, not the first.
 */
export function parseLookupTable(text) {
  const rows = [];
  const problems = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cells = line.split(',');
    if (cells.length !== 3 || !cells.every((c) => /^\d+$/.test(c.trim()))) {
      problems.push({ line: i + 1, text: line.slice(0, 80) });
      continue;
    }
    rows.push({ id: Number(cells[0]), weight: BigInt(cells[1]), payout: Number(cells[2]) });
  }
  return { rows, problems };
}

export function loadMode(dir, entry) {
  const name = String(entry?.name ?? '');
  const cost = Number(entry?.cost);
  const booksFile = path.join(dir, String(entry?.events ?? ''));
  const lutFile = path.join(dir, String(entry?.weights ?? ''));
  if (!entry?.events || !fs.existsSync(booksFile)) {
    throw new PackageError('MODE_FILE_MISSING', `Mode "${name}": books file "${entry?.events}" not found.`);
  }
  if (!entry?.weights || !fs.existsSync(lutFile)) {
    throw new PackageError('MODE_FILE_MISSING', `Mode "${name}": lookup table "${entry?.weights}" not found.`);
  }
  const buf = readBooksBuffer(booksFile);
  const { starts, ends } = lineOffsets(buf);
  const lut = parseLookupTable(fs.readFileSync(lutFile, 'utf8'));

  // Cumulative weights for drawing a book, as the RGS does.
  const cumulative = new Array(lut.rows.length);
  let total = 0n;
  for (let i = 0; i < lut.rows.length; i++) {
    total += lut.rows[i].weight;
    cumulative[i] = total;
  }

  let byId = null;
  const mode = {
    name,
    cost,
    booksFile,
    lutFile,
    entry,
    lut,
    bookCount: starts.length,
    totalWeight: total,
    cumulative,
    /** Raw text of line i. */
    line(i) {
      return buf.toString('utf8', starts[i], ends[i]);
    },
    /** Parsed book on line i. */
    book(i) {
      return JSON.parse(mode.line(i));
    },
    /** Book with simulation id `id` (the id the LUT names), or null. */
    bookById(id) {
      if (!byId) {
        byId = new Map();
        for (let i = 0; i < starts.length; i++) {
          try {
            byId.set(Number(JSON.parse(mode.line(i)).id), i);
          } catch {
            /* the validator reports unparsable lines */
          }
        }
      }
      const i = byId.get(Number(id));
      return i === undefined ? null : mode.book(i);
    },
    /** Iterate every book line with its line number; parse errors are yielded, not thrown. */
    *lines() {
      for (let i = 0; i < starts.length; i++) yield { i, text: mode.line(i) };
    },
  };
  return mode;
}

export function loadPackage(dir) {
  const abs = path.resolve(dir);
  const indexFile = path.join(abs, 'index.json');
  if (!fs.existsSync(indexFile)) {
    throw new PackageError('INDEX_MISSING', `No index.json in ${abs}. Point at the directory you upload (math/publish_files).`);
  }
  let index;
  try {
    index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  } catch (e) {
    throw new PackageError('INDEX_INVALID', `index.json is not JSON: ${e.message}`);
  }
  if (!index || !Array.isArray(index.modes) || index.modes.length === 0) {
    throw new PackageError('INDEX_INVALID', 'index.json has no "modes" array.');
  }
  const modes = index.modes.map((m) => loadMode(abs, m));
  return {
    dir: abs,
    index,
    modes,
    /** Stake's frontend sends BASE/BONUS while the maths names them base/bonus; match ignoring case. */
    mode(name) {
      const n = String(name ?? '').toLowerCase();
      return modes.find((m) => m.name.toLowerCase() === n) ?? null;
    },
  };
}

/** Write a package (used by fixtures and rebalance). `books` are objects; LUT rows {id, weight, payout}. */
export function writePackage(dir, modes, { compress = true } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const index = { modes: [] };
  for (const m of modes) {
    const booksName = `books_${m.name}.jsonl${compress ? '.zst' : ''}`;
    const lutName = `lookUpTable_${m.name}_0.csv`;
    const text = m.books.map((b) => JSON.stringify(b)).join('\n') + '\n';
    const data = compress ? zlib.zstdCompressSync(Buffer.from(text, 'utf8')) : text;
    fs.writeFileSync(path.join(dir, booksName), data);
    writeLookupTable(path.join(dir, lutName), m.lut);
    index.modes.push({ name: m.name, cost: m.cost, events: booksName, weights: lutName });
  }
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index, null, 2));
  return dir;
}

export function writeLookupTable(file, rows) {
  fs.writeFileSync(file, rows.map((r) => `${r.id},${r.weight},${r.payout}`).join('\n') + '\n');
}
