const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate } = require('../src/scoring/engine');
const profiles = require('../src/scoring/profiles');

const prof = (id) => profiles.find((p) => p.id === id);

// Your laptop as the baseline; each test changes only what it needs.
const base = () => ({
  system: { form_factor: 'laptop', virtualized: false, wsl: false },
  cpu: { threads: 12 },
  ram: { total_gb: 15.7, modules: 1 },
  gpus: [
    { vendor: 'nvidia', model: 'RTX 5050 Laptop', vram_gb: 8, driver: '617.14', compute_capability: '12.0', is_integrated: false },
  ],
  volumes: [{ mount: 'C:', free_gb: 163 }],
  software: {
    python: '3.11.9',
    torch_installed: true,
    torch: '2.11.0+cu128',
    torch_cuda: '12.8',
    torch_cuda_available: true,
    torch_arch_list: ['sm_80', 'sm_120'],
  },
});

test('baseline 8 GB laptop verdicts', () => {
  const s = base();
  assert.equal(evaluate(s, prof('classical_ml')).verdict, 'good'); // 15.7 GB counts as 16
  assert.equal(evaluate(s, prof('dl_training')).verdict, 'good');
  assert.equal(evaluate(s, prof('llm_inference')).verdict, 'good');
  assert.equal(evaluate(s, prof('llm_finetune')).verdict, 'limited');
  assert.equal(evaluate(s, prof('image_gen')).verdict, 'limited');
});

test('24 GB GPU gets good verdicts everywhere', () => {
  const s = base();
  s.gpus[0].vram_gb = 24;
  for (const id of ['dl_training', 'llm_inference', 'llm_finetune', 'image_gen']) {
    assert.equal(evaluate(s, prof(id)).verdict, 'good', id);
  }
});

test('no GPU: GPU tasks fail, CPU tasks still work', () => {
  const s = base();
  s.gpus = [];
  assert.equal(evaluate(s, prof('dl_training')).verdict, 'not_recommended');
  assert.equal(evaluate(s, prof('llm_inference')).verdict, 'limited');
  assert.equal(evaluate(s, prof('classical_ml')).verdict, 'good');
});

test('integrated-only GPU is treated as no GPU', () => {
  const s = base();
  s.gpus = [{ vendor: 'intel', model: 'UHD', vram_gb: null, driver: null, is_integrated: true }];
  assert.equal(evaluate(s, prof('dl_training')).verdict, 'not_recommended');
});

test('CPU-only PyTorch build is flagged without changing the hardware verdict', () => {
  const s = base();
  s.software.torch_cuda = null;
  const r = evaluate(s, prof('dl_training'));
  assert.equal(r.verdict, 'good');
  assert.equal(r.software_status, 'needs_fix');
});

test('PyTorch build missing the GPU architecture is flagged', () => {
  const s = base();
  s.software.torch_arch_list = ['sm_80', 'sm_90'];
  assert.equal(evaluate(s, prof('dl_training')).software_status, 'needs_fix');
});

test('low free disk caps the verdict and names the bottleneck', () => {
  const s = base();
  s.gpus[0].vram_gb = 24;
  s.volumes = [{ mount: 'C:', free_gb: 10 }];
  const r = evaluate(s, prof('image_gen'));
  assert.equal(r.verdict, 'limited');
  assert.equal(r.bottleneck, 'Disk space');
});

test('low RAM is named as the classical ML bottleneck', () => {
  const s = base();
  s.ram.total_gb = 3.7;
  const r = evaluate(s, prof('classical_ml'));
  assert.equal(r.verdict, 'not_recommended');
  assert.equal(r.bottleneck, 'RAM');
});

test('equally weak RAM and CPU are both named', () => {
  const s = base();
  s.ram.total_gb = 3.7;
  s.cpu.threads = 2;
  assert.equal(evaluate(s, prof('classical_ml')).bottleneck, 'RAM and CPU threads');
});

test('LLM inference does not require PyTorch', () => {
  const s = base();
  s.software = { python: '3.11.9', torch_installed: false, torch: null, torch_cuda: null };
  assert.equal(evaluate(s, prof('llm_inference')).software_status, 'ready');
  assert.equal(evaluate(s, prof('dl_training')).software_status, 'needs_setup');
});

test('AMD GPU gets a hardware verdict with unknown software status', () => {
  const s = base();
  s.gpus = [{ vendor: 'amd', model: 'RX 7800 XT', vram_gb: 16, driver: '24.1', compute_capability: null, is_integrated: false }];
  const r = evaluate(s, prof('dl_training'));
  assert.equal(r.verdict, 'good');
  assert.equal(r.software_status, 'unknown');
});

test('every profile returns a verdict and a reasons array', () => {
  const s = base();
  for (const p of profiles) {
    const r = evaluate(s, p);
    assert.ok(['good', 'limited', 'not_recommended'].includes(r.verdict), `${p.id}: verdict`);
    assert.ok(Array.isArray(r.reasons) && r.reasons.length > 0, `${p.id}: reasons`);
  }
});

test('PyTorch found but failing to import is needs_fix, not "not installed"', () => {
  const s = base();
  s.software = { python: '3.11.9', torch_installed: true, torch: null, torch_error: 'DLL load failed while importing _C' };
  const r = evaluate(s, prof('dl_training'));
  assert.equal(r.verdict, 'good');
  assert.equal(r.software_status, 'needs_fix');
  assert.ok(r.reasons.some((x) => /Visual C\+\+/.test(x)));
});

test('PyTorch not found points the user at --python', () => {
  const s = base();
  s.software = { python: '3.13.0', torch_installed: false, environments: [{ python: '3.13.0' }] };
  const r = evaluate(s, prof('dl_training'));
  assert.equal(r.software_status, 'needs_setup');
  assert.ok(r.reasons.some((x) => x.includes('--python')));
});