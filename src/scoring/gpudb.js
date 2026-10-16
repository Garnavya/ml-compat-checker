const db = require('../../data/gpus.json');

// Reduce "NVIDIA GeForce RTX 4060 Laptop GPU" to "rtx 4060 laptop" so detected
// names and database aliases compare equal.
function normalizeName(s = '') {
  return s
    .toLowerCase()
    .replace(/[®™]|\((r|tm)\)/g, ' ')
    .replace(/with max-q design|max-q/g, ' ')
    .replace(/\b(nvidia|geforce|amd|intel|corporation|graphics|gpu)\b/g, ' ')
    .replace(/[^a-z0-9. ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const trustsDetectedVram = (gpu) => gpu.vendor === 'nvidia';

function findGpu(gpu, entries = db.gpus) {
  const name = normalizeName(gpu.model);
  const hits = entries.filter(
    (e) =>
      e.aliases.includes(name) &&
      (!trustsDetectedVram(gpu) || gpu.vram_gb == null || Math.round(gpu.vram_gb) === e.vram_gb)
  );
  return hits.length === 1 ? hits[0] : null; // ambiguous or unknown means no match
}

function enrichSpec(spec) {
  const gpus = (spec.gpus || []).map((g) => {
    const e = findGpu(g);
    if (!e) return { ...g, db_match: null };
    const useDetected = trustsDetectedVram(g) && g.vram_gb != null;
    return {
      ...g,
      db_match: e.id,
      vram_gb: useDetected ? g.vram_gb : e.vram_gb,
      vram_source: useDetected ? 'detected' : 'database',
      compute_capability: g.compute_capability ?? e.compute_capability ?? null,
      mem_bandwidth_gbs: Math.round((e.bus_bits * e.mem_gbps) / 8),
      mem_type: e.mem_type,
      architecture: e.architecture,
    };
  });
  return { ...spec, gpus };
}

module.exports = { normalizeName, findGpu, enrichSpec };