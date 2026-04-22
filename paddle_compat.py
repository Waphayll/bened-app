import importlib
import importlib.util
import os
import sys
import types


os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
os.environ.setdefault("PADDLE_PDX_MODEL_SOURCE", "huggingface")

# Force CPU-only mode — prevents CUDA illegal-memory-access crashes (error 700)
# when the GPU driver is in a bad state or the device is not fully supported.
os.environ["CUDA_VISIBLE_DEVICES"] = ""           # hide all GPUs from CUDA
os.environ["FLAGS_use_cuda"] = "0"                # Paddle internal flag
os.environ.setdefault("PADDLE_OCR_USE_GPU", "0")  # PaddleOCR convenience flag

_MODELSCOPE_STUB_REASON = None


def _build_modelscope_stub(reason: str) -> types.ModuleType:
    module = types.ModuleType("modelscope")
    module.__dict__["__codex_stub__"] = True

    def snapshot_download(*args, **kwargs):
        raise RuntimeError(
            "ModelScope downloads are disabled in this environment because "
            f"importing 'modelscope' failed: {reason}. "
            "Use the default HuggingFace model source or repair the Torch/NCCL install."
        )

    module.snapshot_download = snapshot_download
    return module


def ensure_modelscope_compat():
    global _MODELSCOPE_STUB_REASON

    loaded = sys.modules.get("modelscope")
    if loaded is not None:
        return loaded

    spec = importlib.util.find_spec("modelscope")
    if spec is None:
        _MODELSCOPE_STUB_REASON = "optional package 'modelscope' is not installed"
        stub = _build_modelscope_stub(_MODELSCOPE_STUB_REASON)
        sys.modules["modelscope"] = stub
        return stub

    try:
        return importlib.import_module("modelscope")
    except Exception as exc:
        sys.modules.pop("modelscope", None)
        _MODELSCOPE_STUB_REASON = f"{type(exc).__name__}: {exc}"
        stub = _build_modelscope_stub(_MODELSCOPE_STUB_REASON)
        sys.modules["modelscope"] = stub
        return stub


def load_paddleocr_class():
    ensure_modelscope_compat()
    from paddleocr import PaddleOCR

    return PaddleOCR


def get_modelscope_stub_reason():
    return _MODELSCOPE_STUB_REASON