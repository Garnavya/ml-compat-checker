import importlib.util
import json
import sys

result = {"python": sys.version.split()[0], "torch": None}

# find_spec is instant; it avoids importing torch (slow) when it isn't installed
if importlib.util.find_spec("torch") is not None:
    try:
        import torch

        result["torch"] = torch.__version__
        result["torch_cuda"] = torch.version.cuda
        result["cuda_available"] = torch.cuda.is_available()
        result["arch_list"] = torch.cuda.get_arch_list()
    except Exception as e:
        result["torch_error"] = str(e)[:200]

print(json.dumps(result))