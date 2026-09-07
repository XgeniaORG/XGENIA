/**
 * memory-telemetry.js — passive per-process memory curve, on disk.
 *
 * WHY THIS EXISTS (crash-log 2026-08-27, exit code 6): the editor renderer
 * aborted with a V8 fatal OOM ("CppHeap allocation failure") after an
 * ~8.4-hour session. The minidump proves the abort but says nothing about
 * WHAT grew, and the existing renderer memory panel (Cmd+Alt+M) keeps its
 * samples in renderer memory — they die with the renderer, so a crashed
 * session leaves no curve to read.
 *
 * This module records the curve from the MAIN process, which survives the
 * renderer's death:
 *   1. every SAMPLE_INTERVAL_MS, app.getAppMetrics() is appended as one JSON
 *      line to <userData>/memory-log.jsonl (per-process pid/type/workingSet),
 *      with renderer pids labelled via webContents so 'editor-window' is
 *      distinguishable from the viewer/GPU/utility processes;
 *   2. renderers may push their own counters (JS heap, DOM node count,
 *      canvas pixels, data-URL bytes) over the 'memory-telemetry:sample' IPC
 *      channel; they land in the same file as kind:'renderer' lines so the
 *      process curve and the who-grew counters line up on one timeline.
 *
 * Reading it: process growth without counter growth points at CppHeap /
 * Blink objects (detached DOM, image/canvas backings) — take a DevTools heap
 * snapshot at the high-water mark. Counter growth names the store directly.
 */
const { app, ipcMain, webContents } = require('electron');
const fs = require('fs');
const path = require('path');

const MEMORY_LOG_FILENAME = 'memory-log.jsonl';
const SAMPLE_INTERVAL_MS = 60_000;
// Burst mode (crash 2026-08-27 #2): the fatal pattern measured was NOT a slow
// leak — 157MB -> 4GB in under two minutes, invisible at a 60s cadence until
// it was already dying. A per-process jump past SPIKE_KB between ticks drops
// the cadence to 5s for 5 minutes, records the offending process's frame tree
// (the counters can't see inside cross-origin iframes, but the frame URLs
// name who was doing something), and asks every renderer for an immediate
// counter sample.
const FAST_INTERVAL_MS = 5_000;
const FAST_MODE_DURATION_MS = 5 * 60_000;
const SPIKE_KB = 256 * 1024;
// ~330 bytes/line for procs + ~200 for renderer = <1MB/day. Rotate well
// before the file gets annoying to grep or ship in a support bundle.
const MAX_LOG_BYTES = 8 * 1024 * 1024;

let timer = null;
let fastUntil = 0;
let lastWsByPid = {};

function logPath() {
  return path.join(app.getPath('userData'), MEMORY_LOG_FILENAME);
}

/**
 * Append one line, rotating the current file to memory-log.1.jsonl when it
 * outgrows MAX_LOG_BYTES (one previous generation kept, older overwritten).
 * Never throws — telemetry must not be able to hurt the app.
 */
function append(entry) {
  try {
    const file = logPath();
    try {
      if (fs.statSync(file).size > MAX_LOG_BYTES) {
        fs.renameSync(file, file.replace(/\.jsonl$/, '.1.jsonl'));
      }
    } catch (e) {
      // stat fails when the file doesn't exist yet — nothing to rotate
    }
    fs.appendFileSync(file, JSON.stringify(entry) + '\n');
  } catch (e) {
    console.error('[MemoryTelemetry] append failed:', e && e.message);
  }
}

/**
 * Label renderer pids with what they're running, so the curve says
 * 'editor-window grew', not 'pid 14573 grew'. Best-effort — an unmatched
 * pid (GPU, utility) just keeps its bare type from getAppMetrics.
 */
function labelByPid() {
  const labels = {};
  try {
    for (const wc of webContents.getAllWebContents()) {
      try {
        labels[wc.getOSProcessId()] = (wc.getURL() || '').slice(0, 80);
      } catch (e) {
        // destroyed webContents throw on access mid-iteration — skip
      }
    }
  } catch (e) {
    // labels stay empty; the sample is still worth keeping
  }
  return labels;
}

/**
 * The frame tree (URLs only) of every webContents whose OS process is `pid` —
 * the spike log's best clue to WHICH page/iframe was active in an exploding
 * process, since renderer counters cannot see across iframe origins.
 */
function frameUrlsForPid(pid) {
  const frames = [];
  try {
    for (const wc of webContents.getAllWebContents()) {
      try {
        if (wc.getOSProcessId() !== pid || !wc.mainFrame) continue;
        for (const f of wc.mainFrame.framesInSubtree) {
          frames.push((f.url || '').slice(0, 120));
        }
      } catch (e) {
        // destroyed webContents mid-iteration — skip
      }
    }
  } catch (e) {
    // frames stay partial; the spike line is still worth writing
  }
  return frames;
}

function sample() {
  try {
    const labels = labelByPid();
    const spikes = [];
    const procs = app.getAppMetrics().map((m) => {
      const wsKB = m.memory && m.memory.workingSetSize;
      const prev = lastWsByPid[m.pid];
      if (typeof wsKB === 'number') {
        if (typeof prev === 'number' && wsKB - prev > SPIKE_KB) {
          spikes.push({ pid: m.pid, fromKB: prev, toKB: wsKB, frames: frameUrlsForPid(m.pid) });
        }
        lastWsByPid[m.pid] = wsKB;
      }
      return {
        pid: m.pid,
        type: m.type,
        // KB, as Electron reports it. workingSetSize is the one that shows the
        // CppHeap/Oilpan climb that performance.memory cannot see.
        wsKB,
        peakKB: m.memory && m.memory.peakWorkingSetSize,
        url: labels[m.pid]
      };
    });
    append({ timestamp: new Date().toISOString(), kind: 'procs', procs });

    if (spikes.length) {
      append({ timestamp: new Date().toISOString(), kind: 'spike', spikes });
      fastUntil = Date.now() + FAST_MODE_DURATION_MS;
      // Renderer counters at the moment of the spike, not up to 60s later.
      for (const wc of webContents.getAllWebContents()) {
        try { wc.send('memory-telemetry:request-sample'); } catch (e) { /* destroyed */ }
      }
    }
  } catch (e) {
    console.error('[MemoryTelemetry] sample failed:', e && e.message);
  }
}

function schedule() {
  const interval = Date.now() < fastUntil ? FAST_INTERVAL_MS : SAMPLE_INTERVAL_MS;
  timer = setTimeout(() => {
    sample();
    schedule();
  }, interval);
  // Don't let the sampler keep the app alive on quit.
  if (timer.unref) timer.unref();
}

/**
 * Start sampling. Call from app 'ready' (getAppMetrics/webContents need a
 * live app). Safe to call once; never throws.
 */
function start() {
  if (timer) return;
  try {
    ipcMain.on('memory-telemetry:sample', (event, payload) => {
      if (!payload || typeof payload !== 'object') return;
      append({
        timestamp: new Date().toISOString(),
        kind: 'renderer',
        pid: event.sender ? event.sender.getOSProcessId() : undefined,
        ...payload
      });
    });

    sample(); // baseline immediately, then the scheduled cadence
    schedule();
  } catch (e) {
    console.error('[MemoryTelemetry] start failed:', e && e.message);
  }
}

// _sampleForTest lets a test drive ticks without waiting out the real cadence.
module.exports = { start, MEMORY_LOG_FILENAME, _sampleForTest: sample };
