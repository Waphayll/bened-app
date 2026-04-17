import base64
import re
from difflib import SequenceMatcher

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pdf2image import convert_from_bytes, pdfinfo_from_bytes

from paddle_compat import get_modelscope_stub_reason, load_paddleocr_class


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── PaddleOCR ───────────────────────────────────────────────────────────────
PADDLE_AVAILABLE = False
ocr_engine = None


def _build_paddle_ocr_engine():
    PaddleOCR = load_paddleocr_class()
    init_variants = [
        {"lang": "en", "use_textline_orientation": False},
        {"lang": "en", "use_textline_orientation": True},
        {"lang": "en"},
        {"lang": "en", "use_angle_cls": False},
        {"lang": "en", "use_angle_cls": True},
        {},
    ]
    last_error = None
    for kwargs in init_variants:
        try:
            return PaddleOCR(**kwargs)
        except Exception as exc:
            last_error = exc
    if last_error is not None:
        raise last_error
    raise RuntimeError("PaddleOCR initialization failed with no usable configuration.")


def _is_bbox_candidate(value) -> bool:
    try:
        arr = np.asarray(value, dtype=np.float32)
    except Exception:
        return False
    if arr.ndim == 2 and arr.shape[0] >= 4 and arr.shape[1] >= 2:
        return True
    return arr.ndim == 1 and arr.size in (4, 8)


def _normalize_bbox_points(raw_bbox) -> list[list[int]]:
    arr = np.asarray(raw_bbox, dtype=np.float32)
    if arr.ndim == 1:
        if arr.size == 4:
            x, y, width, height = arr.tolist()
            arr = np.array(
                [
                    [x, y],
                    [x + width, y],
                    [x + width, y + height],
                    [x, y + height],
                ],
                dtype=np.float32,
            )
        elif arr.size >= 8:
            arr = arr[:8].reshape(4, 2)
        else:
            raise ValueError("Unexpected bbox format")
    elif arr.ndim == 2:
        if arr.shape[0] >= 4 and arr.shape[1] >= 2:
            arr = arr[:4, :2]
        else:
            raise ValueError("Unexpected bbox format")
    else:
        raise ValueError("Unexpected bbox format")
    return [[int(round(point[0])), int(round(point[1]))] for point in arr]


def _iter_paddle_line_candidates(node):
    if node is None:
        return

    # PaddleOCR v3 often returns custom result objects instead of plain dicts.
    if not isinstance(node, (dict, list, tuple, np.ndarray)):
        if hasattr(node, "to_dict") and callable(node.to_dict):
            try:
                node = node.to_dict()
            except Exception:
                pass
        elif hasattr(node, "__dict__"):
            node = vars(node)

    if isinstance(node, dict):
        polys = None
        for key in ("dt_polys", "rec_polys", "polys", "boxes", "dt_boxes"):
            value = node.get(key)
            if value is not None:
                polys = value
                break

        texts = None
        for key in ("rec_texts", "texts"):
            value = node.get(key)
            if value is not None:
                texts = value
                break

        scores = None
        for key in ("rec_scores", "scores"):
            value = node.get(key)
            if value is not None:
                scores = value
                break

        if isinstance(texts, (list, tuple)) and isinstance(polys, (list, tuple, np.ndarray)):
            count = min(len(texts), len(polys))
            for index in range(count):
                confidence = scores[index] if isinstance(scores, (list, tuple, np.ndarray)) and index < len(scores) else 0.0
                yield (polys[index], texts[index], confidence)

        bbox = node.get("bbox") or node.get("points") or node.get("box")
        text = node.get("text") or node.get("transcription") or node.get("rec_text")
        confidence = node.get("score", node.get("confidence", node.get("rec_score", 0.0)))
        if bbox is not None and text is not None:
            yield (bbox, text, confidence)

        for key in ("result", "results", "res", "data"):
            child = node.get(key)
            if child is not None:
                yield from _iter_paddle_line_candidates(child)
        return

    if isinstance(node, (list, tuple)):
        if len(node) >= 2 and _is_bbox_candidate(node[0]):
            text_candidate = node[1]
            text = ""
            confidence = 0.0

            if isinstance(text_candidate, (list, tuple)):
                if len(text_candidate) >= 1:
                    text = str(text_candidate[0] or "")
                if len(text_candidate) >= 2:
                    try:
                        confidence = float(text_candidate[1])
                    except Exception:
                        confidence = 0.0
            elif isinstance(text_candidate, dict):
                text = str(text_candidate.get("text") or text_candidate.get("rec_text") or "")
                try:
                    confidence = float(
                        text_candidate.get(
                            "score",
                            text_candidate.get("confidence", text_candidate.get("rec_score", 0.0)),
                        )
                    )
                except Exception:
                    confidence = 0.0
            else:
                text = str(text_candidate or "")

            yield (node[0], text, confidence)
            return

        for child in node:
            yield from _iter_paddle_line_candidates(child)
        return

    if hasattr(node, "__iter__") and not isinstance(node, (str, bytes, np.ndarray)):
        for child in node:
            yield from _iter_paddle_line_candidates(child)


def load_ocr_engine():
    """Lazy-load PaddleOCR for API usage."""
    global ocr_engine, PADDLE_AVAILABLE
    if ocr_engine is not None:
        return ocr_engine
    try:
        ocr_engine = _build_paddle_ocr_engine()
        PADDLE_AVAILABLE = True
        workaround_reason = get_modelscope_stub_reason()
        if workaround_reason:
            print(
                "[PaddleOCR] Compatibility mode enabled: "
                f"ModelScope import skipped ({workaround_reason})"
            )
    except Exception as exc:
        PADDLE_AVAILABLE = False
        print(f"[PaddleOCR] Could not load: {exc}")
    return ocr_engine

OCR_DPI = 300
KEYWORD_MATCH_THRESHOLD = 0.82
MIN_WORD_CONFIDENCE = 0.10
MIN_LINE_CONFIDENCE = 0.15
FAST_EXIT_OCR_SCORE = 80.0
MIN_ROTATION_TRIGGER_SCORE = 14.0
AGGRESSIVE_VARIANT_PENALTY = 10.0

WHITESPACE_RE = re.compile(r"\s+")
SPACE_BEFORE_PUNCT_RE = re.compile(r"\s+([,.;:!?%)\]])")
SPACE_AFTER_PUNCT_RE = re.compile(r"([,.;:!?])([^\s])")
OPEN_BRACKET_SPACE_RE = re.compile(r"([(\[])\s+")
REPEATED_RULE_MARK_RE = re.compile(r"[_|]{2,}")
IMAGE_CONTENT_TYPE_RE = re.compile(r"^image\/[a-z0-9.+-]+$")
RECEIPT_AMOUNT_RE = re.compile(r"\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2}")
RECEIPT_QUANTITY_RE = re.compile(r"^\s*(\d{1,7}(?:[.,]\d{1,3})?)\b")
RECEIPT_UNIT_RE = re.compile(
    r"\b(PCS?|PIECES?|BOX(?:ES)?|SETS?|ROLLS?|KGS?|KG|GRAMS?|G|LIT(?:ERS?)?|L|ML|MTRS?|METERS?|M|FT|FEET|BAGS?|PACKS?|CTNS?|CARTONS?|UNITS?)\b",
    re.IGNORECASE,
)
RECEIPT_TOTAL_LINE_RE = re.compile(
    r"TOTAL\s*(?:AMOUNT|DUE|PAYABLE|PRICE)?\s*[:\-]?\s*([0-9][0-9,]*\.\d{2})",
    re.IGNORECASE,
)


def normalize_text(text):
    return re.sub(r"[^a-z0-9]+", "", text.lower())


def normalize_line_text(text):
    cleaned = WHITESPACE_RE.sub(" ", (text or "").strip())
    if not cleaned:
        return ""

    cleaned = SPACE_BEFORE_PUNCT_RE.sub(r"\1", cleaned)
    cleaned = OPEN_BRACKET_SPACE_RE.sub(r"\1", cleaned)
    cleaned = SPACE_AFTER_PUNCT_RE.sub(r"\1 \2", cleaned)
    cleaned = REPEATED_RULE_MARK_RE.sub(" ", cleaned)

    return WHITESPACE_RE.sub(" ", cleaned).strip(" -")


def text_quality_factor(text, confidence=1.0):
    cleaned = normalize_line_text(text)
    if not cleaned:
        return 0.0

    alnum_count = sum(ch.isalnum() for ch in cleaned)
    alpha_count = sum(ch.isalpha() for ch in cleaned)
    text_ratio = alnum_count / max(1, len(cleaned))
    alpha_ratio = alpha_count / max(1, alnum_count)
    token_length = len(normalize_text(cleaned))

    length_factor = 0.55 if token_length < 4 else 1.0
    confidence_factor = 0.7 + 0.3 * min(max(float(confidence or 0.0), 0.0), 1.0)
    ratio_factor = 0.45 + 0.55 * text_ratio
    alpha_factor = 0.8 + 0.2 * alpha_ratio

    quality = length_factor * confidence_factor * ratio_factor * alpha_factor
    return max(0.08, min(1.2, quality))


def is_noise_line(text, confidence):
    cleaned = (text or "").strip()
    if not cleaned:
        return True

    alnum_count = sum(ch.isalnum() for ch in cleaned)
    if alnum_count < 2 and confidence < 0.45:
        return True

    if confidence < MIN_LINE_CONFIDENCE and len(normalize_text(cleaned)) < 3:
        return True

    text_ratio = alnum_count / max(1, len(cleaned))
    if text_ratio < 0.22 and confidence < 0.5:
        return True

    return False


def compute_odd_kernel(size, minimum=3, maximum=51):
    size = max(minimum, min(maximum, int(size)))
    if size % 2 == 0:
        size += 1 if size < maximum else -1
    return max(minimum, size)


def pil_to_gray(pil_img):
    img = np.array(pil_img)

    if img.ndim == 2:
        return img

    if img.shape[2] == 4:
        alpha = img[:, :, 3:4].astype(np.float32) / 255.0
        rgb = img[:, :, :3].astype(np.float32)
        white = np.full_like(rgb, 255, dtype=np.float32)
        img = (rgb * alpha + white * (1.0 - alpha)).astype(np.uint8)
    else:
        img = img[:, :, :3]

    return cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)


def upscale_for_ocr(gray):
    height, width = gray.shape[:2]
    shortest_edge = max(1, min(height, width))
    scale = min(2.0, max(1.0, 1400.0 / shortest_edge))

    if scale <= 1.05:
        return gray

    new_size = (int(width * scale), int(height * scale))
    return cv2.resize(gray, new_size, interpolation=cv2.INTER_CUBIC)


def crop_to_text_region(gray):
    _, binary_inv = cv2.threshold(
        gray,
        0,
        255,
        cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU,
    )

    height, width = gray.shape[:2]
    min_row_ink = max(12, int(width * 0.0025))
    min_col_ink = max(12, int(height * 0.0025))

    row_ink = np.sum(binary_inv > 0, axis=1)
    col_ink = np.sum(binary_inv > 0, axis=0)

    row_indices = np.where(row_ink > min_row_ink)[0]
    col_indices = np.where(col_ink > min_col_ink)[0]
    if len(row_indices) == 0 or len(col_indices) == 0:
        return gray

    top, bottom = int(row_indices[0]), int(row_indices[-1])
    left, right = int(col_indices[0]), int(col_indices[-1])

    pad_y = max(12, int(height * 0.015))
    pad_x = max(12, int(width * 0.015))
    top = max(0, top - pad_y)
    bottom = min(height - 1, bottom + pad_y)
    left = max(0, left - pad_x)
    right = min(width - 1, right + pad_x)

    cropped = gray[top : bottom + 1, left : right + 1]
    if cropped.size == 0:
        return gray

    crop_ratio = (cropped.shape[0] * cropped.shape[1]) / float(height * width)
    if crop_ratio > 0.98:
        return gray

    return cropped


def remove_rule_lines(gray):
    inverted = cv2.bitwise_not(gray)
    height, width = gray.shape[:2]

    vertical_len = max(25, height // 18)
    horizontal_len = max(25, width // 18)
    vertical_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, vertical_len))
    horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (horizontal_len, 1))

    vertical_lines = cv2.morphologyEx(inverted, cv2.MORPH_OPEN, vertical_kernel)
    horizontal_lines = cv2.morphologyEx(inverted, cv2.MORPH_OPEN, horizontal_kernel)
    line_mask = cv2.bitwise_or(vertical_lines, horizontal_lines)

    line_pixels = cv2.countNonZero(line_mask)
    if line_pixels == 0:
        return gray

    mask_ratio = line_pixels / float(height * width)
    if mask_ratio > 0.05:
        return gray

    line_mask = cv2.dilate(
        line_mask,
        np.ones((3, 3), dtype=np.uint8),
        iterations=1,
    )
    return cv2.inpaint(gray, line_mask, 2, cv2.INPAINT_TELEA)


def normalize_angle(angle):
    if angle < -45:
        angle += 90
    elif angle > 45:
        angle -= 90
    return angle


def rotate_image(image, angle):
    if abs(angle) < 0.3 or abs(angle) > 12:
        return image

    height, width = image.shape[:2]
    center = (width // 2, height // 2)
    matrix = cv2.getRotationMatrix2D(center, angle, 1.0)

    return cv2.warpAffine(
        image,
        matrix,
        (width, height),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=255,
    )


def estimate_skew_angle(binary_inv):
    height, width = binary_inv.shape[:2]
    lines = cv2.HoughLinesP(
        binary_inv,
        1,
        np.pi / 180.0,
        threshold=max(80, width // 6),
        minLineLength=max(80, width // 8),
        maxLineGap=max(20, width // 100),
    )

    candidate_angles = []
    if lines is not None:
        for line in lines[:, 0]:
            x1, y1, x2, y2 = line
            angle = np.degrees(np.arctan2(y2 - y1, x2 - x1))
            angle = normalize_angle(angle)
            if abs(angle) <= 20:
                candidate_angles.append(angle)

    if len(candidate_angles) >= 5:
        return float(np.median(candidate_angles))

    coords = np.column_stack(np.where(binary_inv > 0))
    if len(coords) < 100:
        return 0.0

    angle = cv2.minAreaRect(coords)[-1]
    return float(normalize_angle(angle))


def clean_scanned_image_variants(pil_img):
    gray = pil_to_gray(pil_img)
    gray = upscale_for_ocr(gray)

    if gray.size <= 3_000_000:
        denoised = cv2.fastNlMeansDenoising(gray, None, 12, 7, 21)
    else:
        denoised = cv2.medianBlur(gray, 3)

    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
    enhanced = clahe.apply(denoised)

    background_kernel = compute_odd_kernel(min(enhanced.shape[:2]) // 20, minimum=15, maximum=61)
    background = cv2.medianBlur(enhanced, background_kernel)
    normalized = cv2.divide(enhanced, background, scale=255)

    _, binary_inv = cv2.threshold(
        normalized,
        0,
        255,
        cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU,
    )
    skew_angle = estimate_skew_angle(binary_inv)
    deskewed = rotate_image(normalized, -skew_angle)

    adaptive_block = compute_odd_kernel(min(deskewed.shape[:2]) // 16, minimum=21, maximum=41)
    adaptive = cv2.adaptiveThreshold(
        deskewed,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        adaptive_block,
        11,
    )
    adaptive = cv2.medianBlur(adaptive, 3)

    otsu = cv2.threshold(
        cv2.GaussianBlur(deskewed, (5, 5), 0),
        0,
        255,
        cv2.THRESH_BINARY + cv2.THRESH_OTSU,
    )[1]

    cleaned = remove_rule_lines(deskewed)
    cleaned = crop_to_text_region(cleaned)

    cleaned_adaptive_block = compute_odd_kernel(min(cleaned.shape[:2]) // 16, minimum=21, maximum=41)
    cleaned_adaptive = cv2.adaptiveThreshold(
        cleaned,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        cleaned_adaptive_block,
        11,
    )
    cleaned_adaptive = cv2.medianBlur(cleaned_adaptive, 3)

    cleaned_otsu = cv2.threshold(
        cv2.GaussianBlur(cleaned, (5, 5), 0),
        0,
        255,
        cv2.THRESH_BINARY + cv2.THRESH_OTSU,
    )[1]

    variants = [
        ("deskewed-grayscale", deskewed, False),
        ("adaptive-threshold", adaptive, False),
        ("otsu-threshold", otsu, False),
    ]

    if cleaned.shape != deskewed.shape or not np.array_equal(cleaned, deskewed):
        variants.extend(
            [
                ("deskewed-cleaned", cleaned, True),
                ("adaptive-cleaned", cleaned_adaptive, True),
                ("otsu-cleaned", cleaned_otsu, True),
            ]
        )

    return variants


def _prepare_paddle_image(image):
    if image is None:
        return None
    if image.ndim == 2:
        rgb = cv2.cvtColor(image, cv2.COLOR_GRAY2RGB)
    elif image.shape[2] == 4:
        rgb = cv2.cvtColor(image, cv2.COLOR_BGRA2RGB)
    else:
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    if rgb.dtype != np.uint8:
        rgb = np.clip(rgb, 0, 255).astype(np.uint8)
    return rgb


def _run_paddle_ocr_raw(image):
    engine = load_ocr_engine()
    if not PADDLE_AVAILABLE or engine is None:
        return []

    rgb = _prepare_paddle_image(image)
    if rgb is None:
        return []

    errors = []
    result = None

    predict_fn = getattr(engine, "predict", None)
    if callable(predict_fn):
        for payload in (rgb, [rgb]):
            try:
                result = predict_fn(payload)
                if result is None:
                    continue
                if not isinstance(result, (list, tuple, dict, np.ndarray)):
                    try:
                        result = list(result)
                    except Exception:
                        pass
                break
            except Exception as exc:
                errors.append(exc)

    if result is None:
        ocr_fn = getattr(engine, "ocr", None)
        if callable(ocr_fn):
            for kwargs in ({}, {"cls": False}, {"cls": True}):
                try:
                    result = ocr_fn(rgb, **kwargs)
                    if result is not None:
                        break
                except Exception as exc:
                    errors.append(exc)

    if result is None and errors:
        raise errors[-1]

    items = []
    for raw_bbox, raw_text, raw_conf in _iter_paddle_line_candidates(result):
        text = str(raw_text or "").strip()
        if not text:
            continue
        try:
            bbox = _normalize_bbox_points(raw_bbox)
        except Exception:
            continue
        try:
            conf = float(raw_conf or 0.0)
        except Exception:
            conf = 0.0
        if conf > 1.0:
            conf = conf / 100.0
        conf = max(0.0, min(1.0, conf))
        items.append((bbox, text, conf))
    return items


def _rotate_bbox_points(points, rotation, width, height):
    rotated = []
    for x, y in points:
        if rotation == 90:
            rotated.append([int(round(y)), int(round(height - 1 - x))])
        elif rotation == 180:
            rotated.append([int(round(width - 1 - x)), int(round(height - 1 - y))])
        elif rotation == 270:
            rotated.append([int(round(width - 1 - y)), int(round(x))])
        else:
            rotated.append([int(round(x)), int(round(y))])
    return rotated


def _rotate_results_to_original(results, rotation, width, height):
    if rotation not in (90, 180, 270):
        return results
    rotated = []
    for bbox, text, conf in results:
        if bbox is None:
            rotated.append((bbox, text, conf))
            continue
        rotated.append((_rotate_bbox_points(bbox, rotation, width, height), text, conf))
    return rotated


def readtext_with_fallbacks(image):
    try:
        results = _run_paddle_ocr_raw(image)
    except Exception:
        results = []

    base_score = score_ocr_results(results)
    if len(results) >= 2 and base_score >= MIN_ROTATION_TRIGGER_SCORE:
        return results

    height, width = image.shape[:2]
    best_results = results
    best_score = base_score

    for rotation, rotate_code in (
        (90, cv2.ROTATE_90_CLOCKWISE),
        (180, cv2.ROTATE_180),
        (270, cv2.ROTATE_90_COUNTERCLOCKWISE),
    ):
        try:
            rotated_image = cv2.rotate(image, rotate_code)
            rotated_results = _run_paddle_ocr_raw(rotated_image)
            rotated_results = _rotate_results_to_original(rotated_results, rotation, width, height)
            rotated_score = score_ocr_results(rotated_results)
            if rotated_score > best_score:
                best_score = rotated_score
                best_results = rotated_results
        except Exception:
            continue

    return best_results if best_score > (base_score + 1.2) else results


def bbox_bounds(bbox):
    xs = [point[0] for point in bbox]
    ys = [point[1] for point in bbox]
    return min(xs), min(ys), max(xs), max(ys)


def score_ocr_results(results):
    score = 0.0

    for _, text, conf in results:
        cleaned_text = normalize_line_text(text)
        cleaned = normalize_text(cleaned_text)
        if not cleaned:
            continue

        confidence = max(float(conf or 0.0), 0.0)
        quality = text_quality_factor(cleaned_text, confidence)
        score += max(confidence, 0.12) * min(len(cleaned), 45) * quality

    return score


def score_line_set_quality(lines):
    if not lines:
        return 0.0

    qualities = [text_quality_factor(line["text"], line["confidence"]) for line in lines]
    average_quality = float(np.mean(qualities))
    long_line_count = sum(1 for line in lines if len(normalize_text(line["text"])) >= 6)
    coverage_factor = 0.75 + 0.25 * min(1.0, long_line_count / max(1, len(lines)))
    return max(0.05, min(1.2, average_quality * coverage_factor))


def group_results_into_lines(results):
    entries = []
    for bbox, text, conf in results:
        cleaned_text = normalize_line_text(text)
        if not cleaned_text:
            continue

        confidence = float(conf or 0.0)
        if confidence < MIN_WORD_CONFIDENCE and len(normalize_text(cleaned_text)) < 6:
            continue

        left, top, right, bottom = bbox_bounds(bbox)
        height = max(bottom - top, 1)
        entries.append(
            {
                "bbox": bbox,
                "text": cleaned_text,
                "conf": confidence,
                "left_x": left,
                "right_x": right,
                "top_y": top,
                "bottom_y": bottom,
                "center_y": (top + bottom) / 2.0,
                "height": height,
            }
        )

    entries.sort(key=lambda entry: (entry["center_y"], entry["left_x"]))

    grouped = []
    for entry in entries:
        if not grouped:
            grouped.append({"entries": [entry]})
            continue

        current = grouped[-1]
        current_entries = current["entries"]
        current_center_y = np.mean([item["center_y"] for item in current_entries])
        average_height = np.mean([item["height"] for item in current_entries])
        tolerance = max(12.0, average_height * 0.65, entry["height"] * 0.65)

        if abs(entry["center_y"] - current_center_y) <= tolerance:
            current_entries.append(entry)
        else:
            grouped.append({"entries": [entry]})

    lines = []
    for group in grouped:
        line_entries = sorted(group["entries"], key=lambda entry: entry["left_x"])
        text = " ".join(entry["text"] for entry in line_entries).strip()
        if not text:
            continue

        lines.append(
            {
                "text": text,
                "left_x": min(entry["left_x"] for entry in line_entries),
                "top_y": min(entry["top_y"] for entry in line_entries),
                "bottom_y": max(entry["bottom_y"] for entry in line_entries),
                "height": max(entry["bottom_y"] for entry in line_entries)
                - min(entry["top_y"] for entry in line_entries),
                "confidence": float(np.mean([entry["conf"] for entry in line_entries])),
            }
        )

    lines.sort(key=lambda line: (line["top_y"], line["left_x"]))
    return lines


def keyword_similarity(text, keyword):
    clean_text = normalize_text(text)
    clean_keyword = normalize_text(keyword)

    if not clean_text or not clean_keyword:
        return 0.0

    if clean_keyword in clean_text:
        return 1.0

    if clean_text in clean_keyword and len(clean_text) >= max(4, len(clean_keyword) - 2):
        return len(clean_text) / len(clean_keyword)

    if len(clean_text) <= len(clean_keyword):
        return SequenceMatcher(None, clean_keyword, clean_text).ratio()

    similarity = 0.0
    window = len(clean_keyword)
    for index in range(len(clean_text) - window + 1):
        substring = clean_text[index : index + window]
        similarity = max(similarity, SequenceMatcher(None, clean_keyword, substring).ratio())
        if similarity >= 0.98:
            break

    return similarity


def find_best_keyword_line(lines, keyword):
    best_score = 0.0
    best_line = None

    for index, line in enumerate(lines):
        candidate_texts = [line["text"]]
        if index + 1 < len(lines):
            candidate_texts.append(f"{line['text']} {lines[index + 1]['text']}")

        for candidate_text in candidate_texts:
            score = keyword_similarity(candidate_text, keyword)
            if score > best_score:
                best_score = score
                best_line = line

    return best_score, best_line


def select_page_ocr_candidate(pil_img, keyword=None):
    candidates = []
    variants = clean_scanned_image_variants(pil_img)

    for index, (variant_name, clean_image, is_aggressive) in enumerate(variants):
        if index >= 2 and candidates:
            safe_candidates = [candidate for candidate in candidates if not candidate["aggressive"]]
            best_safe = max(
                safe_candidates if safe_candidates else candidates,
                key=lambda candidate: candidate["selection_score"],
            )

            if index >= 3:
                if keyword:
                    if (
                        best_safe["keyword_score"] >= KEYWORD_MATCH_THRESHOLD
                        and best_safe["line_quality"] >= 0.68
                    ):
                        break
                elif (
                    best_safe["ocr_score"] >= 55
                    and best_safe["line_quality"] >= 0.72
                    and len(best_safe["lines"]) >= 6
                ):
                    break

        results = readtext_with_fallbacks(clean_image)
        lines = group_results_into_lines(results)
        ocr_score = score_ocr_results(results)
        line_quality = score_line_set_quality(lines)
        keyword_score = 0.0
        keyword_line = None

        if keyword:
            keyword_score, keyword_line = find_best_keyword_line(lines, keyword)

        selection_score = (
            (ocr_score * line_quality)
            + (keyword_score * 120.0 if keyword else 0.0)
            + (min(len(lines), 20) * 0.8)
            - (AGGRESSIVE_VARIANT_PENALTY if is_aggressive else 0.0)
        )

        candidates.append(
            {
                "variant": variant_name,
                "image": clean_image,
                "results": results,
                "lines": lines,
                "ocr_score": ocr_score,
                "line_quality": line_quality,
                "keyword_score": keyword_score,
                "keyword_line": keyword_line,
                "aggressive": is_aggressive,
                "selection_score": selection_score,
            }
        )

        if (
            keyword
            and keyword_score >= 0.95
            and line_quality >= 0.70
            and keyword_line
        ):
            return candidates[-1]

        if (
            not keyword
            and ocr_score >= FAST_EXIT_OCR_SCORE
            and line_quality >= 0.78
            and len(lines) >= 10
            and not is_aggressive
        ):
            return candidates[-1]

    keyword_candidates = [
        candidate
        for candidate in candidates
        if keyword and candidate["keyword_score"] >= KEYWORD_MATCH_THRESHOLD
    ]
    if keyword_candidates:
        return max(keyword_candidates, key=lambda candidate: candidate["selection_score"])

    return max(candidates, key=lambda candidate: candidate["selection_score"])


def append_extracted_line(extracted_lines, line_text):
    if not line_text:
        return

    if extracted_lines and extracted_lines[-1].endswith("-"):
        extracted_lines[-1] = extracted_lines[-1][:-1] + line_text.lstrip()
        return

    extracted_lines.append(line_text)


def parse_amount(value):
    if value is None:
        return None

    cleaned = str(value).replace(",", "").strip()
    try:
        return float(cleaned)
    except ValueError:
        return None


def normalize_receipt_unit(unit):
    compact = (unit or "").upper().replace(".", "")
    aliases = {
        "PIECE": "PCS",
        "PIECES": "PCS",
        "PC": "PCS",
        "PCS": "PCS",
        "BOX": "BOX",
        "BOXES": "BOX",
        "SET": "SET",
        "SETS": "SET",
        "ROLL": "ROLL",
        "ROLLS": "ROLL",
        "KG": "KG",
        "KGS": "KG",
        "LITER": "L",
        "LITERS": "L",
        "LTR": "L",
        "L": "L",
        "METER": "M",
        "METERS": "M",
        "MTR": "M",
        "MTRS": "M",
        "UNIT": "UNIT",
        "UNITS": "UNIT",
    }
    return aliases.get(compact, compact)


def preprocess_receipt_image(image_bgr):
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    gray = upscale_for_ocr(gray)
    cleaned = remove_rule_lines(gray)
    cleaned = crop_to_text_region(cleaned)

    adaptive_block = compute_odd_kernel(min(cleaned.shape[:2]) // 16, minimum=21, maximum=41)
    adaptive = cv2.adaptiveThreshold(
        cleaned,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        adaptive_block,
        11,
    )
    adaptive = cv2.medianBlur(adaptive, 3)

    otsu = cv2.threshold(
        cv2.GaussianBlur(cleaned, (5, 5), 0),
        0,
        255,
        cv2.THRESH_BINARY + cv2.THRESH_OTSU,
    )[1]

    return [
        ("cleaned", cleaned),
        ("adaptive", adaptive),
        ("otsu", otsu),
    ]


def ocr_receipt_lines(image_bytes):
    decoded = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if decoded is None:
        raise ValueError("Unable to decode image. Please upload a valid image file.")

    candidates = []
    for variant_name, variant_image in preprocess_receipt_image(decoded):
        results = readtext_with_fallbacks(variant_image)
        lines = group_results_into_lines(results)
        filtered_lines = [
            line for line in lines if not is_noise_line(line["text"], line["confidence"])
        ]
        ocr_score = score_ocr_results(results)
        line_quality = score_line_set_quality(filtered_lines)
        selection_score = (ocr_score * line_quality) + (min(len(filtered_lines), 24) * 0.8)

        candidates.append(
            {
                "variant": variant_name,
                "lines": filtered_lines,
                "score": selection_score,
            }
        )

    if not candidates:
        return []

    best = max(candidates, key=lambda candidate: candidate["score"])
    return best["lines"]


def extract_receipt_items(lines):
    items = []
    seen = set()

    for line in lines:
        line_text = normalize_line_text(line["text"])
        if not line_text:
            continue

        uppercase_text = line_text.upper()
        if "TOTAL AMOUNT" in uppercase_text or "TOTAL ITEMS" in uppercase_text:
            continue

        quantity_match = RECEIPT_QUANTITY_RE.match(line_text)
        unit_match = RECEIPT_UNIT_RE.search(line_text)
        if not quantity_match or not unit_match:
            continue

        if unit_match.start() < quantity_match.end():
            continue

        amount_matches = list(RECEIPT_AMOUNT_RE.finditer(line_text))
        if not amount_matches:
            continue

        first_amount_start = amount_matches[0].start()
        product_start = unit_match.end()
        product_end = first_amount_start
        if product_end <= product_start:
            product_end = amount_matches[-1].start()

        product_name = normalize_line_text(line_text[product_start:product_end])
        product_name = re.sub(r"\bLESS\b", "", product_name, flags=re.IGNORECASE)
        product_name = normalize_line_text(product_name).strip(":.- ")
        if len(normalize_text(product_name)) < 2:
            continue

        quantity_value = parse_amount(quantity_match.group(1))
        total_price = parse_amount(amount_matches[-1].group(0))
        if quantity_value is None or total_price is None:
            continue

        quantity = int(quantity_value) if float(quantity_value).is_integer() else round(quantity_value, 3)
        unit = normalize_receipt_unit(unit_match.group(1))

        signature = (
            str(quantity),
            unit,
            normalize_text(product_name),
            f"{total_price:.2f}",
        )
        if signature in seen:
            continue
        seen.add(signature)

        items.append(
            {
                "quantity": quantity,
                "unit": unit,
                "product_name": product_name,
                "total_price": round(total_price, 2),
                "source_line": line_text,
            }
        )

    return items


def detect_receipt_total(lines):
    for line in lines:
        text = normalize_line_text(line["text"])
        total_match = RECEIPT_TOTAL_LINE_RE.search(text)
        if total_match:
            amount = parse_amount(total_match.group(1))
            if amount is not None:
                return round(amount, 2)

    for line in lines:
        text = normalize_line_text(line["text"])
        if "TOTAL" not in text.upper():
            continue
        amount_matches = list(RECEIPT_AMOUNT_RE.finditer(text))
        if amount_matches:
            amount = parse_amount(amount_matches[-1].group(0))
            if amount is not None:
                return round(amount, 2)

    return None


@app.post("/extract-smart")
async def extract_smart(
    file: UploadFile = File(...),
    keyword: str = Form(...),
):
    try:
        pdf_bytes = await file.read()

        info = pdfinfo_from_bytes(pdf_bytes)
        total_pages = info["Pages"]
        clean_keyword = keyword.strip()
        if not clean_keyword:
            return {"error": "Keyword is required."}

        found_keyword = False
        extracted_lines = []
        keyword_page = -1
        keyword_bottom_y = -1
        started_paragraph = False
        last_bottom_y = 0
        last_line_height = 0
        final_clean_image = None

        for page_num in range(1, total_pages + 1):
            images = convert_from_bytes(
                pdf_bytes,
                first_page=page_num,
                last_page=page_num,
                dpi=OCR_DPI,
            )

            if not images:
                continue

            page_candidate = select_page_ocr_candidate(
                images[0],
                keyword=clean_keyword if not found_keyword else None,
            )
            page_lines = page_candidate["lines"]

            if (
                not found_keyword
                and page_candidate["keyword_score"] >= KEYWORD_MATCH_THRESHOLD
                and page_candidate["keyword_line"]
            ):
                found_keyword = True
                keyword_page = page_num
                keyword_bottom_y = page_candidate["keyword_line"]["bottom_y"]
                final_clean_image = page_candidate["image"]

            if found_keyword:
                stop_extraction = False

                for line in page_lines:
                    top_y = line["top_y"]
                    bottom_y = line["bottom_y"]
                    line_height = max(line["height"], 1)
                    line_text = normalize_line_text(line["text"])
                    line_confidence = float(line["confidence"] or 0.0)

                    if is_noise_line(line_text, line_confidence):
                        continue

                    if page_num == keyword_page and top_y <= keyword_bottom_y + 5:
                        continue

                    if not started_paragraph:
                        append_extracted_line(extracted_lines, line_text)
                        last_bottom_y = bottom_y
                        last_line_height = line_height
                        started_paragraph = True
                        continue

                    gap = top_y - last_bottom_y
                    if gap > max(line_height * 1.6, last_line_height * 1.6, 20):
                        stop_extraction = True
                        break

                    append_extracted_line(extracted_lines, line_text)
                    last_bottom_y = bottom_y
                    last_line_height = line_height

                if stop_extraction:
                    break

                started_paragraph = False

        if not found_keyword:
            return {"error": f"Keyword '{keyword}' not found in the entire document."}

        if not extracted_lines:
            return {"text": f"Found '{keyword}', but no text was below it."}

        _, buffer = cv2.imencode(".png", np.ascontiguousarray(final_clean_image))
        img_base64 = base64.b64encode(buffer).decode("utf-8")

        return {
            "text": "\n".join(extracted_lines),
            "page_found": keyword_page,
            "cleaned_image": f"data:image/png;base64,{img_base64}",
        }

    except Exception as exc:
        return {"error": str(exc)}


@app.post("/extract-receipt")
async def extract_receipt(file: UploadFile = File(...)):
    content_type = (file.content_type or "").lower().strip()
    if not IMAGE_CONTENT_TYPE_RE.match(content_type):
        raise HTTPException(status_code=400, detail="Only image uploads are allowed.")

    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Uploaded image is empty.")

    try:
        lines = ocr_receipt_lines(image_bytes)
        extracted_text = "\n".join(line["text"] for line in lines)
        parsed_items = extract_receipt_items(lines)
        total_amount = detect_receipt_total(lines)

        return {
            "text": extracted_text,
            "items": parsed_items,
            "total_amount": total_amount,
            "line_count": len(lines),
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Receipt extraction failed: {exc}") from exc
