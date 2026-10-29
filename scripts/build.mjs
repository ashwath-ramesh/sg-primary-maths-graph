#!/usr/bin/env node
// Validate data/*.json, then write data/manifest.json and docs/data.js.
// Zero dependencies. Usage: node scripts/build.mjs [--check] [dataDir]
//   --check  validate only, write nothing
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const CHECK_ONLY = args.includes('--check');
const DATA = resolve(args.find((a) => !a.startsWith('--')) ?? join(ROOT, 'data'));
const VIEWER = join(ROOT, 'docs');

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
const TOPIC_ID = new RegExp(`^(P[1-6])\\.(${SUB_STRANDS.map((s) => s.code).join('|')})\\.(\\d+)$`);

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

function load(name) {
  const path = join(DATA, name);
  const text = readFileSync(path, 'utf8');
  try {
    return { json: JSON.parse(text), text };
  } catch (e) {
    console.error(`✗ ${name}: invalid JSON — ${e.message}`);
    process.exit(1);
  }
}

const topicsFile = load('topics.json');
const depsFile = load('dependencies.json');
const topics = topicsFile.json.topics ?? [];
const deps = depsFile.json.dependencies ?? [];

// ---- topics ----
const byId = new Map();
const outcomeIds = new Set();
for (const t of topics) {
  const m = TOPIC_ID.exec(t.id ?? '');
  if (!m) { err(`topic id "${t.id}" does not match <P1-6>.<SubStrand>.<n>`); continue; }
  if (byId.has(t.id)) err(`duplicate topic id ${t.id}`);
  byId.set(t.id, t);
  const [, level, code] = m;
  const ss = SS[code];
  if (t.level !== level) err(`${t.id}: level "${t.level}" should be "${level}"`);
  if (t.subStrand !== ss.name) err(`${t.id}: subStrand "${t.subStrand}" should be "${ss.name}"`);
  if (t.strand !== STRAND_NAME[ss.strand]) err(`${t.id}: strand "${t.strand}" should be "${STRAND_NAME[ss.strand]}"`);
  if (!t.name?.trim()) err(`${t.id}: missing name`);
  if (!Number.isInteger(t.sourcePage)) err(`${t.id}: sourcePage must be an integer`);
  if (!Array.isArray(t.outcomes) || t.outcomes.length === 0) { err(`${t.id}: needs at least one outcome`); continue; }
  t.outcomes.forEach((o, i) => {
    const expected = `${t.id}.${i + 1}`;
    if (o.id !== expected) err(`${t.id}: outcome "${o.id}" should be "${expected}" (sequential, prefixed by topic id)`);
    if (outcomeIds.has(o.id)) err(`duplicate outcome id ${o.id}`);
    outcomeIds.add(o.id);
    if (!o.text?.trim()) err(`${o.id}: missing text`);
    if (o.items !== undefined && (!Array.isArray(o.items) || o.items.some((x) => typeof x !== 'string' || !x.trim())))
      err(`${o.id}: items must be a list of non-empty strings`);
  });
}
if (topicsFile.json.topicCount !== topics.length)
  err(`topics.json: topicCount is ${topicsFile.json.topicCount} but there are ${topics.length} topics`);

// ---- dependencies ----
const levelIndex = (id) => LEVELS.indexOf(byId.get(id).level);
const prereqs = new Map(topics.map((t) => [t.id, []]));
const seen = new Set();
for (const d of deps) {
  const label = `${d.prerequisiteId} → ${d.topicId}`;
  if (!byId.has(d.topicId)) { err(`edge ${label}: unknown topicId ${d.topicId}`); continue; }
  if (!byId.has(d.prerequisiteId)) { err(`edge ${label}: unknown prerequisiteId ${d.prerequisiteId}`); continue; }
  if (d.topicId === d.prerequisiteId) { err(`edge ${label}: self-loop`); continue; }
  if (seen.has(label)) err(`edge ${label}: duplicate`);
  seen.add(label);
  if (!['hard', 'soft'].includes(d.strength)) err(`edge ${label}: strength must be "hard" or "soft"`);
  if (!d.reason?.trim()) err(`edge ${label}: missing reason`);
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
      if (via) warn(`redundant edge ${p} → ${t} (already implied via ${via})`);
    }
}

// ---- report ----
for (const w of warnings) console.warn(`⚠ ${w}`);
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
console.log(`\n${deps.length} prerequisite edges, 0 cycles, ${warnings.length} warning(s)`);
console.log(`entry points (no prerequisites): ${entryPoints.join(', ')}`);

// ---- write outputs ----
if (CHECK_ONLY) process.exit(0);
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
writeFileSync(join(DATA, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

const bundle = {
  version: topicsFile.json.version,
  source: topicsFile.json.source,
  codes: manifest.codes,
  topics,
  dependencies: deps,
};
mkdirSync(VIEWER, { recursive: true });
writeFileSync(join(VIEWER, 'data.js'),
  `// Generated by scripts/build.mjs — do not edit.\nwindow.TAXONOMY = ${JSON.stringify(bundle)};\n`);
console.log(`\nwrote ${join(DATA, 'manifest.json')}\nwrote ${join(VIEWER, 'data.js')}`);
