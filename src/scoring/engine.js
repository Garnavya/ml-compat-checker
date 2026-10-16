const profiles = require('./profiles');
const { enrichSpec } = require('./gpudb');

const RATINGS = ['not_recommended', 'limited', 'good'];
const RESERVE_GB = 1; // VRAM kept free for the OS/display
const OVERHEAD = 1.2; // runtime + KV cache overhead on top of raw weights
const QLORA_ACTIVATION_GB = 3; // activations, LoRA weights, optimizer state

const worst = (a, b) => (RATINGS.indexOf(b) < RATINGS.indexOf(a) ? b : a);
const rate = (value, t) => (value >= t.good ? 'good' : value >= t.limited ? 'limited' : 'not_recommended');
const r1 = (n) => Math.round(n * 10) / 10;

function pickGpu(spec) {
  const discrete = (spec.gpus || []).filter((g) => !g.is_integrated && g.vram_gb);
  discrete.sort((a, b) => b.vram_gb - a.vram_gb);
  return discrete[0] || null;
}

function softwareCheck(spec, gpu, mode = 'pytorch') {
  const sw = spec.software || {};
  if (gpu.vendor !== 'nvidia') {
    return {
      status: 'unknown',
      note: 'Non-NVIDIA GPU: ML framework support depends on OS and driver (ROCm, DirectML, oneAPI), so this verdict covers hardware only.',
    };
  }
  if (mode === 'driver') {
    return gpu.driver
      ? { status: 'ready', note: 'NVIDIA driver detected. llama.cpp-based tools (Ollama, LM Studio) need only the driver, not PyTorch.' }
      : { status: 'unknown', note: 'The NVIDIA driver version could not be read.' };
  }
  if (!sw.python) return { status: 'unknown', note: 'Python or PyTorch could not be checked on this machine.' };
  if (!sw.torch_installed) return { status: 'needs_setup', note: 'PyTorch is not installed. Install a CUDA build to use this GPU.' };
  if (!sw.torch_cuda) return { status: 'needs_fix', note: `PyTorch ${sw.torch} is a CPU-only build and will not use the GPU.` };
  if (sw.torch_cuda_available === false) {
    return { status: 'needs_fix', note: 'PyTorch has CUDA support but cannot see the GPU. Check the NVIDIA driver.' };
  }
  if (gpu.compute_capability && Array.isArray(sw.torch_arch_list)) {
    const arch = `sm_${gpu.compute_capability.replace('.', '')}`;
    if (!sw.torch_arch_list.includes(arch)) {
      return { status: 'needs_fix', note: `This PyTorch build does not list ${arch}, which your GPU needs. Install a newer build.` };
    }
  }
  return { status: 'ready', note: `PyTorch ${sw.torch} detects the GPU and supports its architecture.` };
}

// Each evaluator returns { verdict, bottleneck, estimate, reasons }
const evaluators = {
  cpu_ram(spec, p) {
    const ramGb = Math.round(spec.ram?.total_gb ?? 0);
    const threads = spec.cpu?.threads ?? 0;
    const ramR = rate(ramGb, p.ram_gb);
    const cpuR = rate(threads, p.threads);
    const verdict = worst(ramR, cpuR);
        const bottleneck =
      verdict === 'good'
        ? null
        : ramR === cpuR
        ? 'RAM and CPU threads'
        : RATINGS.indexOf(ramR) < RATINGS.indexOf(cpuR)
        ? 'RAM'
        : 'CPU threads';
    return {
      verdict,
      bottleneck,
      estimate: `datasets up to ~${r1((ramGb * 0.6) / 3)} GB in memory (rough)`,
      reasons: [`${ramGb} GB RAM and ${threads} threads. The GPU is optional for this task.`],
    };
  },

  vram(spec, p, gpu) {
    if (!gpu) return noGpu();
    const verdict = rate(gpu.vram_gb, p.vram_gb);
    return {
      verdict,
      bottleneck: verdict === 'good' ? null : 'GPU memory (VRAM)',
      estimate: null,
      reasons: [`${gpu.vram_gb} GB VRAM (good from ${p.vram_gb.good} GB, limited from ${p.vram_gb.limited} GB).`],
    };
  },

    llm_inference(spec, p, gpu) {
    if (!gpu) {
      const ramGb = Math.round(spec.ram?.total_gb ?? 0);
      return {
        verdict: ramGb >= 16 ? 'limited' : 'not_recommended',
        bottleneck: 'No discrete GPU (CPU-only will be slow)',
        estimate: null,
        speed_estimate: null,
        reasons: [`CPU-only inference works for small models but is slow. ${ramGb} GB RAM.`],
      };
    }
    const usable = Math.max(0, gpu.vram_gb - RESERVE_GB);
    const max4 = usable / (0.5 * OVERHEAD);
    const max16 = usable / (2 * OVERHEAD);
    const verdict = rate(max4, { good: p.good_params_b, limited: p.limited_params_b });

    let speed = null;
    const refB = Math.min(8, Math.floor(max4));
    if (gpu.mem_bandwidth_gbs && refB >= 1) {
      const gbPerToken = refB * 0.6; // ~4.8 bits per weight for a typical 4-bit quant
      const top = gpu.mem_bandwidth_gbs / gbPerToken;
      speed = `~${Math.round(top * 0.5)}-${Math.round(top * 0.7)} tokens/s for ${refB}B-class 4-bit models (rough; real speed depends on software and power limits)`;
    }

    return {
      verdict,
      bottleneck: verdict === 'good' ? null : 'GPU memory (VRAM)',
      estimate: `up to ~${r1(max4)}B parameters at 4-bit, or ~${r1(max16)}B at FP16 (estimate)`,
      speed_estimate: speed,
      reasons: [`${gpu.vram_gb} GB VRAM minus ${RESERVE_GB} GB reserved leaves ${usable} GB for the model.`],
    };
  },

    llm_qlora(spec, p, gpu) {
    if (!gpu) return noGpu();
    const usable = Math.max(0, gpu.vram_gb - RESERVE_GB - QLORA_ACTIVATION_GB);
    const max = usable / (0.5 * OVERHEAD);
    let verdict = rate(max, { good: p.good_params_b, limited: p.limited_params_b });
    const reasons = [
      `${gpu.vram_gb} GB VRAM minus ${RESERVE_GB} GB reserved and ~${QLORA_ACTIVATION_GB} GB for activations and optimizer state.`,
    ];
    const ramGb = Math.round(spec.ram?.total_gb ?? 0);
    if (ramGb < 16) {
      verdict = worst(verdict, 'limited');
      reasons.push(`Only ${ramGb} GB system RAM; 16 GB or more is recommended when loading models.`);
    }
    const shortContextNote =
      max < p.good_params_b && max >= 5 ? '; 7B only with short context and small batches' : '';
    return {
      verdict,
      bottleneck: verdict === 'good' ? null : ramGb < 16 ? 'RAM' : 'GPU memory (VRAM)',
      estimate: `QLoRA on models up to ~${r1(max)}B parameters${shortContextNote} (estimate)`,
      reasons,
    };
  },

  image_gen(spec, p, gpu) {
    if (!gpu) return noGpu();
    const verdict = rate(gpu.vram_gb, p.vram_gb);
    const detail =
      gpu.vram_gb >= p.vram_gb.good
        ? 'SDXL runs comfortably and quantized Flux is workable.'
        : gpu.vram_gb >= 6
        ? 'SD 1.5 runs comfortably; SDXL works with memory optimizations; Flux needs heavy quantization and is slow.'
        : 'SD 1.5 works with memory optimizations; SDXL and Flux are unrealistic.';
    return {
      verdict,
      bottleneck: verdict === 'good' ? null : 'GPU memory (VRAM)',
      estimate: null,
      reasons: [`${gpu.vram_gb} GB VRAM. ${detail}`],
    };
  },
};

function noGpu() {
  return { verdict: 'not_recommended', bottleneck: 'No discrete GPU', estimate: null, reasons: ['No discrete GPU with known VRAM was detected.'] };
}

function evaluate(spec, profile) {
  const gpu = pickGpu(spec);
  const out = evaluators[profile.kind](spec, profile, gpu);

    if (!Array.isArray(out.reasons)) {
    throw new Error(`Evaluator "${profile.kind}" (profile ${profile.id}) returned no reasons array`);
  }

  if (profile.min_free_disk_gb) {
    const free = Math.max(0, ...(spec.volumes || []).map((v) => v.free_gb ?? 0));
    if (free < profile.min_free_disk_gb) {
      if (out.verdict === 'good') out.bottleneck = 'Disk space';
      out.verdict = worst(out.verdict, 'limited');
      out.reasons.push(`Only ${free} GB free disk; this task wants ${profile.min_free_disk_gb} GB or more.`);
      if (gpu && gpu.vram_source === 'database' && profile.kind !== 'cpu_ram') {
      out.reasons.push('VRAM comes from the GPU database because it could not be read reliably from the system.');
  }
    }
  }

    let software_status = null;
  if (gpu && profile.software) {
    const sw = softwareCheck(spec, gpu, profile.software);
    software_status = sw.status;
    out.reasons.push(sw.note);
  }

  return { id: profile.id, name: profile.name, ...out, software_status };
}

function systemNotes(spec) {
  const notes = [];
  const gpu = pickGpu(spec);
  if (spec.system?.virtualized || spec.system?.wsl) {
    notes.push('Running in a VM or WSL: the hardware view may be incomplete or virtualized.');
  }
  if (spec.system?.form_factor === 'laptop' && gpu) {
    const max = gpu.power_max_w ? ` (maximum reported power: ${gpu.power_max_w} W)` : '';
    notes.push(`Laptop GPU${max}: sustained speed depends on power limits and cooling, so long runs may be slower than short tests.`);
  }
  if (spec.ram?.modules === 1) {
    notes.push('One RAM module detected (likely single-channel). A second matching module usually improves CPU-side speed.');
  }
  if (gpu && !gpu.db_match) {
    notes.push('This GPU is not in the database yet, so speed estimates are unavailable.');
  }
  return notes;
}

function evaluateAll(spec) {
  const enriched = enrichSpec(spec);
  return { tasks: profiles.map((p) => evaluate(enriched, p)), notes: systemNotes(enriched) };
}

module.exports = { evaluate, evaluateAll, pickGpu };