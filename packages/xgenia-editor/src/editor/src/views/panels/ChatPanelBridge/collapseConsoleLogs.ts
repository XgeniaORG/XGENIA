/**
 * collapseConsoleLogs — fold runs of identical console lines so a capped window holds
 * DISTINCT output.
 *
 * (2026-10-09, export 1791536143029) `execute_code` shows the first 20 captured lines. A node
 * that logs every frame fills all 20: a two-second probe of a mascot sprite's animation ticker
 * came back as twenty copies of
 *     [PixiSpriteNode f7615d3f…] Updating drop shadow filter, enabled: false
 * and the script's own `console.debug('DECISIVE PROBE 2', …)` — the line it had waited two
 * seconds to print — fell outside the window. Any probe that sleeps loses its own output to
 * whatever the engine happens to say in the meantime, which is the opposite of what the cap is
 * for.
 *
 * Consecutive identical (level, message) pairs collapse to one entry carrying a count, so the
 * window spends its 20 slots on distinct messages. Non-adjacent repeats stay separate: the
 * ORDER of console output is evidence (what ran before what), and merging across a gap would
 * invent an ordering that never happened.
 */

export interface ConsoleEntry {
    level: string;
    message: unknown;
}

export interface CollapsedEntry {
    level: string;
    message: string;
    /** How many identical lines in a row this stands for (1 = it appeared once). */
    repeats: number;
}

export function collapseConsoleLogs(logs: ReadonlyArray<ConsoleEntry> | null | undefined): CollapsedEntry[] {
    if (!Array.isArray(logs)) return [];
    const out: CollapsedEntry[] = [];
    for (const entry of logs) {
        const level = String(entry?.level ?? 'log');
        const message = String(entry?.message ?? '');
        const last = out[out.length - 1];
        if (last && last.level === level && last.message === message) last.repeats++;
        else out.push({ level, message, repeats: 1 });
    }
    return out;
}

/** The "Console output (…)" header: total lines, and what the window is actually showing. */
export function consoleOutputHeader(totalLines: number, distinctLines: number, maxShown: number): string {
    return `Console output (${totalLines}`
        + (distinctLines !== totalLines ? `, ${distinctLines} distinct` : '')
        + (distinctLines > maxShown ? `, first ${maxShown} distinct shown` : '')
        + '):';
}
