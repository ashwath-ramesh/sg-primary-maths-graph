#!/usr/bin/env node
// Validate data/*.json, then write data/manifest.json and docs/data.js.
// Zero dependencies. Usage: node scripts/build.mjs [--check] [--out <dir>] [dataDir]
//   --check      validate and fail if the generated files are out of date; write nothing
//   --out <dir>  where data.js goes (default: docs/ for the repo's own data/, otherwise dataDir)
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const fail = (m) => { console.error(`✗ ${m}`); process.exit(1); };

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let CHECK_ONLY = false, out = null, dataArg = null;
for (const args = process.argv.slice(2); args.length;) {
  const a = args.shift();
  if (a === '--check') CHECK_ONLY = true;
  else if (a === '--out') {
    out = args.shift();
    if (!out || out.startsWith('--')) fail('--out needs a directory');
  }
  else if (a.startsWith('--')) fail(`unknown option ${a}`);
  else dataArg = a;
}
const DATA = resolve(dataArg ?? join(ROOT, 'data'));
// A fixture data folder must never overwrite the live viewer bundle.
const VIEWER = resolve(out ?? (DATA === join(ROOT, 'data') ? join(ROOT, 'docs') : DATA));

const LEVELS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
const STRANDS = [
  { code: 'NA', name: 'Number and Algebra' },
  { code: 'MG', name: 'Measurement and Geometry' },
  { code: 'ST', name: 'Statistics' },
];
// Order here is the display order (bands top to bottom in the viewer).
const SUB_STRANDS = [
  { code: 'WN', name: 'Whole Numbers', strand: 'NA' },
  { code: 'MO', name: 'Money', strand: 'NA' },
  { code: 'FR', name: 'Fractions', strand: 'NA' },
  { code: 'DE', name: 'Decimals', strand: 'NA' },
  { code: 'PC', name: 'Percentage', strand: 'NA' },
  { code: 'RT', name: 'Rate', strand: 'NA' },
  { code: 'RA', name: 'Ratio', strand: 'NA' },
  { code: 'AL', name: 'Algebra', strand: 'NA' },
  { code: 'ME', name: 'Measurement', strand: 'MG' },
  { code: 'AV', name: 'Area and Volume', strand: 'MG' },
  { code: 'GE', name: 'Geometry', strand: 'MG' },
  { code: 'DR', name: 'Data Representation and Interpretation', strand: 'ST' },
  { code: 'DA', name: 'Data Analysis', strand: 'ST' },
];
const SS = Object.fromEntries(SUB_STRANDS.map((s) => [s.code, s]));
const STRAND_NAME = Object.fromEntries(STRANDS.map((s) => [s.code, s.name]));
const TOPIC_ID = new RegExp(`^(P[1-6])\\.(${SUB_STRANDS.map((s) => s.code).join('|')})\\.([1-9]\\d*)$`);

const errors = [];
const err = (m) => errors.push(m);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => typeof v === 'string' && v.trim() !== '';
// Mirrors additionalProperties: false in schema/*.schema.json, so a typo such as "item" is caught.
const checkKeys = (obj, allowed, label) => {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) err(`${label}: unknown key "${k}"`);
};

function load(name) {
  const path = join(DATA, name);
  let text, json;
  try { text = readFileSync(path, 'utf8'); } catch (e) { fail(`${name}: cannot read ${path} (${e.code ?? e.message})`); }
  try { json = JSON.parse(text); } catch (e) { fail(`${name}: invalid JSON — ${e.message}`); }
  if (!isObj(json)) fail(`${name}: top level must be an object`);
  return { json, text };
}

const topicsFile = load('topics.json');
const depsFile = load('dependencies.json');
const list = (file, key) => {
  if (Array.isArray(file.json[key])) return file.json[key];
  err(`${key}: must be an array`);
  return [];
};
const topics = list(topicsFile, 'topics');
const deps = list(depsFile, 'dependencies');

// ---- file headers ----
const SOURCE_KEYS = ['title', 'publisher', 'edition', 'url', 'section', 'copyright'];
const SOURCE_REQUIRED = ['title', 'publisher', 'edition', 'url'];
checkKeys(topicsFile.json, ['version', 'source', 'topicCount', 'topics'], 'topics.json');
checkKeys(depsFile.json, ['version', 'note', 'edgeCount', 'dependencies'], 'dependencies.json');
if (!str(topicsFile.json.version)) err('topics.json: version must be a non-empty string');
if (depsFile.json.version !== topicsFile.json.version)
  err(`dependencies.json: version "${depsFile.json.version}" should match topics.json "${topicsFile.json.version}"`);
if (depsFile.json.note !== undefined && !str(depsFile.json.note)) err('dependencies.json: note must be a non-empty string');
const source = topicsFile.json.source;
if (!isObj(source)) err('topics.json: source must be an object');
else {
  checkKeys(source, SOURCE_KEYS, 'topics.json source');
  for (const k of SOURCE_KEYS)
    if ((SOURCE_REQUIRED.includes(k) || source[k] !== undefined) && !str(source[k])) err(`topics.json: source.${k} must be a non-empty string`);
  if (str(source.url) && !source.url.startsWith('https://')) err('topics.json: source.url must start with https://');
}

// ---- topics ----
const byId = new Map();
const outcomeIds = new Set();
for (const [ti, t] of topics.entries()) {
  if (!isObj(t)) { err(`topics[${ti}]: must be an object`); continue; }
  const m = typeof t.id === 'string' && TOPIC_ID.exec(t.id);
  if (!m) { err(`topic id "${t.id}" does not match <P1-6>.<SubStrand>.<n>`); continue; }
  if (byId.has(t.id)) err(`duplicate topic id ${t.id}`);
  byId.set(t.id, t);
  checkKeys(t, ['id', 'level', 'strand', 'subStrand', 'name', 'sourcePage', 'outcomes'], t.id);
  const [, level, code] = m;
  const ss = SS[code];
  if (t.level !== level) err(`${t.id}: level "${t.level}" should be "${level}"`);
  if (t.subStrand !== ss.name) err(`${t.id}: subStrand "${t.subStrand}" should be "${ss.name}"`);
  if (t.strand !== STRAND_NAME[ss.strand]) err(`${t.id}: strand "${t.strand}" should be "${STRAND_NAME[ss.strand]}"`);
  if (!str(t.name)) err(`${t.id}: missing name`);
  if (!Number.isInteger(t.sourcePage)) err(`${t.id}: sourcePage must be an integer`);
  if (!Array.isArray(t.outcomes) || t.outcomes.length === 0) { err(`${t.id}: needs at least one outcome`); continue; }
  t.outcomes.forEach((o, i) => {
    const expected = `${t.id}.${i + 1}`;
    if (!isObj(o)) { err(`${expected}: must be an object`); return; }
    if (o.id !== expected) err(`${t.id}: outcome "${o.id}" should be "${expected}" (sequential, prefixed by topic id)`);
    if (outcomeIds.has(o.id)) err(`duplicate outcome id ${o.id}`);
    outcomeIds.add(o.id);
    checkKeys(o, ['id', 'text', 'items', 'note'], expected);
    if (!str(o.text)) err(`${expected}: missing text`);
    if (o.items !== undefined && (!Array.isArray(o.items) || !o.items.length || !o.items.every(str)))
      err(`${expected}: items must be a non-empty list of non-empty strings`);
    if (o.note !== undefined && !str(o.note)) err(`${expected}: note must be a non-empty string`);
  });
}
if (topicsFile.json.topicCount !== topics.length)
  err(`topics.json: topicCount is ${topicsFile.json.topicCount} but there are ${topics.length} topics`);

// ---- dependencies ----
const levelIndex = (id) => LEVELS.indexOf(id.slice(0, 2)); // ids are validated, so the prefix is the level
const prereqs = new Map([...byId.keys()].map((id) => [id, []]));
const seen = new Set();
for (const [di, d] of deps.entries()) {
  if (!isObj(d)) { err(`dependencies[${di}]: must be an object`); continue; }
  const label = `${d.prerequisiteId} → ${d.topicId}`;
  checkKeys(d, ['topicId', 'prerequisiteId', 'strength', 'reason'], `edge ${label}`);
  if (!byId.has(d.topicId)) { err(`edge ${label}: unknown topicId ${d.topicId}`); continue; }
  if (!byId.has(d.prerequisiteId)) { err(`edge ${label}: unknown prerequisiteId ${d.prerequisiteId}`); continue; }
  if (d.topicId === d.prerequisiteId) { err(`edge ${label}: self-loop`); continue; }
  if (seen.has(label)) err(`edge ${label}: duplicate`);
  seen.add(label);
  if (d.strength !== 'hard') err(`edge ${label}: strength must be "hard" (soft links are not supported in v1)`);
  if (!str(d.reason)) err(`edge ${label}: missing reason`);
  if (levelIndex(d.prerequisiteId) > levelIndex(d.topicId)) err(`edge ${label}: prerequisite is at a later level`);
  prereqs.get(d.topicId).push(d.prerequisiteId);
}
if (depsFile.json.edgeCount !== deps.length)
  err(`dependencies.json: edgeCount is ${depsFile.json.edgeCount} but there are ${deps.length} edges`);

// ---- cycles (Kahn) + ancestor sets ----
const order = [];
if (!errors.length) {
  const indeg = new Map(topics.map((t) => [t.id, prereqs.get(t.id).length]));
  const unlocks = new Map(topics.map((t) => [t.id, []]));
  for (const [t, ps] of prereqs) for (const p of ps) unlocks.get(p).push(t);
  const queue = topics.filter((t) => indeg.get(t.id) === 0).map((t) => t.id);
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const n of unlocks.get(id)) { indeg.set(n, indeg.get(n) - 1); if (indeg.get(n) === 0) queue.push(n); }
  }
  if (order.length !== topics.length) {
    // Peel off stuck topics that merely sit downstream of a cycle; what remains is on (or between) cycles.
    const core = new Set(topics.map((t) => t.id).filter((id) => !order.includes(id)));
    for (let changed = true; changed;) {
      changed = false;
      for (const id of core) if (!unlocks.get(id).some((n) => core.has(n))) { core.delete(id); changed = true; }
    }
    err(`cycle detected among: ${[...core].join(', ')}`);
  }
}

if (!errors.length) {
  const anc = new Map();
  for (const id of order) {
    const s = new Set();
    for (const p of prereqs.get(id)) { s.add(p); for (const a of anc.get(p)) s.add(a); }
    anc.set(id, s);
  }
  for (const [t, ps] of prereqs)
    for (const p of ps) {
      const via = ps.find((q) => q !== p && anc.get(q).has(p));
      if (via) err(`redundant edge ${p} → ${t} (already implied via ${via}); links must be direct`);
    }
}

// ---- report ----
if (errors.length) {
  for (const e of errors) console.error(`✗ ${e}`);
  console.error(`\n${errors.length} error(s). Nothing written.`);
  process.exit(1);
}

const entryPoints = topics.filter((t) => prereqs.get(t.id).length === 0).map((t) => t.id);
const byLevel = Object.fromEntries(LEVELS.map((l) => {
  const ts = topics.filter((t) => t.level === l);
  return [l, { topics: ts.length, outcomes: ts.reduce((n, t) => n + t.outcomes.length, 0) }];
}));
const byStrand = Object.fromEntries(STRANDS.map((s) => [s.name, topics.filter((t) => t.strand === s.name).length]));

console.log('level  topics  outcomes');
for (const l of LEVELS) console.log(`${l.padEnd(6)} ${String(byLevel[l].topics).padStart(6)}  ${String(byLevel[l].outcomes).padStart(8)}`);
console.log(`total  ${String(topics.length).padStart(6)}  ${String(outcomeIds.size).padStart(8)}`);
console.log(`\n${deps.length} prerequisite edges, 0 cycles, 0 redundant`);
console.log(`entry points (no prerequisites): ${entryPoints.join(', ')}`);

// ---- outputs ----
const sha = (s) => createHash('sha256').update(s).digest('hex');
const manifest = {
  dataset: 'SG MOE Primary Mathematics Knowledge Graph',
  version: topicsFile.json.version,
  syllabus: topicsFile.json.source,
  counts: {
    topics: topics.length,
    outcomes: outcomeIds.size,
    dependencies: deps.length,
    entryPoints: entryPoints.length,
    byLevel,
    byStrand,
  },
  codes: { levels: LEVELS, strands: STRANDS, subStrands: SUB_STRANDS },
  files: Object.fromEntries([['topics.json', topicsFile.text], ['dependencies.json', depsFile.text]]
    .map(([n, t]) => [n, { bytes: Buffer.byteLength(t), sha256: sha(t) }])),
};
const bundle = {
  version: topicsFile.json.version,
  source: topicsFile.json.source,
  codes: manifest.codes,
  topics,
  dependencies: deps,
};
const outputs = [
  [join(DATA, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n'],
  [join(VIEWER, 'data.js'), `// Generated by scripts/build.mjs — do not edit.\nwindow.TAXONOMY = ${JSON.stringify(bundle)};\n`],
];

if (CHECK_ONLY) {
  const stale = outputs.filter(([path, text]) => !existsSync(path) || readFileSync(path, 'utf8') !== text);
  for (const [path] of stale) console.error(`✗ ${path} is out of date. Run node scripts/build.mjs`);
  process.exit(stale.length ? 1 : 0);
}
mkdirSync(VIEWER, { recursive: true });
for (const [path, text] of outputs) writeFileSync(path, text);
console.log(`\n${outputs.map(([path]) => `wrote ${path}`).join('\n')}`);
