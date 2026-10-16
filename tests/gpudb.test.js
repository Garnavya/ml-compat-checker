const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../data/gpus.json');
const { normalizeName, findGpu, enrichSpec } = require('../src/scoring/gpudb');
const { evaluate } = require('../src/scoring/engine');
const profiles = require('../src/scoring/profiles');

const inference = profiles.find((p) => p.id === 'llm_inference');

test('every entry is complete and its bandwidth is derivable', () => {
  const required = ['id', 'vendor', 'architecture', 'aliases', 'laptop', 'vram_gb', 'mem_type', 'bus_bits', 'mem_gbps', 'source', 'verified'];
  for (const e of db.gpus) {
    for (const k of required) assert.ok(e[k] !== undefined, `${e.id}: missing ${k}`);
    assert.ok(Array.isArray(e.aliases) && e.aliases.length > 0, `${e.id}: aliases`);
    assert.equal(e.bus_bits % 32, 0, `${e.id}: bus width should be a multiple of 32`);
    const bw = (e.bus_bits * e.mem_gbps) / 8;
    assert.ok(bw > 50 && bw < 3000, `${e.id}: implausible bandwidth ${bw}`);
    if (e.vendor === 'nvidia') assert.match(e.compute_capability, /^\d+\.\d$/, `${e.id}: compute capability`);
  }
});

test('no two entries share an alias and VRAM size', () => {
  const seen = new Set();
  for (const e of db.gpus) {
    for (const a of e.aliases) {
      const key = `${a}|${e.vram_gb}`;
      assert.ok(!seen.has(key), `duplicate: ${key}`);
      seen.add(key);
    }
  }
});

test('aliases are already in normalized form', () => {
  for (const e of db.gpus) {
    for (const a of e.aliases) assert.equal(normalizeName(a), a, `${e.id}: alias "${a}" is not normalized`);
  }
});

test('matches the RTX 5050 Laptop as detected on Windows', () => {
  const g = { vendor: 'nvidia', model: 'NVIDIA GeForce RTX 5050 Laptop GPU', vram_gb: 8 };
  assert.equal(findGpu(g).id, 'rtx-5050-laptop-8gb');
});

test('laptop and desktop variants of the same name stay distinct', () => {
  const laptop = { vendor: 'nvidia', model: 'NVIDIA GeForce RTX 4060 Laptop GPU', vram_gb: 8 };
  const desktop = { vendor: 'nvidia', model: 'NVIDIA GeForce RTX 4060', vram_gb: 8 };
  assert.equal(findGpu(laptop).id, 'rtx-4060-laptop-8gb');
  assert.equal(findGpu(desktop).id, 'rtx-4060-8gb');
});

test('NVIDIA VRAM mismatch means no match', () => {
  const g = { vendor: 'nvidia', model: 'NVIDIA GeForce RTX 3060', vram_gb: 8 }; // database only has the 12 GB card
  assert.equal(findGpu(g), null);
});

test('an unknown GPU is not guessed at', () => {
  assert.equal(findGpu({ vendor: 'nvidia', model: 'NVIDIA GeForce RTX 9999', vram_gb: 8 }), null);
});

test('AMD GPU with unreadable VRAM gets it from the database', () => {
  const out = enrichSpec({ gpus: [{ vendor: 'amd', model: 'AMD Radeon RX 7800 XT', vram_gb: null }] });
  assert.equal(out.gpus[0].vram_gb, 16);
  assert.equal(out.gpus[0].vram_source, 'database');
});

test('AMD GPU with a wrongly detected VRAM is corrected', () => {
  const out = enrichSpec({ gpus: [{ vendor: 'amd', model: 'AMD Radeon RX 7800 XT', vram_gb: 4 }] });
  assert.equal(out.gpus[0].vram_gb, 16);
});

const specWith = (gpu) => enrichSpec({
  ram: { total_gb: 15.7 },
  cpu: { threads: 12 },
  gpus: [gpu],
  volumes: [{ free_gb: 163 }],
  software: { python: '3.11.9' },
});

test('speed estimate for the RTX 5050 Laptop', () => {
  const spec = specWith({ vendor: 'nvidia', model: 'NVIDIA GeForce RTX 5050 Laptop GPU', vram_gb: 8, driver: '617.14', is_integrated: false });
  const r = evaluate(spec, inference);
  assert.match(r.speed_estimate, /~40-56 tokens\/s/);
});

test('no speed estimate when the GPU is not in the database', () => {
  const spec = specWith({ vendor: 'nvidia', model: 'NVIDIA GeForce RTX 9999', vram_gb: 8, driver: '1', is_integrated: false });
  assert.equal(evaluate(spec, inference).speed_estimate, null);
});