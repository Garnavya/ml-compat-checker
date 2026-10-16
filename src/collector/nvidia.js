const { run } = require('./utils');

const num = (s) => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null; // "[N/A]" and "[Not Supported]" become null
};

async function query(fields) {
  const out = await run('nvidia-smi', [
    `--query-gpu=${fields.join(',')}`,
    '--format=csv,noheader,nounits',
  ]);
  if (!out) return null;
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.split(',').map((s) => s.trim()));
}

// The "CUDA Version" in the nvidia-smi banner is the newest CUDA the *driver*
// supports, which is different from the CUDA toolkit installed.
async function getDriverCudaVersion() {
  const out = await run('nvidia-smi');
  const m = out && out.match(/CUDA Version:\s*([\d.]+)/i);
  return m ? m[1] : null;
}

async function getNvidiaGpus() {
  const base = await query(['name', 'memory.total', 'driver_version']);
  if (!base) return [];

  const cc = await query(['compute_cap']);
  const power = await query(['power.limit', 'power.max_limit']);
  const cuda = await getDriverCudaVersion();

  return base.map(([name, vramMb, driver], i) => {
    const vram = num(vramMb);
    return {
      vendor: 'nvidia',
      model: name,
      vram_gb: vram === null ? null : Math.round(vram / 1024),
      driver,
      cuda_driver_version: cuda,
      compute_capability: cc && num(cc[i]?.[0]) !== null ? cc[i][0] : null,
      power_limit_w: power ? num(power[i]?.[0]) : null,
      power_max_w: power ? num(power[i]?.[1]) : null,
      is_integrated: false,
    };
  });
}

module.exports = { getNvidiaGpus };