#!/usr/bin/env node
/**
 * generate-engine-history.cjs — every earlier version of every node member, as hashes, so a node
 * Script that is a stale FULL copy of an older engine is recognised as untouched
 * (src/nodescript.js isPastEngineVersion).
 *
 * WHY (2026-10-04, COol: "they change before spin"). A Script is saved as a full copy of the
 * node's definition; a member counts as edited when it differs from the CURRENT engine. When the
 * engine fixed four PixiReelColumn methods, games holding an older full copy reinstalled the old
 * four and the fix never ran. Knowing every version the engine has shipped tells a stale copy
 * from a real edit.
 *
 * HOW. A Script holds the text the editor read from a BUILT bundle, so three sources are hashed
 * (the same canonicalFunctionText + FNV-1a the runtime applies to a Script):
 *   1. the built bundles themselves (--bundles): every definition object in them, exactly as the
 *      editor reads it — run this after each bundle build so today's text is known when the
 *      engine next changes;
 *   2. every git version of the engine sources (--roots), compiled with the viewer bundle's own
 *      Babel config twice — console calls kept (the viewer bundle is built without
 *      NODE_ENV=production) and stripped;
 *   3. those versions again with the bundle's webpack renames applied (`PIXI.Assets` is
 *      `lib.Assets` in a concatenated module, `isObject` is `react_component_node_isObject`),
 *      learned per node type by lining up the current source with the current bundle.
 * A definition object is one with methods / prototypeExtensions / inputs / outputs / initialize;
 * one with no literal `name` (the shared React-node members) is recorded under the type "*".
 *
 *   node packages/xgenia-runtime/scripts/generate-engine-history.cjs [--repo private] [--max 400]
 *
 * Output: src/engine-history.generated.js.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RUNTIME = path.resolve(__dirname, '..');
const OUTER = path.resolve(RUNTIME, '..', '..');
const VIEWER = path.join(OUTER, 'packages', 'xgenia-viewer-react');
const NS = require(path.join(RUNTIME, 'src', 'nodescript.js'));

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const REPO = path.resolve(OUTER, opt('--repo', 'private'));
const MAX_VERSIONS = Number(opt('--max', 400));
/** Source roots (relative to REPO) whose node definitions users override most: the reel and slot system. */
const ROOTS = (opt('--roots', 'xgenia-pro-nodes/src/pixi,xgenia-pro-nodes/src/slot-games,xgenia-pro-nodes/src/utils/react-component-node.js')).split(',');
const OUT = path.join(RUNTIME, 'src', 'engine-history.generated.js');
/** The built bundles a Script's text is read from (relative to the outer repo); missing ones are skipped. */
const BUNDLES = (opt('--bundles', 'packages/xgenia-editor/src/external/viewer/xgenia.viewer.js,packages/xgenia-editor/src/external/deploy/xgenia.deploy.js')).split(',').filter(Boolean);
/** The bundle's Babel config strips console calls only when NODE_ENV is production. */
const MODES = ['production', 'development'];
const babel = require(require.resolve('@babel/core', { paths: [VIEWER] }));
const parser = require(require.resolve('@babel/parser', { paths: [VIEWER] }));
const BABEL_CONFIG = path.join(VIEWER, 'babel.config.js');

function git(...a) {
    return execFileSync('git', ['-C', REPO, ...a], { maxBuffer: 1 << 28 }).toString();
}

function sourceFiles() {
    const out = [];
    for (const root of ROOTS) {
        const abs = path.join(REPO, root);
        if (!fs.existsSync(abs)) continue;
        if (fs.statSync(abs).isFile()) { out.push(root); continue; }
        const walk = (dir) => {
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                const p = path.join(dir, e.name);
                if (e.isDirectory()) walk(p);
                else if (/\.jsx?$/.test(e.name) && !/\.test\./.test(e.name)) out.push(path.relative(REPO, p));
            }
        };
        walk(abs);
    }
    return out;
}

function compile(src, mode = 'production') {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = mode;
    try {
        return babel.transformSync(src, {
            filename: path.join(VIEWER, 'src', 'engine-history-input.js'),
            cwd: VIEWER,
            configFile: BABEL_CONFIG,
            babelrc: false,
            sourceType: 'unambiguous',
            caller: { name: 'babel-loader', supportsStaticESM: true, supportsDynamicImport: true, supportsTopLevelAwait: true },
        }).code;
    } finally {
        if (prev === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = prev;
    }
}

const TOKEN = /[A-Za-z_$][\w$]*|\S/g;
const tokens = (text) => text.match(TOKEN) || [];
const isIdent = (t) => /^[A-Za-z_$]/.test(t);

/**
 * The identifier renames between a member as compiled and the same member in a bundle, when the
 * two differ ONLY in identifiers (webpack's module concatenation renames imports and colliding
 * module-level names). Property names (after a `.`) are never renamed.
 */
function renamesBetween(compiled, bundled) {
    const a = tokens(compiled);
    const b = tokens(bundled);
    if (a.length !== b.length) return null;
    const map = {};
    for (let i = 0; i < a.length; i++) {
        if (a[i] === b[i]) continue;
        if (!isIdent(a[i]) || !isIdent(b[i]) || a[i - 1] === '.') return null;
        if (map[a[i]] && map[a[i]] !== b[i]) return null;
        map[a[i]] = b[i];
    }
    return map;
}

/** `text` with `renames` applied to whole identifiers that are not property names. */
function applyRenames(text, renames) {
    const names = Object.keys(renames || {});
    if (!names.length) return text;
    const re = new RegExp('(^|[^\\w$.])(' + names.map((n) => n.replace(/\$/g, '\\$')).join('|') + ')(?![\\w$])', 'g');
    return text.replace(re, (m, pre, name) => pre + renames[name]);
}

/** Every name a bundle's import references carry in their comments (`mod/* name *\/.sG`), plus PIXI. */
function importNames(code) {
    const names = new Set(['PIXI']);
    for (const m of code.matchAll(/\/\* ([A-Za-z_$][\w$]*) \*\/\s*\./g)) names.add(m[1]);
    return names;
}

const keyName = (n) => (n && (n.name || n.value)) || null;
const isFn = (v) => v && /^(FunctionExpression|ArrowFunctionExpression)$/.test(v.type);
const DEF_KEYS = ['methods', 'prototypeExtensions', 'inputs', 'outputs', 'initialize'];

/** { typeName: { memberKey: [canonicalText…] } } for one compiled file or bundle (a type can be defined more than once, "*" always is). */
function membersOf(code, scopeNames) {
    let ast;
    try { ast = parser.parse(code, { sourceType: 'unambiguous', plugins: ['jsx'], errorRecovery: true }); } catch { return {}; }
    const slice = (n) => code.slice(n.start, n.end);
    const fnText = (prop) => (prop.type === 'ObjectMethod' ? 'function ' + code.slice(prop.key.start, prop.end) : slice(prop.value));
    const fnProp = (prop) => prop && (prop.type === 'ObjectMethod' || (prop.type === 'ObjectProperty' && isFn(prop.value)));
    const out = {};
    const add = (type, key, text) => {
        const canon = NS.canonicalFunctionText(text, scopeNames);
        if (!canon) return;
        const t = (out[type] = out[type] || {});
        (t[key] = t[key] || []).push(canon);
    };
    const portMembers = (type, prefix, portName, portObj) => {
        const members = prefix === 'inputs' ? ['set', 'valueChangedToTrue'] : ['get', 'getter'];
        for (const p of portObj.properties) {
            const pk = keyName(p.key);
            if (fnProp(p) && members.includes(pk)) add(type, `${prefix}.${portName}.${pk === 'getter' ? 'get' : pk}`, fnText(p));
        }
    };
    const visit = (node) => {
        if (!node || typeof node !== 'object') return;
        // Ports added after the definition: `ReactComponentNode.inputs.variant = { set(…) { … } }`.
        if (node.type === 'AssignmentExpression' && node.right && node.right.type === 'ObjectExpression' &&
            node.left.type === 'MemberExpression' && node.left.object.type === 'MemberExpression') {
            const io = keyName(node.left.object.property);
            const port = keyName(node.left.property);
            if ((io === 'inputs' || io === 'outputs') && port && !node.left.computed) portMembers('*', io, port, node.right);
        }
        if (node.type === 'ObjectExpression') {
            const props = node.properties.filter((p) => p.type === 'ObjectProperty' || p.type === 'ObjectMethod');
            const byKey = new Map(props.map((p) => [keyName(p.key), p]));
            if (DEF_KEYS.some((k) => byKey.has(k))) {
                const nameProp = byKey.get('name');
                const type = nameProp && nameProp.type === 'ObjectProperty' && nameProp.value.type === 'StringLiteral' ? nameProp.value.value : '*';
                for (const k of ['methods', 'prototypeExtensions']) {
                    const m = byKey.get(k);
                    if (m && m.type === 'ObjectProperty' && m.value.type === 'ObjectExpression') {
                        for (const p of m.value.properties) if (fnProp(p) && keyName(p.key)) add(type, 'methods.' + keyName(p.key), fnText(p));
                    }
                }
                for (const k of ['inputs', 'outputs']) {
                    const io = byKey.get(k);
                    if (!io || io.type !== 'ObjectProperty' || io.value.type !== 'ObjectExpression') continue;
                    for (const port of io.value.properties) {
                        if (port.type !== 'ObjectProperty' || port.value.type !== 'ObjectExpression' || !keyName(port.key)) continue;
                        portMembers(type, k, keyName(port.key), port.value);
                    }
                }
                const init = byKey.get('initialize');
                if (fnProp(init)) add(type, 'initialize', fnText(init));
            }
        }
        for (const k in node) {
            if (k === 'loc' || k === 'start' || k === 'end') continue;
            const v = node[k];
            if (Array.isArray(v)) v.forEach(visit);
            else if (v && typeof v === 'object' && v.type) visit(v);
        }
    };
    visit(ast.program);
    return out;
}

function main() {
    const history = {};   // type -> key -> Set(hash)
    const record = (members) => {
        for (const [type, keys] of Object.entries(members)) {
            for (const [key, texts] of Object.entries(keys)) {
                const t = (history[type] = history[type] || {});
                for (const canon of texts) (t[key] = t[key] || new Set()).add(NS.memberHash(canon));
            }
        }
    };

    // 1. The built bundles, as the editor reads them (imports as bundled, and rewritten to their names).
    const bundled = [];
    for (const rel of BUNDLES) {
        const abs = path.resolve(OUTER, rel);
        if (!fs.existsSync(abs)) { console.warn(`engine history: no bundle at ${rel} — build it first for exact bundle text`); continue; }
        const code = fs.readFileSync(abs, 'utf8');
        const plain = membersOf(code);
        const named = membersOf(code, importNames(code));
        record(plain);
        record(named);
        bundled.push(named);
    }

    // 2. Every git version of the sources, in both Babel modes; 3. with the bundle's renames.
    const files = sourceFiles();
    let compiled = 0;
    for (const file of files) {
        const revs = git('log', '--format=%H', '--follow', '-n', String(MAX_VERSIONS), '--', file).split('\n').filter(Boolean);
        const versions = [];
        const seen = new Set();
        for (const rev of ['WORKTREE', ...revs]) {
            let src;
            try { src = rev === 'WORKTREE' ? fs.readFileSync(path.join(REPO, file), 'utf8') : git('show', `${rev}:${file}`); } catch { continue; }
            if (seen.has(src)) continue;
            seen.add(src);
            for (const mode of MODES) {
                try { versions.push({ rev, mode, members: membersOf(compile(src, mode)) }); compiled++; } catch { /* a version that never built (conflict markers) */ }
            }
        }
        // Renames per type, learned from the newest version of each mode against the bundles.
        const renames = {};
        for (const v of versions.filter((x) => x.rev === 'WORKTREE')) {
            for (const [type, keys] of Object.entries(v.members)) {
                for (const b of bundled) {
                    const bk = b[type];
                    if (!bk) continue;
                    for (const [key, texts] of Object.entries(keys)) {
                        for (const canon of texts) {
                            for (const other of bk[key] || []) {
                                if (other === canon) continue;
                                const map = renamesBetween(canon, other);
                                if (map) Object.assign((renames[type] = renames[type] || {}), map);
                            }
                        }
                    }
                }
            }
        }
        for (const v of versions) {
            record(v.members);
            const renamed = {};
            for (const [type, keys] of Object.entries(v.members)) {
                if (!renames[type]) continue;
                renamed[type] = {};
                for (const [key, texts] of Object.entries(keys)) renamed[type][key] = texts.map((canon) => applyRenames(canon, renames[type]));
            }
            record(renamed);
        }
    }

    const types = {};
    for (const type of Object.keys(history).sort()) {
        types[type] = {};
        for (const key of Object.keys(history[type]).sort()) types[type][key] = [...history[type][key]].sort();
    }
    const body = `// GENERATED by packages/xgenia-runtime/scripts/generate-engine-history.cjs — do not edit.
// Every earlier engine version of each node member (FNV-1a of canonicalFunctionText), so a node
// Script that is a stale full copy of an older engine is told apart from a real edit.
module.exports = ${JSON.stringify({ version: 1, types })};
`;
    fs.writeFileSync(OUT, body);
    const memberCount = Object.values(types).reduce((a, t) => a + Object.keys(t).length, 0);
    const hashCount = Object.values(types).reduce((a, t) => a + Object.values(t).reduce((b, l) => b + l.length, 0), 0);
    console.log(`engine history: ${bundled.length} bundles, ${files.length} files, ${compiled} versions compiled, ${Object.keys(types).length} node types, ${memberCount} members, ${hashCount} hashes → ${path.relative(OUTER, OUT)} (${Math.round(body.length / 1024)} KB)`);
}

if (require.main === module) main();
module.exports = { membersOf, compile, renamesBetween, applyRenames, importNames };
