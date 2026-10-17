const si = require('systeminformation');
const fs = require('fs');
const { getNvidiaGpus } = require('./nvidia');
const { getCpuFeatures } = require('./cpufeatures');
const { getSoftware } = require('./software');

const gb = (bytes) => Math.round((bytes / 1024 ** 3) * 10) / 10;
const stripMarks = (s = '') => s.replace(/[®™]|\((R|TM)\)/gi, '').replace(/\s+/g, ' ').trim();

function cleanCpuName(manufacturer, brand) {
  let name = stripMarks(brand).replace(/^(\d+(st|nd|rd|th)\s+)?Gen\s+/i, '');
  if (manufacturer && !name.toLowerCase().startsWith(manufacturer.toLowerCase())) {
    name = `${manufacturer} ${name}`;
  }
  return name.trim();
}

function normalizeVendor(v = '') {
  if (/nvidia/i.test(v)) return 'nvidia';
  if (/amd|advanced micro/i.test(v)) return 'amd';
  if (/intel/i.test(v)) return 'intel';
  return v.toLowerCase() || null;
}

function detectWsl() {
  if (process.platform !== 'linux') return false;
  try {
    return /microsoft/i.test(fs.readFileSync('/proc/version', 'utf8'));
  } catch {
    return false;
  }
}

async function collect(options = {}) {
  const notes = [];

  const [cpu, mem, memLayout, gfx, disks, fsSizes, sys, chassis, osInfo, features, soft] =
    await Promise.all([
      si.cpu(),
      si.mem(),
      si.memLayout(),
      si.graphics(),
      si.diskLayout(),
      si.fsSize(),
      si.system(),
      si.chassis(),
      si.osInfo(),
      getCpuFeatures(),
      getSoftware(options),
    ]);

  const nvidia = await getNvidiaGpus();
  if (nvidia.length === 0) notes.push('nvidia-smi unavailable or no NVIDIA GPU found');

  const otherGpus = gfx.controllers
    .filter((c) => nvidia.length === 0 || !/nvidia/i.test(c.vendor))
    .map((c) => {
      const integrated = !!c.vramDynamic;
      return {
        vendor: normalizeVendor(c.vendor),
        model: stripMarks(c.model),
        vram_gb: integrated ? null : c.vram ? Math.round(c.vram / 1024) : null,
        driver: c.driverVersion || null,
        compute_capability: null,
        is_integrated: integrated,
      };
    });

  if (features.avx2 === null) notes.push('avx2/avx512 could not be determined');

  const modules = memLayout.filter((m) => m.size);
  if (modules.length === 0) notes.push('RAM type/speed unavailable (may need elevated rights)');
  const ramType = modules[0]?.type;

  const formFactor = /note|lap|portable/i.test(chassis.type || '')
    ? 'laptop'
    : /desk|tower|mini|all in one/i.test(chassis.type || '')
    ? 'desktop'
    : null;

  return {
    schema_version: 1,
    system: {
      os: process.platform === 'win32' ? 'windows' : 'linux',
      os_name: osInfo.distro || null,
      os_version: osInfo.release,
      form_factor: formFactor,
      virtualized: !!sys.virtual,
      wsl: detectWsl(),
    },
    cpu: {
      model: cleanCpuName(cpu.manufacturer, cpu.brand),
      cores_physical: cpu.physicalCores,
      threads: cpu.cores,
      base_ghz: cpu.speed,
      avx2: features.avx2,
      avx512: features.avx512,
    },
    ram: {
      total_gb: gb(mem.total),
      type: ramType && ramType !== 'Unknown' ? ramType : null,
      speed_mhz: modules[0]?.clockSpeed || null,
      modules: modules.length || null, // 1 module usually means single-channel
    },
    gpus: [...nvidia, ...otherGpus],
    storage: disks.map((d) => ({ type: d.type, name: d.name, total_gb: Math.round(gb(d.size)) })),
    volumes: fsSizes.map((v) => ({
      mount: v.mount,
      total_gb: Math.round(gb(v.size)),
      free_gb: Math.round(gb(v.available)),
    })),
    software: soft.software,
    detection_notes: [...notes, ...soft.notes],
  };
}

module.exports = { collect };