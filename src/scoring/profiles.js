module.exports = [
  {
    id: 'classical_ml',
    name: 'Classical ML (scikit-learn, XGBoost)',
    kind: 'cpu_ram',
    ram_gb: { good: 16, limited: 8 },
    threads: { good: 8, limited: 4 },
    
  },
  {
    id: 'dl_training',
    name: 'Deep learning training (CNNs, small transformers)',
    kind: 'vram',
    vram_gb: { good: 8, limited: 4 },
    min_free_disk_gb: 20,
    software: 'pytorch',
  },
  {
    id: 'llm_inference',
    name: 'Local LLM inference (4-bit)',
    kind: 'llm_inference',
    good_params_b: 7,
    limited_params_b: 3,
    min_free_disk_gb: 30,
    software: 'driver',
  },
  {
    id: 'llm_finetune',
    name: 'LLM fine-tuning (QLoRA)',
    kind: 'llm_qlora',
    good_params_b: 7,
    limited_params_b: 3,
    min_free_disk_gb: 50,
    software: 'pytorch',
  },
  {
    id: 'image_gen',
    name: 'Image generation (Stable Diffusion, SDXL, Flux)',
    kind: 'image_gen',
    vram_gb: { good: 12, limited: 4 },
    min_free_disk_gb: 30,
    software: 'pytorch',
  },
];