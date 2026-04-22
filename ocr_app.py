"""
OCR Studio — Tkinter + OpenCV + PaddleOCR + Fuzzy Matching
==========================================================
Dependencies:
    pip install rapidocr_onnxruntime opencv-python pdf2image Pillow thefuzz python-Levenshtein
    optional: pip install wordfreq   (for built-in English dictionary fuzzy matching)
    apt install poppler-utils  (for pdf2image on Linux)

Usage:
    python3 ocr_app.py
"""

import tkinter as tk
from tkinter import ttk, filedialog, messagebox, scrolledtext
import threading
import io
import os
import re
import shutil
import subprocess
import sys
import time

import cv2
import numpy as np
from PIL import Image, ImageGrab, ImageTk
from pdf2image import convert_from_path

# ── Fuzzy matching ──────────────────────────────────────────────────────────
try:
    from thefuzz import fuzz, process as fuzz_process
    FUZZY_AVAILABLE = True
except ImportError:
    FUZZY_AVAILABLE = False

try:
    from wordfreq import top_n_list
    WORD_FREQ_AVAILABLE = True
except ImportError:
    WORD_FREQ_AVAILABLE = False

ENGLISH_DICT_WORD_LIMIT = 50000
_ENGLISH_WORDS = None
_ENGLISH_WORD_SET = None
_ENGLISH_WORD_BUCKETS = None
FUZZY_TOKEN_OR_SEPARATOR_RE = re.compile(r"[A-Za-z']+|[^A-Za-z']+")

# ── RapidOCR ────────────────────────────────────────────────────────────────
RAPIDOCR_AVAILABLE = False
ocr_engine = None
ocr_load_error = None


def _build_rapidocr_engine():
    from rapidocr_onnxruntime import RapidOCR
    import os
    os.environ.setdefault("OMP_NUM_THREADS", str(min(os.cpu_count() or 4, 8)))
    return RapidOCR()

OCR_DET_LIMIT_SIDE = 960
OCR_TEXT_SCORE = 0.3


class OCREngineUnavailable(RuntimeError):
    """Raised when OCR is requested but RapidOCR is unavailable."""

def load_ocr_engine():
    """Lazy-load RapidOCR in a background thread."""
    global ocr_engine, RAPIDOCR_AVAILABLE, ocr_load_error
    if ocr_engine is not None:
        return ocr_engine
    try:
        ocr_engine = _build_rapidocr_engine()
        RAPIDOCR_AVAILABLE = True
        ocr_load_error = None
    except Exception as e:
        RAPIDOCR_AVAILABLE = False
        ocr_load_error = str(e)
        print(f"[RapidOCR] Could not load: {e}")
    return ocr_engine


def require_ocr_engine():
    engine = load_ocr_engine()
    if not RAPIDOCR_AVAILABLE or engine is None:
        reason = ocr_load_error or "RapidOCR could not be initialized."
        raise OCREngineUnavailable(f"OCR engine unavailable: {reason}")
    return engine


# ═══════════════════════════════════════════════════════════════════════════
#  IMAGE PROCESSING HELPERS
# ═══════════════════════════════════════════════════════════════════════════

def deskew(image: np.ndarray, angle: float) -> np.ndarray:
    """Rotate image by `angle` degrees around its centre."""
    if abs(angle) < 0.01:
        return image
    h, w = image.shape[:2]
    cx, cy = w // 2, h // 2
    M = cv2.getRotationMatrix2D((cx, cy), angle, 1.0)
    cos, sin = abs(M[0, 0]), abs(M[0, 1])
    nw = int(h * sin + w * cos)
    nh = int(h * cos + w * sin)
    M[0, 2] += (nw / 2) - cx
    M[1, 2] += (nh / 2) - cy
    return cv2.warpAffine(image, M, (nw, nh),
                          flags=cv2.INTER_LINEAR,
                          borderMode=cv2.BORDER_REPLICATE)

def auto_deskew_angle(image: np.ndarray) -> float:
    """Estimate document skew using multiple cues and projection-profile search."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image.copy()
    if gray.size == 0:
        return 0.0

    h, w = gray.shape[:2]
    max_side = max(h, w)
    scale = min(1.0, 1400.0 / max(1, max_side))
    if scale < 1.0:
        gray = cv2.resize(
            gray,
            (max(1, int(round(w * scale))), max(1, int(round(h * scale)))),
            interpolation=cv2.INTER_AREA,
        )

    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    if cv2.countNonZero(binary) < max(50, binary.size // 500):
        return 0.0

    def normalize_angle(angle: float) -> float:
        while angle <= -45:
            angle += 90
        while angle > 45:
            angle -= 90
        return angle

    def rotate_mask(mask: np.ndarray, angle: float) -> np.ndarray:
        hh, ww = mask.shape[:2]
        center = (ww / 2.0, hh / 2.0)
        M = cv2.getRotationMatrix2D(center, angle, 1.0)
        return cv2.warpAffine(
            mask,
            M,
            (ww, hh),
            flags=cv2.INTER_NEAREST,
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=0,
        )

    def projection_score(angle: float) -> float:
        rotated = rotate_mask(binary, angle)
        horizontal = rotated.sum(axis=1).astype(np.float32)
        if horizontal.size < 3:
            return float("-inf")
        diff = np.diff(horizontal)
        energy = float(np.mean(diff * diff))
        banding = float(np.std(horizontal))
        fill_ratio = cv2.countNonZero(rotated) / max(1, rotated.size)
        if fill_ratio <= 0:
            return float("-inf")
        return (banding * 0.7 + energy * 0.3) / fill_ratio

    candidates = {0.0}

    coords = cv2.findNonZero(binary)
    if coords is not None and len(coords) >= 20:
        rect_angle = cv2.minAreaRect(coords)[-1]
        if rect_angle < -45:
            rect_angle += 90
        if rect_angle > 45:
            rect_angle -= 90
        candidates.add(normalize_angle(rect_angle))

    edges = cv2.Canny(binary, 50, 150)
    lines = cv2.HoughLinesP(
        edges,
        1,
        np.pi / 180,
        threshold=max(60, binary.shape[1] // 8),
        minLineLength=max(40, binary.shape[1] // 6),
        maxLineGap=max(8, binary.shape[1] // 60),
    )
    if lines is not None:
        line_angles = []
        for line in lines:
            x1, y1, x2, y2 = line[0]
            dx = x2 - x1
            dy = y2 - y1
            if dx == 0 and dy == 0:
                continue
            angle = normalize_angle(np.degrees(np.arctan2(dy, dx)))
            if -30 <= angle <= 30:
                line_angles.append(angle)
        if line_angles:
            candidates.add(float(np.median(line_angles)))
            candidates.add(float(np.mean(line_angles)))

    coarse_angles = sorted(
        {
            normalize_angle(candidate + offset)
            for candidate in candidates
            for offset in np.arange(-4.0, 4.01, 1.0)
        }
        | {float(angle) for angle in np.arange(-15.0, 15.01, 1.5)}
    )
    coarse_best = max(coarse_angles, key=projection_score)

    fine_angles = [
        normalize_angle(coarse_best + offset)
        for offset in np.arange(-1.2, 1.201, 0.15)
    ]
    best_angle = max(fine_angles, key=projection_score)
    return float(round(normalize_angle(best_angle), 2))

def apply_preprocessing(
    image: np.ndarray,
    angle: float,
    brightness: int,
    contrast: float,
    blur: int,
    denoise: bool,
    sharpen: bool,
    binarise: bool,
    adaptive: bool,
    morph_open: bool,
    morph_close: bool,
) -> np.ndarray:
    """Apply the full preprocessing pipeline."""
    img = deskew(image, angle)

    # Brightness / contrast
    img = cv2.convertScaleAbs(img, alpha=contrast, beta=brightness)

    # Denoise
    if denoise:
        img = cv2.fastNlMeansDenoisingColored(img, None, 10, 10, 7, 21) \
              if len(img.shape) == 3 else \
              cv2.fastNlMeansDenoising(img, None, 10, 7, 21)

    # Blur
    if blur > 0:
        k = blur * 2 + 1
        img = cv2.GaussianBlur(img, (k, k), 0)

    # Sharpen
    if sharpen:
        kernel = np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]])
        img = cv2.filter2D(img, -1, kernel)

    # Binarise
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img
    if adaptive:
        binary = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                        cv2.THRESH_BINARY, 11, 2)
        img = cv2.cvtColor(binary, cv2.COLOR_GRAY2BGR)
    elif binarise:
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        img = cv2.cvtColor(binary, cv2.COLOR_GRAY2BGR)

    # Morphology
    kernel_m = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    if morph_open:
        img = cv2.morphologyEx(img, cv2.MORPH_OPEN, kernel_m)
    if morph_close:
        img = cv2.morphologyEx(img, cv2.MORPH_CLOSE, kernel_m)

    return img


def cv2_to_photoimage(
    img: np.ndarray,
    width: int | None = None,
    height: int | None = None,
) -> ImageTk.PhotoImage:
    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    pil = Image.fromarray(rgb)
    if width is not None and height is not None:
        pil = pil.resize((max(1, width), max(1, height)), Image.LANCZOS)
    return ImageTk.PhotoImage(pil)


def _decode_clipboard_image(data: bytes) -> Image.Image:
    image = Image.open(io.BytesIO(data))
    image.load()
    return image


def _grab_clipboard_payload():
    if not sys.platform.startswith("linux"):
        return ImageGrab.grabclipboard(), "ImageGrab"

    silent_errors = [
        b"Nothing is copied",
        b"No selection",
        b"No suitable type of content copied",
        b" not available",
        b"cannot convert ",
        b"xclip: Error: There is no owner for the ",
    ]
    errors = []
    backends = []
    saw_non_image_clipboard = False

    if shutil.which("wl-paste"):
        backends.append(("wl-paste", ["wl-paste", "-t", "image"]))
    if shutil.which("xclip") and os.getenv("DISPLAY"):
        backends.append(("xclip", ["xclip", "-selection", "clipboard", "-t", "image/png", "-o"]))

    for backend_name, args in backends:
        proc = subprocess.run(args, capture_output=True)
        if proc.returncode != 0:
            err = proc.stderr or b""
            if any(token in err for token in silent_errors):
                saw_non_image_clipboard = True
                continue
            message = err.strip().decode(errors="replace") if err else "unknown error"
            errors.append(f"{backend_name}: {message}")
            continue
        try:
            return _decode_clipboard_image(proc.stdout), backend_name
        except Exception as exc:
            errors.append(f"{backend_name}: {exc}")

    try:
        return ImageGrab.grabclipboard(), "ImageGrab"
    except Exception as exc:
        if saw_non_image_clipboard:
            return None, None
        errors.append(str(exc))

    if saw_non_image_clipboard:
        return None, None
    if errors:
        raise RuntimeError("Clipboard image lookup failed. " + " | ".join(errors))
    return None, None


# ═══════════════════════════════════════════════════════════════════════════
#  OCR HELPERS
# ═══════════════════════════════════════════════════════════════════════════

def run_rapidocr(image: np.ndarray) -> list[dict]:
    """Run RapidOCR; return list of {text, conf, bbox}."""
    engine = require_ocr_engine()
    
    # RapidOCR works well with BGR which is cv2 default
    bgr = image
    if bgr.dtype != np.uint8:
        bgr = np.clip(bgr, 0, 255).astype(np.uint8)

    try:
        result, _ = engine(
            bgr,
            det_limit_side_len=OCR_DET_LIMIT_SIDE,
            text_score=OCR_TEXT_SCORE,
        )
    except Exception as exc:
        raise exc

    if not result:
        return []

    items = []
    for dt_box, rec_text, score in result:
        text = str(rec_text or "").strip()
        if not text:
            continue
        try:
            bbox = [[int(round(pt[0])), int(round(pt[1]))] for pt in dt_box]
        except Exception:
            continue
        try:
            conf = float(score or 0.0)
        except Exception:
            conf = 0.0
        if conf > 1.0:
            conf = conf / 100.0
        conf = max(0.0, min(1.0, conf))
        items.append({"text": text, "conf": conf, "bbox": bbox})
    return items

def detect_lines_ocr(image: np.ndarray) -> list[dict]:
    """Segment image into text-line regions first, then OCR each."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image.copy()
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    # Horizontal dilation to merge words into lines
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (40, 1))
    dilated = cv2.dilate(binary, kernel, iterations=2)
    contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    # Sort contours top-to-bottom
    contours = sorted(contours, key=lambda c: cv2.boundingRect(c)[1])
    items = []
    for cnt in contours:
        x, y, w, h = cv2.boundingRect(cnt)
        if w < 20 or h < 5:
            continue
        pad = 4
        y1 = max(0, y - pad)
        y2 = min(image.shape[0], y + h + pad)
        x1 = max(0, x - pad)
        x2 = min(image.shape[1], x + w + pad)
        roi = image[y1:y2, x1:x2]
        results = run_rapidocr(roi)
        for r in results:
            if r["bbox"] is not None:
                # Adjust bbox back to full-image coords
                adjusted = [[pt[0] + x1, pt[1] + y1] for pt in r["bbox"]]
                r["bbox"] = adjusted
            items.append(r)
    return items


def fuzzy_match(text: str, word_list: list[str], threshold: int = 70) -> list[tuple]:
    """Return fuzzy matches above threshold. Returns list of (match, score, original_word)."""
    if not FUZZY_AVAILABLE or not word_list:
        return []
    normalized_choices = {}
    for candidate in word_list:
        normalized = _normalize_fuzzy_token(candidate)
        if normalized:
            normalized_choices[normalized] = candidate.strip()
    if not normalized_choices:
        return []

    found = []
    for w in text.split():
        normalized = _normalize_fuzzy_token(w)
        if not normalized:
            continue
        matches = fuzz_process.extractBests(
            normalized,
            list(normalized_choices.keys()),
            scorer=fuzz.ratio,
            score_cutoff=threshold,
            limit=3,
        )
        for match, score in matches:
            found.append((w, score, normalized_choices[match]))
    return found


def _normalize_fuzzy_token(token: str) -> str:
    token = re.sub(r"^[^A-Za-z']+|[^A-Za-z']+$", "", token or "").lower()
    token = re.sub(r"[^a-z']", "", token).strip("'")
    return token


def _load_english_dictionary():
    global _ENGLISH_WORDS, _ENGLISH_WORD_SET, _ENGLISH_WORD_BUCKETS

    if _ENGLISH_WORDS is not None:
        return _ENGLISH_WORDS, _ENGLISH_WORD_SET, _ENGLISH_WORD_BUCKETS
    if not WORD_FREQ_AVAILABLE:
        _ENGLISH_WORDS, _ENGLISH_WORD_SET, _ENGLISH_WORD_BUCKETS = [], set(), {}
        return _ENGLISH_WORDS, _ENGLISH_WORD_SET, _ENGLISH_WORD_BUCKETS

    seen = set()
    words = []
    buckets = {}

    for raw_word in top_n_list("en", ENGLISH_DICT_WORD_LIMIT):
        word = _normalize_fuzzy_token(raw_word)
        if not word:
            continue
        if len(word) == 1 and word not in {"a", "i"}:
            continue
        if word in seen:
            continue
        seen.add(word)
        words.append(word)
        buckets.setdefault(len(word), []).append(word)

    _ENGLISH_WORDS = words
    _ENGLISH_WORD_SET = seen
    _ENGLISH_WORD_BUCKETS = buckets
    return _ENGLISH_WORDS, _ENGLISH_WORD_SET, _ENGLISH_WORD_BUCKETS


def _is_valid_english_word(word: str) -> bool:
    if not WORD_FREQ_AVAILABLE or not word:
        return False
    _, english_word_set, _ = _load_english_dictionary()
    return word in english_word_set


def english_dictionary_match(text: str, threshold: int = 75) -> list[tuple]:
    """Suggest common English words for OCR tokens that do not look valid."""
    if not FUZZY_AVAILABLE or not WORD_FREQ_AVAILABLE:
        return []

    _, _, buckets = _load_english_dictionary()
    found = []

    for raw_word in text.split():
        word = _normalize_fuzzy_token(raw_word)
        if not word:
            continue
        if len(word) == 1 and word in {"a", "i"}:
            continue
        if len(word) < 2 or _is_valid_english_word(word):
            continue

        candidate_pool = []
        for length in range(max(1, len(word) - 2), len(word) + 3):
            candidate_pool.extend(buckets.get(length, []))
        if not candidate_pool:
            continue

        matches = fuzz_process.extractBests(
            word,
            candidate_pool,
            scorer=fuzz.ratio,
            score_cutoff=threshold,
            limit=1,
        )
        for match, score in matches:
            if match != word:
                found.append((raw_word, score, match))

    return found


def merge_fuzzy_matches(*match_groups: list[tuple]) -> list[tuple]:
    merged = []
    seen = set()
    for matches in match_groups:
        for raw_word, score, match in matches:
            key = (_normalize_fuzzy_token(raw_word), match.lower())
            if key in seen:
                continue
            seen.add(key)
            merged.append((raw_word, score, match))
    return merged


def _preserve_word_case(original: str, replacement: str) -> str:
    if not original:
        return replacement
    if original.isupper():
        return replacement.upper()
    if original[:1].isupper() and original[1:].islower():
        return replacement.capitalize()
    if original.islower():
        return replacement.lower()
    if original[:1].isupper():
        return replacement.capitalize()
    return replacement


def _special_city_correction(token: str) -> str | None:
    normalized = _normalize_fuzzy_token(token)
    if normalized == "ci" and token[:1] == "C":
        return "City"
    return None


def get_best_fuzzy_matches(
    text: str,
    word_list: list[str],
    english_on: bool,
    threshold: int,
) -> list[tuple]:
    return merge_fuzzy_matches(
        fuzzy_match(text, word_list, threshold),
        english_dictionary_match(text, threshold) if english_on else [],
    )


def correct_text_with_fuzzy(
    text: str,
    word_list: list[str],
    english_on: bool,
    threshold: int,
    fuzzy_enabled: bool = True,
) -> tuple[str, list[tuple]]:
    if not text:
        return "", []

    match_lookup = {}
    ordered_matches = []
    seen_matches = set()

    if fuzzy_enabled:
        for raw_word, score, match in get_best_fuzzy_matches(text, word_list, english_on, threshold):
            key = _normalize_fuzzy_token(raw_word)
            if not key:
                continue
            current = match_lookup.get(key)
            if current is None or score > current[0]:
                match_lookup[key] = (score, match)

    corrected_parts = []
    summary_matches = []

    for chunk in FUZZY_TOKEN_OR_SEPARATOR_RE.findall(text):
        if not chunk or not chunk[0].isalpha():
            corrected_parts.append(chunk)
            continue

        replacement = _special_city_correction(chunk)
        if replacement is not None:
            corrected = _preserve_word_case(chunk, replacement)
            corrected_parts.append(corrected)
            if corrected != chunk:
                summary_matches.append((chunk, 100, corrected))
            continue

        normalized = _normalize_fuzzy_token(chunk)
        match_info = match_lookup.get(normalized)
        if match_info is not None:
            corrected = _preserve_word_case(chunk, match_info[1])
            corrected_parts.append(corrected)
            if corrected != chunk:
                summary_matches.append((chunk, match_info[0], corrected))
            continue

        corrected_parts.append(chunk)

    for raw_word, score, match in summary_matches:
        key = (_normalize_fuzzy_token(raw_word), match.lower())
        if key not in seen_matches:
            seen_matches.add(key)
            ordered_matches.append((raw_word, score, match))

    return "".join(corrected_parts), ordered_matches


# ═══════════════════════════════════════════════════════════════════════════
#  GUI APPLICATION
# ═══════════════════════════════════════════════════════════════════════════

ACCENT    = "#2563eb"
ACCENT_H  = "#1d4ed8"
BG        = "#0f172a"
CARD      = "#1e293b"
CARD2     = "#273549"
TEXT      = "#e2e8f0"
TEXT2     = "#94a3b8"
SUCCESS   = "#22c55e"
WARN      = "#f59e0b"
DANGER    = "#ef4444"
BORDER    = "#334155"


class OCRStudio(tk.Tk):
    # ── Init ────────────────────────────────────────────────────────────────
    def __init__(self):
        super().__init__()
        self.title("OCR Studio  •  OpenCV + RapidOCR")
        self.configure(bg=BG)
        self.geometry("1400x860")
        self.minsize(1100, 700)

        # State
        self.source_pages: list[np.ndarray] = []   # raw BGR pages
        self.current_page_idx = 0
        self.processed_image: np.ndarray | None = None
        self._preview_job = None                    # after() id for debounce
        self.ocr_results: list[dict] = []
        self._loading_ocr = False
        self.preview_zoom = 1.0
        self.preview_zoom_min = 0.25
        self.preview_zoom_max = 8.0
        self.preview_image_size = (0, 0)

        # Tk Variables ── preprocessing
        self.var_angle     = tk.DoubleVar(value=0.0)
        self.var_bright    = tk.IntVar(value=0)
        self.var_contrast  = tk.DoubleVar(value=1.0)
        self.var_blur      = tk.IntVar(value=0)
        self.var_denoise   = tk.BooleanVar(value=False)
        self.var_sharpen   = tk.BooleanVar(value=False)
        self.var_binarise  = tk.BooleanVar(value=False)
        self.var_adaptive  = tk.BooleanVar(value=False)
        self.var_morph_o   = tk.BooleanVar(value=False)
        self.var_morph_c   = tk.BooleanVar(value=False)

        # Tk Variables ── OCR
        self.var_scan_mode  = tk.StringVar(value="full")   # "full" | "lines"
        self.var_draw_boxes = tk.BooleanVar(value=True)
        self.var_fuzzy_on   = tk.BooleanVar(value=False)
        self.var_fuzzy_english = tk.BooleanVar(value=True)
        self.var_fuzzy_thr  = tk.IntVar(value=75)
        self.var_fuzzy_words = tk.StringVar(value="")

        # Build UI
        self._build_menu()
        self._build_ui()
        self._bind_global_mousewheel()

        # Load OCR in background
        self.after(200, self._start_ocr_loader)

    # ── Background OCR loader ────────────────────────────────────────────────
    def _start_ocr_loader(self):
        self._set_status("Loading RapidOCR model…", WARN)
        threading.Thread(target=self._ocr_loader_thread, daemon=True).start()

    def _ocr_loader_thread(self):
        load_ocr_engine()
        self.after(0, self._ocr_loaded_callback)

    def _ocr_loaded_callback(self):
        if RAPIDOCR_AVAILABLE:
            self._set_status("RapidOCR ready ✓", SUCCESS)
            self.btn_ocr.configure(state="normal")
        else:
            self._set_status("RapidOCR failed to load — check console", DANGER)

    # ── Menu ─────────────────────────────────────────────────────────────────
    def _build_menu(self):
        mb = tk.Menu(self, bg=CARD, fg=TEXT, activebackground=ACCENT, tearoff=0)
        self.configure(menu=mb)
        fm = tk.Menu(mb, tearoff=0, bg=CARD, fg=TEXT, activebackground=ACCENT)
        mb.add_cascade(label="File", menu=fm)
        fm.add_command(label="Open Image / PDF…", command=self.open_file, accelerator="Ctrl+O")
        fm.add_command(label="Paste Image", command=self.paste_image, accelerator="Ctrl+Shift+V")
        fm.add_separator()
        fm.add_command(label="Export Results…", command=self.export_results)
        fm.add_separator()
        fm.add_command(label="Quit", command=self.destroy)
        self.bind_all("<Control-o>", lambda _: self.open_file())
        self.bind_all("<Control-Shift-V>", lambda _: self.paste_image())

    # ── Main layout ───────────────────────────────────────────────────────────
    def _build_ui(self):
        # ── Top bar
        top = tk.Frame(self, bg=CARD, pady=6)
        top.pack(fill="x")
        tk.Label(top, text="  ◉  OCR Studio", bg=CARD, fg=TEXT,
                 font=("Segoe UI", 13, "bold")).pack(side="left", padx=10)
        self.lbl_file = tk.Label(top, text="No file loaded", bg=CARD, fg=TEXT2,
                                  font=("Segoe UI", 9))
        self.lbl_file.pack(side="left", padx=20)
        self.lbl_status = tk.Label(top, text="Initialising…", bg=CARD, fg=WARN,
                                    font=("Segoe UI", 9, "italic"))
        self.lbl_status.pack(side="right", padx=14)

        # ── Body: left controls | centre preview | right results
        body = tk.Frame(self, bg=BG)
        body.pack(fill="both", expand=True, padx=6, pady=6)
        body.columnconfigure(1, weight=1)
        body.rowconfigure(0, weight=1)

        left  = self._build_left_panel(body)
        centre= self._build_centre_panel(body)
        right = self._build_right_panel(body)

        left.grid(row=0, column=0, sticky="ns", padx=(0, 6))
        centre.grid(row=0, column=1, sticky="nsew", padx=(0, 6))
        right.grid(row=0, column=2, sticky="ns")

    # ── Left panel: file + preprocessing ─────────────────────────────────────
    def _build_left_panel(self, parent):
        frame = tk.Frame(parent, bg=CARD, width=250)
        frame.pack_propagate(False)
        self.left_panel = frame

        canvas = tk.Canvas(frame, bg=CARD, highlightthickness=0, width=244)
        self.left_scroll_canvas = canvas
        sb = ttk.Scrollbar(frame, orient="vertical", command=canvas.yview)
        inner = tk.Frame(canvas, bg=CARD)
        inner.bind("<Configure>", lambda e: canvas.configure(
            scrollregion=canvas.bbox("all")))
        canvas.create_window((0, 0), window=inner, anchor="nw")
        canvas.configure(yscrollcommand=sb.set)
        canvas.pack(side="left", fill="both", expand=True)
        sb.pack(side="right", fill="y")

        pad = {"padx": 10, "pady": 4}

        # ── File section
        self._section(inner, "📂  FILE")
        btn_row = tk.Frame(inner, bg=CARD)
        btn_row.pack(fill="x", **pad)
        self._btn(btn_row, "Open File…", self.open_file, ACCENT).pack(
            side="left", fill="x", expand=True)
        self._btn(btn_row, "Paste", self.paste_image, CARD2).pack(
            side="left", fill="x", expand=True, padx=(4, 0))

        self.lbl_pages = tk.Label(inner, text="Pages: —", bg=CARD, fg=TEXT2,
                                   font=("Segoe UI", 8))
        self.lbl_pages.pack(anchor="w", padx=10)

        nav = tk.Frame(inner, bg=CARD)
        nav.pack(fill="x", padx=10, pady=2)
        self._btn(nav, "◀", lambda: self._nav_page(-1), CARD2, w=3).pack(side="left")
        self.lbl_page_num = tk.Label(nav, text="—", bg=CARD, fg=TEXT,
                                      font=("Segoe UI", 9, "bold"), width=6)
        self.lbl_page_num.pack(side="left", padx=4)
        self._btn(nav, "▶", lambda: self._nav_page(+1), CARD2, w=3).pack(side="left")

        ttk.Separator(inner, orient="horizontal").pack(fill="x", padx=6, pady=6)

        # ── Skew / rotation
        self._section(inner, "📐  SKEW & ROTATION")
        self._slider(inner, "Angle (°)", self.var_angle, -45, 45, 0.5,
                     resolution=0.5)
        af = tk.Frame(inner, bg=CARD)
        af.pack(fill="x", padx=10, pady=2)
        self._btn(af, "Auto-detect", self._auto_deskew, CARD2).pack(side="left", fill="x", expand=True)
        self._btn(af, "Reset", lambda: self.var_angle.set(0.0), CARD2).pack(side="left", fill="x", expand=True, padx=(4,0))

        ttk.Separator(inner, orient="horizontal").pack(fill="x", padx=6, pady=6)

        # ── Tone adjustments
        self._section(inner, "🎨  TONE")
        self._slider(inner, "Brightness", self.var_bright, -100, 100, 1)
        self._slider(inner, "Contrast",   self.var_contrast, 0.5, 3.0, 0.05,
                     fmt="{:.2f}")
        self._slider(inner, "Blur",       self.var_blur, 0, 10, 1)

        ttk.Separator(inner, orient="horizontal").pack(fill="x", padx=6, pady=6)

        # ── Filters
        self._section(inner, "🔧  FILTERS")
        for label, var in [
            ("Denoise",           self.var_denoise),
            ("Sharpen",           self.var_sharpen),
            ("Binarise (Otsu)",   self.var_binarise),
            ("Adaptive Threshold",self.var_adaptive),
            ("Morphology Open",   self.var_morph_o),
            ("Morphology Close",  self.var_morph_c),
        ]:
            self._check(inner, label, var)

        self._btn(inner, "↺  Reset All", self._reset_preprocessing, CARD2).pack(
            fill="x", padx=10, pady=(8, 2))

        return frame

    # ── Centre panel: preview ─────────────────────────────────────────────────
    def _build_centre_panel(self, parent):
        frame = tk.Frame(parent, bg=CARD)

        hdr = tk.Frame(frame, bg=CARD2, pady=5)
        hdr.pack(fill="x")
        tk.Label(hdr, text="  Preview", bg=CARD2, fg=TEXT,
                 font=("Segoe UI", 10, "bold")).pack(side="left", padx=10)
        self.var_show_ocr = tk.BooleanVar(value=True)
        self._btn(hdr, "Fit", self._reset_preview_zoom, CARD).pack(side="right", padx=(0, 10))
        self.lbl_zoom = tk.Label(hdr, text="100%", bg=CARD2, fg=TEXT2,
                                  font=("Segoe UI", 8, "bold"), width=7)
        self.lbl_zoom.pack(side="right", padx=(0, 6))
        self._check_inline(hdr, "Show OCR boxes", self.var_show_ocr).pack(side="right", padx=10)

        viewer = tk.Frame(frame, bg=CARD)
        viewer.pack(fill="both", expand=True, padx=4, pady=4)
        viewer.rowconfigure(0, weight=1)
        viewer.columnconfigure(0, weight=1)

        self.preview_canvas = tk.Canvas(
            viewer,
            bg="#0a1628",
            highlightthickness=0,
            xscrollincrement=1,
            yscrollincrement=1,
        )
        self.preview_canvas.grid(row=0, column=0, sticky="nsew")

        self.preview_scroll_y = ttk.Scrollbar(viewer, orient="vertical", command=self.preview_canvas.yview)
        self.preview_scroll_y.grid(row=0, column=1, sticky="ns")
        self.preview_scroll_x = ttk.Scrollbar(viewer, orient="horizontal", command=self.preview_canvas.xview)
        self.preview_scroll_x.grid(row=1, column=0, sticky="ew")
        self.preview_canvas.configure(
            xscrollcommand=self.preview_scroll_x.set,
            yscrollcommand=self.preview_scroll_y.set,
        )

        self.preview_image_id = self.preview_canvas.create_image(0, 0, anchor="nw")
        self.preview_placeholder_id = self.preview_canvas.create_text(
            0, 0,
            text="Open a file to begin",
            fill=TEXT2,
            font=("Segoe UI", 12),
        )
        self.preview_canvas.bind("<Configure>", self._on_preview_canvas_configure)
        self.preview_canvas.bind("<ButtonPress-1>", self._preview_pan_start)
        self.preview_canvas.bind("<B1-Motion>", self._preview_pan_move)
        self._show_preview_placeholder("Open a file to begin")

        return frame

    # ── Right panel: OCR controls + results ──────────────────────────────────
    def _build_right_panel(self, parent):
        frame = tk.Frame(parent, bg=CARD, width=340)
        frame.pack_propagate(False)

        # OCR controls header
        hdr = tk.Frame(frame, bg=CARD2, pady=5)
        hdr.pack(fill="x")
        tk.Label(hdr, text="  OCR Results", bg=CARD2, fg=TEXT,
                 font=("Segoe UI", 10, "bold")).pack(side="left", padx=10)

        ctrl = tk.Frame(frame, bg=CARD)
        ctrl.pack(fill="x", padx=8, pady=6)

        # Scan mode
        tk.Label(ctrl, text="Scan Mode", bg=CARD, fg=TEXT2,
                 font=("Segoe UI", 8)).pack(anchor="w")
        mf = tk.Frame(ctrl, bg=CARD)
        mf.pack(fill="x", pady=2)
        for txt, val in [("Full Page", "full"), ("Detect Lines", "lines")]:
            tk.Radiobutton(mf, text=txt, variable=self.var_scan_mode, value=val,
                           bg=CARD, fg=TEXT, selectcolor=ACCENT,
                           activebackground=CARD, font=("Segoe UI", 9),
                           command=lambda: None).pack(side="left", padx=4)

        # Run OCR button
        self.btn_ocr = self._btn(ctrl, "▶  Run OCR", self._run_ocr_thread, ACCENT)
        self.btn_ocr.pack(fill="x", pady=(6, 2))
        self.btn_ocr.configure(state="disabled")

        self.ocr_progress = ttk.Progressbar(ctrl, mode="indeterminate")
        self.ocr_progress.pack(fill="x", pady=2)

        ttk.Separator(ctrl, orient="horizontal").pack(fill="x", pady=6)

        # Fuzzy matching
        self._section(ctrl, "🔍  FUZZY MATCHING")
        ff = tk.Frame(ctrl, bg=CARD)
        ff.pack(fill="x")
        self._check_inline(ff, "Enable", self.var_fuzzy_on).pack(side="left")
        self._check_inline(ff, "English dictionary", self.var_fuzzy_english).pack(side="left", padx=(10, 0))
        tk.Label(ff, text="Threshold:", bg=CARD, fg=TEXT2,
                 font=("Segoe UI", 8)).pack(side="left", padx=(10, 2))
        tk.Spinbox(ff, from_=50, to=100, textvariable=self.var_fuzzy_thr,
                   width=4, bg=CARD2, fg=TEXT, insertbackground=TEXT,
                   font=("Segoe UI", 9), buttonbackground=CARD2).pack(side="left")

        tk.Label(ctrl, text="Word list (comma-separated):", bg=CARD, fg=TEXT2,
                 font=("Segoe UI", 8)).pack(anchor="w", pady=(4, 0))
        self.ent_words = tk.Entry(ctrl, textvariable=self.var_fuzzy_words,
                                   bg=CARD2, fg=TEXT, insertbackground=TEXT,
                                   font=("Segoe UI", 9), relief="flat")
        self.ent_words.pack(fill="x", pady=2, ipady=4)

        ttk.Separator(ctrl, orient="horizontal").pack(fill="x", pady=6)

        # Stats bar
        self.lbl_stats = tk.Label(ctrl, text="Lines: — | Avg conf: —",
                                   bg=CARD, fg=TEXT2, font=("Segoe UI", 8))
        self.lbl_stats.pack(anchor="w")

        btn_row = tk.Frame(ctrl, bg=CARD)
        btn_row.pack(fill="x", pady=4)
        self._btn(btn_row, "Copy Text", self._copy_text, CARD2).pack(
            side="left", fill="x", expand=True)
        self._btn(btn_row, "Export…", self.export_results, CARD2).pack(
            side="left", fill="x", expand=True, padx=(4, 0))

        # Results text widget
        self.txt_results = scrolledtext.ScrolledText(
            frame, wrap="word", bg="#0a1628", fg=TEXT,
            insertbackground=TEXT, font=("Consolas", 9),
            relief="flat", padx=8, pady=8,
            selectbackground=ACCENT
        )
        self.txt_results.pack(fill="both", expand=True, padx=4, pady=(0, 4))

        # Tag colours for results
        self.txt_results.tag_configure("header",  foreground=ACCENT,
                                        font=("Consolas", 9, "bold"))
        self.txt_results.tag_configure("low_conf", foreground=WARN)
        self.txt_results.tag_configure("match",    foreground=SUCCESS,
                                        font=("Consolas", 9, "bold"))
        self.txt_results.tag_configure("muted",    foreground=TEXT2)

        return frame

    # ── Widget factories ──────────────────────────────────────────────────────
    def _section(self, parent, label):
        tk.Label(parent, text=label, bg=CARD, fg=ACCENT,
                 font=("Segoe UI", 8, "bold")).pack(anchor="w", padx=10, pady=(8, 0))

    def _btn(self, parent, text, cmd, color=CARD2, w=None):
        kw = {"text": text, "command": cmd, "bg": color, "fg": TEXT,
              "font": ("Segoe UI", 9), "relief": "flat", "cursor": "hand2",
              "activebackground": ACCENT_H, "activeforeground": "white",
              "pady": 5}
        if w:
            kw["width"] = w
        b = tk.Button(parent, **kw)
        b.bind("<Enter>", lambda e: b.configure(bg=ACCENT_H if color == ACCENT else BORDER))
        b.bind("<Leave>", lambda e: b.configure(bg=color))
        return b

    def _slider(self, parent, label, var, mn, mx, step, resolution=None, fmt="{:.0f}"):
        frm = tk.Frame(parent, bg=CARD)
        frm.pack(fill="x", padx=10, pady=1)
        top = tk.Frame(frm, bg=CARD)
        top.pack(fill="x")
        tk.Label(top, text=label, bg=CARD, fg=TEXT2,
                 font=("Segoe UI", 8)).pack(side="left")
        val_lbl = tk.Label(top, bg=CARD, fg=TEXT, font=("Segoe UI", 8, "bold"), width=6)
        val_lbl.pack(side="right")

        def update_label(*_):
            v = var.get()
            val_lbl.config(text=fmt.format(v))
            self._schedule_preview()

        res = resolution or step
        s = tk.Scale(frm, variable=var, from_=mn, to=mx, resolution=res,
                     orient="horizontal", bg=CARD, fg=TEXT, troughcolor=CARD2,
                     highlightthickness=0, showvalue=False, sliderrelief="flat",
                     command=lambda v: update_label())
        s.pack(fill="x")
        update_label()

    def _check(self, parent, label, var):
        tk.Checkbutton(parent, text=label, variable=var, bg=CARD, fg=TEXT2,
                       selectcolor=CARD2, activebackground=CARD,
                       font=("Segoe UI", 8), command=self._schedule_preview
                       ).pack(anchor="w", padx=10)

    def _check_inline(self, parent, label, var):
        return tk.Checkbutton(parent, text=label, variable=var, bg=CARD2,
                               fg=TEXT2, selectcolor=CARD, activebackground=CARD2,
                               font=("Segoe UI", 8))

    def _bind_global_mousewheel(self):
        self.bind_all("<MouseWheel>", self._on_global_mousewheel, add="+")
        self.bind_all("<Button-4>", lambda e: self._on_global_mousewheel(e, linux_delta=1), add="+")
        self.bind_all("<Button-5>", lambda e: self._on_global_mousewheel(e, linux_delta=-1), add="+")

    def _on_global_mousewheel(self, event, linux_delta=None):
        widget = self.winfo_containing(self.winfo_pointerx(), self.winfo_pointery()) or event.widget
        steps = self._mousewheel_steps(event, linux_delta)
        if steps == 0:
            return None

        if hasattr(self, "preview_canvas") and self._is_descendant_of(widget, self.preview_canvas):
            self._zoom_preview(1.12 ** steps)
            return "break"

        if hasattr(self, "left_panel") and self._is_descendant_of(widget, self.left_panel):
            self.left_scroll_canvas.yview_scroll(-steps, "units")
            return "break"

        return None

    def _mousewheel_steps(self, event, linux_delta=None):
        if linux_delta is not None:
            return linux_delta
        delta = getattr(event, "delta", 0)
        if delta == 0:
            return 0
        magnitude = max(1, abs(delta) // 120) if abs(delta) >= 120 else 1
        return magnitude if delta > 0 else -magnitude

    def _is_descendant_of(self, widget, ancestor):
        while widget is not None:
            if widget == ancestor:
                return True
            widget = getattr(widget, "master", None)
        return False

    # ── File I/O ──────────────────────────────────────────────────────────────
    def open_file(self):
        path = filedialog.askopenfilename(
            title="Open Image or PDF",
            filetypes=[
                ("Images & PDFs", "*.png *.jpg *.jpeg *.tiff *.bmp *.webp *.pdf"),
                ("PDF",           "*.pdf"),
                ("Images",        "*.png *.jpg *.jpeg *.tiff *.bmp *.webp"),
                ("All files",     "*.*"),
            ]
        )
        if not path:
            return
        self._set_status("Loading…", WARN)
        threading.Thread(target=self._load_file_thread, args=(path,), daemon=True).start()

    def paste_image(self):
        try:
            clipboard, backend = _grab_clipboard_payload()
        except Exception as exc:
            messagebox.showerror(
                "Paste Image",
                f"Could not access the clipboard.\n\n{exc}",
            )
            self._set_status(f"Clipboard error: {exc}", DANGER)
            return

        if clipboard is None:
            messagebox.showinfo("Paste Image", "Clipboard does not contain an image.")
            return

        if isinstance(clipboard, list):
            image_paths = [
                path for path in clipboard
                if isinstance(path, str) and os.path.isfile(path)
                and os.path.splitext(path)[1].lower() in {".png", ".jpg", ".jpeg", ".tiff", ".bmp", ".webp"}
            ]
            if not image_paths:
                messagebox.showinfo("Paste Image", "Clipboard does not contain a supported image.")
                return
            self._set_status("Loading pasted image…", WARN)
            threading.Thread(target=self._load_file_thread, args=(image_paths[0],), daemon=True).start()
            return

        if not isinstance(clipboard, Image.Image):
            messagebox.showinfo("Paste Image", "Clipboard content is not a supported image.")
            return

        pil_image = clipboard.convert("RGBA") if clipboard.mode not in ("RGB", "RGBA", "L") else clipboard
        img = np.array(pil_image)
        if img.ndim == 2:
            bgr = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
        elif img.shape[2] == 4:
            bgr = cv2.cvtColor(img, cv2.COLOR_RGBA2BGR)
        else:
            bgr = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)

        self._apply_loaded_pages("Clipboard Image", [bgr])
        backend_label = f" via {backend}" if backend else ""
        self._set_status(f"Pasted image from clipboard{backend_label}.", SUCCESS)

    def _load_file_thread(self, path):
        try:
            ext = os.path.splitext(path)[1].lower()
            pages = []
            if ext == ".pdf":
                pil_pages = convert_from_path(path, dpi=200)
                for p in pil_pages:
                    arr = np.array(p)
                    pages.append(cv2.cvtColor(arr, cv2.COLOR_RGB2BGR))
            else:
                img = cv2.imread(path)
                if img is None:
                    raise ValueError("Could not read image")
                pages.append(img)
            self.after(0, lambda: self._apply_loaded_pages(path, pages))
        except Exception as e:
            self.after(0, lambda: messagebox.showerror("Load Error", str(e)))
            self.after(0, lambda: self._set_status(f"Error: {e}", DANGER))

    def _apply_loaded_pages(self, path, pages):
        self.source_pages = pages
        self.current_page_idx = 0
        name = os.path.basename(path) if path else "Untitled"
        self.lbl_file.config(text=name)
        self.lbl_pages.config(text=f"Pages: {len(pages)}")
        self._update_page_label()
        self.ocr_results = []
        self.txt_results.delete("1.0", "end")
        self._reset_preview_zoom(update=False)
        self._set_status("File loaded. Adjust filters then run OCR.", SUCCESS)
        self._reset_preprocessing()

    def _nav_page(self, delta):
        if not self.source_pages:
            return
        new_idx = self.current_page_idx + delta
        if 0 <= new_idx < len(self.source_pages):
            self.current_page_idx = new_idx
            self._update_page_label()
            self.ocr_results = []
            self._update_preview()

    def _update_page_label(self):
        total = len(self.source_pages)
        cur   = self.current_page_idx + 1
        self.lbl_page_num.config(text=f"{cur}/{total}")

    # ── Preprocessing & preview ───────────────────────────────────────────────
    def _schedule_preview(self, *_):
        if self._preview_job:
            self.after_cancel(self._preview_job)
        self._preview_job = self.after(80, self._update_preview)

    def _on_preview_canvas_configure(self, _event):
        self._schedule_preview()

    def _show_preview_placeholder(self, text):
        if not hasattr(self, "preview_canvas"):
            return
        cw = self.preview_canvas.winfo_width() or 700
        ch = self.preview_canvas.winfo_height() or 600
        self.preview_canvas.itemconfigure(self.preview_image_id, image="", state="hidden")
        self.preview_canvas.itemconfigure(self.preview_placeholder_id, text=text, state="normal")
        self.preview_canvas.coords(self.preview_placeholder_id, cw / 2, ch / 2)
        self.preview_canvas.configure(scrollregion=(0, 0, cw, ch))
        self.preview_canvas.xview_moveto(0)
        self.preview_canvas.yview_moveto(0)
        self.preview_canvas._photo = None
        self.preview_image_size = (0, 0)

    def _fit_preview_scale(self, width, height):
        cw = max(1, self.preview_canvas.winfo_width())
        ch = max(1, self.preview_canvas.winfo_height())
        return min(cw / max(1, width), ch / max(1, height))

    def _update_zoom_label(self):
        if hasattr(self, "lbl_zoom"):
            self.lbl_zoom.config(text=f"{self.preview_zoom * 100:.0f}%")

    def _reset_preview_zoom(self, update=True):
        self.preview_zoom = 1.0
        self._update_zoom_label()
        if update:
            self._schedule_preview()

    def _zoom_preview(self, factor):
        new_zoom = max(self.preview_zoom_min, min(self.preview_zoom_max, self.preview_zoom * factor))
        if abs(new_zoom - self.preview_zoom) < 1e-6:
            return
        self.preview_zoom = new_zoom
        self._update_zoom_label()
        self._schedule_preview()

    def _preview_pan_start(self, event):
        if self.preview_image_size[0] > self.preview_canvas.winfo_width() or self.preview_image_size[1] > self.preview_canvas.winfo_height():
            self.preview_canvas.scan_mark(event.x, event.y)

    def _preview_pan_move(self, event):
        if self.preview_image_size[0] > self.preview_canvas.winfo_width() or self.preview_image_size[1] > self.preview_canvas.winfo_height():
            self.preview_canvas.scan_dragto(event.x, event.y, gain=1)

    def _update_preview(self):
        self._preview_job = None
        if not self.source_pages:
            self._show_preview_placeholder("Open a file to begin")
            return
        src = self.source_pages[self.current_page_idx]
        img = apply_preprocessing(
            src,
            angle    = self.var_angle.get(),
            brightness=self.var_bright.get(),
            contrast  = self.var_contrast.get(),
            blur      = self.var_blur.get(),
            denoise   = self.var_denoise.get(),
            sharpen   = self.var_sharpen.get(),
            binarise  = self.var_binarise.get(),
            adaptive  = self.var_adaptive.get(),
            morph_open = self.var_morph_o.get(),
            morph_close= self.var_morph_c.get(),
        )
        self.processed_image = img

        # Draw OCR boxes if available
        if self.ocr_results and self.var_show_ocr.get():
            img = self._draw_boxes(img.copy())

        ih, iw = img.shape[:2]
        scale = self._fit_preview_scale(iw, ih) * self.preview_zoom
        disp_w = max(1, int(round(iw * scale)))
        disp_h = max(1, int(round(ih * scale)))
        photo = cv2_to_photoimage(img, disp_w, disp_h)

        cw = self.preview_canvas.winfo_width() or 700
        ch = self.preview_canvas.winfo_height() or 600
        offset_x = max((cw - disp_w) // 2, 0)
        offset_y = max((ch - disp_h) // 2, 0)

        self.preview_canvas.itemconfigure(self.preview_placeholder_id, state="hidden")
        self.preview_canvas.itemconfigure(self.preview_image_id, image=photo, state="normal")
        self.preview_canvas.coords(self.preview_image_id, offset_x, offset_y)
        self.preview_canvas.configure(scrollregion=(0, 0, max(disp_w, cw), max(disp_h, ch)))
        self.preview_canvas._photo = photo           # prevent GC
        self.preview_image_size = (disp_w, disp_h)

        if disp_w <= cw:
            self.preview_canvas.xview_moveto(0)
        if disp_h <= ch:
            self.preview_canvas.yview_moveto(0)

    def _draw_boxes(self, img: np.ndarray) -> np.ndarray:
        for item in self.ocr_results:
            bbox = item.get("bbox")
            if bbox is None:
                continue
            pts = np.array(bbox, dtype=np.int32)
            conf = item.get("conf", 1.0)
            color = (34, 197, 94) if conf >= 0.8 else (245, 158, 11) if conf >= 0.5 else (239, 68, 68)
            cv2.polylines(img, [pts], isClosed=True, color=color, thickness=2)
        return img

    def _auto_deskew(self):
        if self.processed_image is None and self.source_pages:
            img = self.source_pages[self.current_page_idx]
        elif self.processed_image is not None:
            img = self.processed_image
        else:
            return
        angle = auto_deskew_angle(img)
        self.var_angle.set(round(angle, 1))
        self._set_status(f"Auto-detected skew angle: {angle:.1f}°", SUCCESS)
        self._update_preview()

    def _reset_preprocessing(self):
        self.var_angle.set(0.0)
        self.var_bright.set(0)
        self.var_contrast.set(1.0)
        self.var_blur.set(0)
        for v in (self.var_denoise, self.var_sharpen, self.var_binarise,
                  self.var_adaptive, self.var_morph_o, self.var_morph_c):
            v.set(False)
        self._update_preview()

    # ── OCR ───────────────────────────────────────────────────────────────────
    def _run_ocr_thread(self):
        if self.processed_image is None:
            messagebox.showwarning("No Image", "Open a file first.")
            return
        if self._loading_ocr:
            return
        self._loading_ocr = True
        self.btn_ocr.configure(state="disabled", text="Running…")
        self.ocr_progress.start(12)
        self._set_status("Running OCR…", WARN)
        threading.Thread(target=self._ocr_worker, daemon=True).start()

    def _ocr_worker(self):
        try:
            img = self.processed_image.copy()
            mode = self.var_scan_mode.get()
            if mode == "lines":
                results = detect_lines_ocr(img)
            else:
                results = run_rapidocr(img)
            self.after(0, lambda: self._ocr_done(results))
        except Exception as e:
            self.after(0, lambda: self._ocr_error(str(e)))

    def _ocr_done(self, results):
        self._loading_ocr = False
        self.ocr_results = results
        self.ocr_progress.stop()
        self.btn_ocr.configure(state="normal", text="▶  Run OCR")
        self._set_status(f"OCR complete — {len(results)} regions found.", SUCCESS)
        self._render_results(results)
        self._update_preview()

    def _ocr_error(self, msg):
        self._loading_ocr = False
        self.ocr_progress.stop()
        self.btn_ocr.configure(state="normal", text="▶  Run OCR")
        self._set_status(f"OCR error: {msg}", DANGER)
        messagebox.showerror("OCR Error", msg)

    def _fuzzy_settings(self):
        word_list = [w.strip() for w in self.var_fuzzy_words.get().split(",") if w.strip()]
        english_on = self.var_fuzzy_english.get() and WORD_FREQ_AVAILABLE
        fuzzy_enabled = self.var_fuzzy_on.get() and FUZZY_AVAILABLE and (bool(word_list) or english_on)
        threshold = self.var_fuzzy_thr.get()
        return word_list, english_on, fuzzy_enabled, threshold

    def _corrected_text_and_matches(self, text: str) -> tuple[str, list[tuple]]:
        word_list, english_on, fuzzy_enabled, threshold = self._fuzzy_settings()
        return correct_text_with_fuzzy(
            text,
            word_list=word_list,
            english_on=english_on,
            threshold=threshold,
            fuzzy_enabled=fuzzy_enabled,
        )

    def _render_results(self, results: list[dict]):
        self.txt_results.delete("1.0", "end")
        if not results:
            self.txt_results.insert("end", "No text found.\n", "muted")
            return

        _, _, fuzzy_on, _ = self._fuzzy_settings()

        total_conf = 0.0
        line_count = 0

        for i, item in enumerate(results):
            text = item.get("text", "")
            corrected_text, matches = self._corrected_text_and_matches(text)
            conf = item.get("conf", 1.0)
            total_conf += conf
            line_count += 1

            conf_str = f"[{conf*100:5.1f}%]"
            tag = "low_conf" if conf < 0.5 else "muted"
            self.txt_results.insert("end", conf_str + " ", tag)
            self.txt_results.insert("end", f"{i+1:3d}  ", "muted")

            if fuzzy_on:
                display_text = corrected_text if corrected_text else text
                if matches and display_text != text:
                    self.txt_results.insert("end", display_text + "\n", "match")
                else:
                    self.txt_results.insert("end", display_text + "\n")
                if matches:
                    summary = ", ".join(f"'{o}'→'{m}'({s}%)" for o, s, m in matches)
                    self.txt_results.insert("end", f"       ↳ matches: {summary}\n", "match")
            else:
                self.txt_results.insert("end", corrected_text + "\n")

        avg = (total_conf / line_count * 100) if line_count else 0
        self.lbl_stats.config(
            text=f"Lines: {line_count}  |  Avg conf: {avg:.1f}%")

    # ── Export / Copy ─────────────────────────────────────────────────────────
    def _copy_text(self):
        text = "\n".join(self._corrected_text_and_matches(r.get("text", ""))[0] for r in self.ocr_results)
        self.clipboard_clear()
        self.clipboard_append(text)
        self._set_status("Copied corrected text to clipboard!", SUCCESS)

    def export_results(self):
        if not self.ocr_results:
            messagebox.showinfo("Nothing to export", "Run OCR first.")
            return
        path = filedialog.asksaveasfilename(
            defaultextension=".txt",
            filetypes=[("Text file", "*.txt"), ("All files", "*.*")])
        if not path:
            return
        with open(path, "w", encoding="utf-8") as f:
            for item in self.ocr_results:
                f.write(self._corrected_text_and_matches(item.get("text", ""))[0] + "\n")
        self._set_status(f"Exported to {os.path.basename(path)}", SUCCESS)

    # ── Status bar ────────────────────────────────────────────────────────────
    def _set_status(self, msg, color=TEXT2):
        self.lbl_status.config(text=msg, fg=color)


# ═══════════════════════════════════════════════════════════════════════════
#  Entry point
# ═══════════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    # Suppress numpy noise
    import warnings, logging
    warnings.filterwarnings("ignore")
    logging.disable(logging.CRITICAL)
    os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"

    app = OCRStudio()
    app.mainloop()
