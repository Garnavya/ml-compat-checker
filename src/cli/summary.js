const fs = require('fs');

const spec = JSON.parse(fs.readFileSync(process.argv[2] || 'spec.json', 'utf8'));
const v = (x) => (x === null || x === undefined ? 'unknown' : x);
const line = (label, text) => console.log(`${label.padEnd(10)} ${text}`);

line(
  'OS',
  `${v(spec.system.os_name)} | ${v(spec.system.form_factor)}${spec.system.wsl ? ' | WSL' : ''}${
    spec.system.virtualized ? ' | virtual machine' : ''
  }`
);
line(
  'CPU',
  `${v(spec.cpu.model)} | ${v(spec.cpu.cores_physical)} cores, ${v(spec.cpu.threads)} threads | AVX2 ${v(
    spec.cpu.avx2
  )}, AVX-512 ${v(spec.cpu.avx512)}`
);
line(
  'RAM',
  `${v(spec.ram.total_gb)} GB ${v(spec.ram.type)} @ ${v(spec.ram.speed_mhz)} MHz | ${v(spec.ram.modules)} module(s)`
);
spec.gpus.forEach((g, i) =>
  line(
    `GPU ${i + 1}`,
    `${v(g.model)} | VRAM ${v(g.vram_gb)} GB | driver ${v(g.driver)} | compute capability ${v(
      g.compute_capability
    )}${g.is_integrated ? ' | integrated' : ''}`
  )
);
spec.volumes.forEach((d) => line('Disk', `${d.mount} ${d.free_gb} GB free of ${d.total_gb} GB`));

const sw = spec.software || {};
line('Python', `${v(sw.python)} at ${v(sw.python_path)}`);
line('PyTorch', `${v(sw.torch)} | CUDA build ${v(sw.torch_cuda)} | GPU visible ${v(sw.torch_cuda_available)}`);
(sw.environments || []).forEach((e, i) =>
  line(`  env ${i + 1}`, `Python ${e.python} at ${e.path} | torch ${v(e.torch)}${e.error ? ` | ERROR ${e.error}` : ''}`)
);
(spec.detection_notes || []).forEach((n) => line('Note', n));