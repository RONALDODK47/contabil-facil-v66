"""
Servidor local de extração de extratos bancários em PDF (texto nativo + OCR Tesseract).

Endpoints:
  GET  /health                    - status do servidor e disponibilidade de OCR
  POST /preview                   - lê o PDF e devolve linhas/colunas brutas para mapeamento
  POST /extract                   - aplica o mapeamento de colunas e devolve os lançamentos
  GET  /layouts                   - lista os layouts (bancos) que o OCR já aprendeu
  GET  /layouts/{fingerprint}/thumb.png - miniatura da página usada para reconhecer o layout
"""
from __future__ import annotations

# ── Força stdout/stderr UTF-8 ANTES de qualquer import do uvicorn/fastapi ──
# O uvicorn usa o codec padrão do Windows (cp1252) para logar o nome do
# arquivo enviado. Se o nome contiver Ç, Õ, →, etc., lança UnicodeEncodeError
# antes mesmo de processar o PDF.
import sys
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
if hasattr(sys.stderr, "reconfigure"):
    try:
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

import hashlib
import io
import json
import logging
import os
import re
import shutil
import traceback
from datetime import datetime
from pathlib import Path
from typing import Optional

import fitz  # PyMuPDF
import numpy as np
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from PIL import Image, ImageDraw

BASE_DIR = Path(__file__).resolve().parent
LAYOUTS_DIR = BASE_DIR / "layouts"
LAYOUTS_DIR.mkdir(exist_ok=True)

# ─── Logger com arquivo de saída UTF-8 ────────────────────────────────────────
_LOG_FILE = BASE_DIR / "servico.err.log"
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(str(_LOG_FILE), encoding="utf-8"),
        logging.StreamHandler(sys.stderr),
    ],
)
_log = logging.getLogger("ocr_server")

app = FastAPI(title="Contábil Fácil - OCR de Extratos")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Tesseract (opcional) ───────────────────────────────────────────────────

_TESSERACT_READY = False
_TESSERACT_LANG = "eng"
try:
    import pytesseract

    _candidates = [
        os.environ.get("TESSERACT_CMD", ""),
        shutil.which("tesseract") or "",
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    ]
    for _cand in _candidates:
        if _cand and Path(_cand).exists():
            pytesseract.pytesseract.tesseract_cmd = _cand
            break
    try:
        pytesseract.get_tesseract_version()
        _TESSERACT_READY = True
        try:
            _langs = set(pytesseract.get_languages(config=""))
        except Exception:
            _langs = set()
        if "por" in _langs and "eng" in _langs:
            _TESSERACT_LANG = "por+eng"
        elif "por" in _langs:
            _TESSERACT_LANG = "por"
        elif "eng" in _langs:
            _TESSERACT_LANG = "eng"
        elif _langs:
            _TESSERACT_LANG = sorted(_langs)[0]
    except Exception:
        _TESSERACT_READY = False
except ImportError:
    pytesseract = None  # type: ignore


# ─── extração de palavras (texto nativo ou OCR) ────────────────────────────

class Word:
    __slots__ = ("text", "x0", "y0", "x1", "y1")

    def __init__(self, text: str, x0: float, y0: float, x1: float, y1: float):
        self.text = text
        self.x0, self.y0, self.x1, self.y1 = x0, y0, x1, y1


def _sanitize(text: str) -> str:
    """Garante que a string pode ser serializada/logada sem UnicodeEncodeError no Windows."""
    return text.encode("utf-8", errors="replace").decode("utf-8", errors="replace")


def _words_from_native_page(page: "fitz.Page") -> list[Word]:
    words = []
    for w in page.get_text("words"):
        x0, y0, x1, y1, text = w[0], w[1], w[2], w[3], w[4]
        text = _sanitize(str(text)).strip()
        if text:
            words.append(Word(text, x0, y0, x1, y1))
    return words


def _page_to_image(page: "fitz.Page", zoom: float = 2.6) -> Image.Image:
    mat = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=mat, alpha=False)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def _words_from_ocr_page(page: "fitz.Page", zoom: float = 2.6) -> list[Word]:
    if not _TESSERACT_READY:
        return []
    img = _page_to_image(page, zoom=zoom)
    data = pytesseract.image_to_data(img, lang=_TESSERACT_LANG, output_type=pytesseract.Output.DICT)
    words = []
    n = len(data.get("text", []))
    for i in range(n):
        text = _sanitize((data["text"][i] or "").strip())
        if not text:
            continue
        conf = data.get("conf", ["-1"])[i]
        try:
            if float(conf) < 0:
                continue
        except (TypeError, ValueError):
            pass
        x, y, w, h = data["left"][i], data["top"][i], data["width"][i], data["height"][i]
        words.append(Word(text, float(x), float(y), float(x + w), float(y + h)))
    return words


def _extract_page_words(page: "fitz.Page", use_ocr: str) -> tuple[list[Word], str]:
    """Retorna (palavras, modo) onde modo é 'nativo' ou 'ocr'."""
    if use_ocr != "yes":
        native = _words_from_native_page(page)
        if native or use_ocr == "no":
            return native, "nativo"
    ocr_words = _words_from_ocr_page(page)
    return ocr_words, "ocr"


# ─── agrupamento em linhas/colunas ──────────────────────────────────────────

def _group_into_lines(words: list[Word], y_tol: float = 4.0) -> list[list[Word]]:
    if not words:
        return []
    sorted_words = sorted(words, key=lambda w: (w.y0, w.x0))
    lines: list[list[Word]] = []
    current: list[Word] = [sorted_words[0]]
    current_y = sorted_words[0].y0
    for w in sorted_words[1:]:
        if abs(w.y0 - current_y) <= y_tol:
            current.append(w)
        else:
            lines.append(sorted(current, key=lambda ww: ww.x0))
            current = [w]
            current_y = w.y0
    lines.append(sorted(current, key=lambda ww: ww.x0))
    return lines


def _detect_columns(lines: list[list[Word]], max_cols: int = 8) -> list[float]:
    starts = sorted(w.x0 for line in lines for w in line)
    if not starts:
        return []
    gaps: list[tuple[float, float]] = []
    for a, b in zip(starts, starts[1:]):
        if b - a > 18:
            gaps.append((a, b))
    gaps.sort(key=lambda g: g[1] - g[0], reverse=True)
    cut_points = sorted(((a + b) / 2 for a, b in gaps[: max_cols - 1]))
    return [starts[0] - 1.0, *cut_points, starts[-1] + 10_000.0]


def _bucketize(lines: list[list[Word]], bounds: list[float]) -> list[list[str]]:
    n_cols = max(len(bounds) - 1, 1)
    rows: list[list[str]] = []
    for line in lines:
        cells = ["" for _ in range(n_cols)]
        for w in line:
            col = 0
            for i in range(n_cols):
                if bounds[i] <= w.x0 < bounds[i + 1]:
                    col = i
                    break
            cells[col] = (cells[col] + " " + w.text).strip() if cells[col] else w.text
        if any(c.strip() for c in cells):
            rows.append(cells)
    return rows


# ─── layout dedicado: extrato CAIXA app/internet banking ──────────────────

CAIXA_APP_FINGERPRINT = "caixa_app_extrato_v1"

CAIXA_APP_BANDS: list[tuple[str, float, float]] = [
    ("data",       0.030, 0.135),
    ("hora",       0.135, 0.205),
    ("nrdoc",      0.205, 0.265),
    ("historico",  0.265, 0.510),
    ("favorecido", 0.510, 0.645),
    ("cpf",        0.645, 0.740),
    ("valor",      0.740, 0.815),
    ("saldo",      0.815, 0.970),
]


def _is_caixa_app_layout(words: list[Word]) -> bool:
    joined = " ".join(w.text for w in words[:60]).upper()
    has_caixa = "CAIXA" in joined
    has_periodo = "PERIODO" in joined or "PERÍODO" in joined
    has_lancamentos = any(k in joined for k in ("LANGAMENTOS", "LANÇAMENTOS", "LANCAMENTOS"))
    return has_caixa and has_periodo and has_lancamentos


def _bucketize_caixa(lines: list[list[Word]], img_width: float) -> list[dict[str, str]]:
    out = []
    for line in lines:
        cells: dict[str, str] = {label: "" for label, _, _ in CAIXA_APP_BANDS}
        for w in line:
            xfrac = w.x0 / img_width if img_width else 0.0
            label = None
            for band_label, start, end in CAIXA_APP_BANDS:
                if start <= xfrac < end:
                    label = band_label
                    break
            if label is None:
                continue
            cells[label] = (cells[label] + " " + w.text).strip() if cells[label] else w.text
        if any(v.strip() for v in cells.values()):
            out.append(cells)
    return out


# Corrige confusões comuns do Tesseract em campos numéricos
_OCR_DIGIT_MAP = str.maketrans("$OolIBSG", "50011856")


def _fix_ocr_digits(text: str) -> str:
    return text.translate(_OCR_DIGIT_MAP)


def _parse_caixa_valor(raw: str) -> tuple[Optional[float], Optional[str]]:
    """Extrai número e natureza (D/C) aplicando correção de OCR."""
    text = _fix_ocr_digits(raw.strip())
    if not text:
        return None, None
    m = re.search(r"([\d.]*\d[\d.]*,\d{2})\s*([DCdc])?", text)
    if not m:
        return None, None
    number, letter = m.group(1), m.group(2)
    try:
        value = float(number.replace(".", "").replace(",", "."))
    except ValueError:
        return None, None
    natureza = letter.upper() if letter else None
    return value, natureza


CAIXA_HEADER_REDACT_BOXES = [
    (430, 268, 900, 300),
    (430, 315, 720, 345),
    (430, 361, 640, 391),
    (1250, 505, 1385, 537),
]
CAIXA_HEADER_CROP_HEIGHT = 630

# Perfis de tarjamento por banco (frações 0–1 da página)
REDACT_PROFILES: dict[str, dict] = {
    "SICREDI": {
        "crop": 0.270,
        "boxes": [
            (0.160, 0.148, 0.960, 0.172),
            (0.160, 0.172, 0.500, 0.200),
            (0.720, 0.260, 0.980, 0.280),
        ],
    },
}


def _redact_profile_for_bank(banco_nome: str) -> Optional[dict]:
    key = re.sub(r"[^A-Z]", "", (banco_nome or "").upper())
    for name, profile in REDACT_PROFILES.items():
        if name and name in key:
            return profile
    return None


def _build_layout_thumbnail(
    doc: "fitz.Document",
    is_caixa: bool,
    banco_nome: str = "",
    is_sicredi: bool = False,
) -> Optional[Image.Image]:
    if doc.page_count == 0:
        return None
    full = _page_to_image(doc[0], zoom=2.6)

    if is_caixa:
        crop = full.crop((0, 0, full.width, min(CAIXA_HEADER_CROP_HEIGHT, full.height)))
        draw = ImageDraw.Draw(crop)
        for x0, y0, x1, y1 in CAIXA_HEADER_REDACT_BOXES:
            draw.rectangle((x0, y0, x1, min(y1, crop.height)), fill=(255, 255, 255))
        return crop

    effective_banco = "Sicredi" if is_sicredi else banco_nome
    profile = _redact_profile_for_bank(effective_banco)
    if profile:
        crop_h = int(full.height * float(profile["crop"]))
        crop = full.crop((0, 0, full.width, crop_h))
        draw = ImageDraw.Draw(crop)
        for fx0, fy0, fx1, fy1 in profile["boxes"]:
            draw.rectangle(
                (
                    int(full.width * fx0),
                    int(full.height * fy0),
                    int(full.width * fx1),
                    min(int(full.height * fy1), crop.height),
                ),
                fill=(255, 255, 255),
            )
        return crop

    crop_h = int(full.height * 0.30)
    return full.crop((0, 0, full.width, crop_h))


# Palavras-chave que identificam linhas de saldo — não são lançamentos
_SALDO_KEYWORDS = {"SALDO ANTERIOR", "SALDO DIARIO", "SALDO DIÁRIO", "SALDO DIA", "SALDO FINAL", "SALDO INICIAL"}


def _is_saldo_line(historico: str) -> bool:
    h = historico.upper().strip()
    return any(kw in h for kw in _SALDO_KEYWORDS)


def _rows_from_caixa_app_pdf(doc: "fitz.Document", max_rows: int, max_pages: Optional[int] = None) -> tuple[list[list[str]], int, dict]:
    """Produz linhas limpas: [Data, Histórico, Débito, Crédito, Complemento]."""
    clean_rows: list[list[str]] = []
    for page_idx, page in enumerate(doc):
        if max_pages is not None and page_idx >= max_pages:
            break
        words = _words_from_ocr_page(page)
        if not words:
            continue
        img_width = page.rect.width * 2.6
        lines = _group_into_lines(words, y_tol=10.0)
        for row in _bucketize_caixa(lines, img_width):
            data_match = re.search(r"\d{2}/\d{2}/\d{4}", row["data"])
            if not data_match:
                continue
            data_raw = data_match.group(0)
            valor, natureza = _parse_caixa_valor(row["valor"])
            if valor is None or valor == 0 or natureza not in ("D", "C"):
                continue
            historico = row["historico"].strip()
            if _is_saldo_line(historico):
                continue
            complemento = " ".join(p for p in (row["favorecido"].strip(), row["cpf"].strip()) if p).strip()
            debito = f"{valor:.2f}".replace(".", ",") if natureza == "D" else ""
            credito = f"{valor:.2f}".replace(".", ",") if natureza == "C" else ""
            clean_rows.append([data_raw, historico, debito, credito, complemento])
            if len(clean_rows) >= max_rows:
                break
        if len(clean_rows) >= max_rows:
            break

    stats = {"paginas": doc.page_count, "linhas": len(clean_rows), "modo": "ocr (layout CAIXA reconhecido)"}
    return clean_rows, 5, stats


# ─── layout dedicado: extrato Sicredi (PDF escaneado) ─────────────────────

SICREDI_FINGERPRINT = "sicredi_extrato_v1"

SICREDI_BANDS: list[tuple[str, float, float]] = [
    ("data",      0.090, 0.175),
    ("descricao", 0.175, 0.614),
    ("documento", 0.614, 0.750),
    ("valor",     0.750, 0.862),
    ("saldo",     0.862, 1.000),
]

_SICREDI_COMPLEMENTO_X_MIN = 0.430
_SICREDI_COMPLEMENTO_X_MAX = 0.614


def _is_sicredi_layout(words: list[Word]) -> bool:
    joined = " ".join(w.text for w in words[:80]).upper()
    return "SICREDI" in joined and ("EXTRATO" in joined or "PERIODO" in joined or "PERÍODO" in joined)


def _parse_sicredi_valor(raw: str) -> tuple[Optional[float], Optional[str]]:
    text = _fix_ocr_digits(raw.strip())
    if not text:
        return None, None
    negative = text.startswith("-") or "(" in text
    m = re.search(r"([\d.]*\d[\d.]*,\d{2})", text)
    if not m:
        return None, None
    try:
        value = float(m.group(1).replace(".", "").replace(",", "."))
    except ValueError:
        return None, None
    if value == 0:
        return None, None
    return value, ("D" if negative else "C")


def _rows_from_sicredi_pdf(doc: "fitz.Document", max_rows: int, max_pages: Optional[int] = None) -> tuple[list[list[str]], int, dict]:
    """Produz linhas limpas: [Data, Histórico, Débito, Crédito, Complemento]."""
    clean_rows: list[list[str]] = []
    _ZOOM = 1.4  # escaneado já tem boa resolução — zoom menor = OCR 3x mais rápido
    for page_idx, page in enumerate(doc):
        if max_pages is not None and page_idx >= max_pages:
            break
        words = _words_from_ocr_page(page, zoom=_ZOOM)
        if not words:
            continue
        img_width = page.rect.width * _ZOOM
        lines = _group_into_lines(words, y_tol=15.0)

        bucketed: list[dict[str, str]] = []
        for line in lines:
            cells: dict[str, str] = {label: "" for label, _, _ in SICREDI_BANDS}
            comp_parts: list[str] = []
            for w in line:
                xfrac = w.x0 / img_width if img_width else 0.0
                placed = False
                for label, s, e in SICREDI_BANDS:
                    if s <= xfrac < e:
                        cells[label] = (cells[label] + " " + w.text).strip() if cells[label] else w.text
                        placed = True
                        break
                if not placed and _SICREDI_COMPLEMENTO_X_MIN <= xfrac < _SICREDI_COMPLEMENTO_X_MAX:
                    comp_parts.append(w.text)
            cells["_comp"] = " ".join(comp_parts).strip()
            bucketed.append(cells)

        groups: list[list[dict]] = []
        cur: list[dict] = []
        for cells in bucketed:
            if re.search(r"\d{2}/\d{2}/\d{4}", cells["data"]):
                if cur:
                    groups.append(cur)
                cur = [cells]
            elif cur:
                cur.append(cells)
        if cur:
            groups.append(cur)

        for group in groups:
            first = group[0]
            dm = re.search(r"\d{2}/\d{2}/\d{4}", first["data"])
            if not dm:
                continue
            historico = first["descricao"].strip()
            if _is_saldo_line(historico):
                continue

            valor_raw, doc_num, comp_parts = "", "", []
            if first["_comp"]:
                comp_parts.append(first["_comp"])

            for extra in group[1:]:
                if extra["valor"] and not valor_raw:
                    valor_raw = extra["valor"]
                if extra["documento"] and not doc_num:
                    doc_num = extra["documento"]
                if extra["_comp"]:
                    comp_parts.append(extra["_comp"])
                if extra["descricao"] and not re.search(r"\d{2}/\d{2}/\d{4}", extra["data"]):
                    comp_parts.append(extra["descricao"])

            if not valor_raw:
                continue

            valor, natureza = _parse_sicredi_valor(valor_raw)
            if valor is None or natureza not in ("D", "C"):
                continue

            complemento = " ".join(p for p in comp_parts if p).strip()
            if doc_num:
                complemento = (doc_num + " " + complemento).strip() if complemento else doc_num

            debito = ("%.2f" % valor).replace(".", ",") if natureza == "D" else ""
            credito = ("%.2f" % valor).replace(".", ",") if natureza == "C" else ""
            clean_rows.append([dm.group(0), historico, debito, credito, complemento])
            if len(clean_rows) >= max_rows:
                break
        if len(clean_rows) >= max_rows:
            break

    stats = {"paginas": doc.page_count, "linhas": len(clean_rows), "modo": "ocr (layout Sicredi reconhecido)"}
    return clean_rows, 5, stats


# Assinaturas de bytes para detecção de formato de imagem
_IMAGE_MAGIC: list[tuple[bytes, str]] = [
    (b"\x89PNG",    "png"),
    (b"\xff\xd8",   "jpeg"),
    (b"GIF8",       "gif"),
    (b"RIFF",       "webp"),  # RIFF....WEBP
    (b"BM",         "bmp"),
    (b"\x00\x00\x01\x00", "ico"),
    (b"II*\x00",    "tiff"),
    (b"MM\x00*",    "tiff"),
]


def _is_image_bytes(data: bytes) -> bool:
    """Retorna True se os bytes correspondem a uma imagem (não PDF)."""
    for magic, _ in _IMAGE_MAGIC:
        if data[:len(magic)] == magic:
            return True
    return False


# Mapa de assinatura → filetype aceito pelo fitz
_IMAGE_MAGIC_FITZ: list[tuple[bytes, str]] = [
    (b"\x89PNG",    "png"),
    (b"\xff\xd8",   "jpeg"),
    (b"GIF8",       "gif"),
    (b"II*\x00",    "tiff"),
    (b"MM\x00*",    "tiff"),
    (b"BM",         "bmp"),
]


def _image_bytes_to_pdf_doc(image_bytes: bytes) -> "fitz.Document":
    """Converte bytes de imagem (PNG/JPEG/etc.) em fitz.Document de uma página.

    Tenta abrir via fitz diretamente (mais eficiente/fiel).
    Cai para PIL como fallback se o fitz não reconhecer o formato.
    """
    # Detecta o filetype para o fitz
    fitz_type: Optional[str] = None
    for magic, ft in _IMAGE_MAGIC_FITZ:
        if image_bytes[:len(magic)] == magic:
            fitz_type = ft
            break

    if fitz_type:
        try:
            return fitz.open(stream=image_bytes, filetype=fitz_type)
        except Exception:
            pass  # fallback para PIL abaixo

    # Fallback: PIL converte para PDF
    img = Image.open(io.BytesIO(image_bytes))
    img_rgb = img.convert("RGB")
    buf = io.BytesIO()
    img_rgb.save(buf, format="PDF")
    buf.seek(0)
    return fitz.open(stream=buf.read(), filetype="pdf")


def _rows_from_pdf(
    pdf_bytes: bytes,
    use_ocr: str,
    max_rows: int,
    max_pages: Optional[int] = None,
) -> tuple[list[list[str]], int, dict, "fitz.Document"]:
    # Suporte a arquivos de imagem (PNG, JPEG, etc.) enviados diretamente
    if _is_image_bytes(pdf_bytes):
        doc = _image_bytes_to_pdf_doc(pdf_bytes)
        # Imagens de extrato são sempre escaneadas — força OCR
        use_ocr = "yes"
    else:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")

    if use_ocr != "no" and doc.page_count > 0:
        first_words = _words_from_native_page(doc[0]) or _words_from_ocr_page(doc[0], zoom=1.4)
        if _is_caixa_app_layout(first_words):
            rows, n_cols, stats = _rows_from_caixa_app_pdf(doc, max_rows, max_pages=max_pages)
            return rows, n_cols, stats, doc
        if _is_sicredi_layout(first_words):
            rows, n_cols, stats = _rows_from_sicredi_pdf(doc, max_rows, max_pages=max_pages)
            return rows, n_cols, stats, doc

    all_lines: list[list[Word]] = []
    modes_used: set[str] = set()
    for page_idx, page in enumerate(doc):
        if max_pages is not None and page_idx >= max_pages:
            break
        words, mode = _extract_page_words(page, use_ocr)
        modes_used.add(mode)
        all_lines.extend(_group_into_lines(words))
        if len(all_lines) >= max_rows:
            break

    bounds = _detect_columns(all_lines)
    rows = _bucketize(all_lines, bounds)[:max_rows]
    n_cols = max(len(bounds) - 1, 1)
    stats = {
        "paginas": doc.page_count,
        "linhas": len(rows),
        "modo": "ocr" if modes_used == {"ocr"} else ("misto" if len(modes_used) > 1 else "texto nativo"),
    }
    return rows, n_cols, stats, doc


# ─── parsing de valores/datas ───────────────────────────────────────────────

_DATE_PATTERNS = [
    (re.compile(r"^(\d{2})/(\d{2})/(\d{4})$"), "%d/%m/%Y"),
    (re.compile(r"^(\d{2})/(\d{2})/(\d{2})$"), "%d/%m/%y"),
    (re.compile(r"^(\d{4})-(\d{2})-(\d{2})$"), "%Y-%m-%d"),
    (re.compile(r"^(\d{2})-(\d{2})-(\d{4})$"), "%d-%m-%Y"),
]


def _parse_date(raw: str) -> Optional[str]:
    text = raw.strip()
    m = re.search(r"\d{2}/\d{2}/\d{4}|\d{2}/\d{2}/\d{2}|\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4}", text)
    if not m:
        return None
    token = m.group(0)
    for pattern, fmt in _DATE_PATTERNS:
        if pattern.match(token):
            try:
                dt = datetime.strptime(token, fmt)
                if dt.year < 100:
                    dt = dt.replace(year=dt.year + 2000)
                return dt.strftime("%d/%m/%Y")
            except ValueError:
                continue
    return None


def _parse_valor(raw: str) -> Optional[float]:
    text = raw.strip()
    if not text:
        return None
    negative = "-" in text or "(" in text or re.search(r"\bD\b", text, re.IGNORECASE) is not None and False
    cleaned = re.sub(r"[^0-9,.\-]", "", text)
    if not cleaned or not re.search(r"\d", cleaned):
        return None
    cleaned = cleaned.replace(".", "").replace(",", ".") if "," in cleaned else cleaned
    try:
        value = abs(float(cleaned))
    except ValueError:
        return None
    return -value if negative else value


# ─── fingerprint / layouts aprendidos ───────────────────────────────────────

def _text_fingerprint(doc: "fitz.Document") -> Optional[str]:
    if doc.page_count == 0:
        return None
    try:
        text = _sanitize(doc[0].get_text("text") or "")
    except Exception:
        return None
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    header = lines[:12]
    if not header:
        return None
    normalized = []
    for ln in header:
        ln = re.sub(r"\d", "#", ln)
        ln = re.sub(r"\s+", " ", ln).strip().upper()
        normalized.append(ln)
    joined = "|".join(normalized)
    return "t_" + hashlib.sha1(joined.encode("utf-8")).hexdigest()[:20]


def _image_fingerprint(img: Image.Image) -> str:
    small = img.convert("L").resize((16, 16), Image.LANCZOS)
    arr = np.asarray(small, dtype=np.float32)
    avg = arr.mean()
    bits = (arr > avg).flatten()
    bit_str = "".join("1" if b else "0" for b in bits)
    packed = int(bit_str, 2).to_bytes(32, "big")
    return "i_" + hashlib.sha1(packed).hexdigest()[:20]


def _fingerprint(doc: "fitz.Document", stats: Optional[dict] = None) -> str:
    if stats is not None and str(stats.get("modo", "")).startswith("ocr (layout CAIXA"):
        return CAIXA_APP_FINGERPRINT
    if stats is not None and str(stats.get("modo", "")).startswith("ocr (layout Sicredi"):
        return SICREDI_FINGERPRINT
    fp = _text_fingerprint(doc)
    if fp:
        return fp
    thumb = _page_to_image(doc[0], zoom=1.0)
    return _image_fingerprint(thumb)


def _layout_dir(fingerprint: str) -> Path:
    safe = re.sub(r"[^a-zA-Z0-9_\-]", "_", fingerprint)
    d = LAYOUTS_DIR / safe
    d.mkdir(parents=True, exist_ok=True)
    return d


def _load_layout(fingerprint: str) -> Optional[dict]:
    d = _layout_dir(fingerprint)
    meta_path = d / "meta.json"
    if not meta_path.exists():
        return None
    try:
        return json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _save_layout(fingerprint: str, meta: dict, thumb: Optional[Image.Image]) -> None:
    d = _layout_dir(fingerprint)
    meta_path = d / "meta.json"
    existing = _load_layout(fingerprint) or {}
    times_used = int(existing.get("times_used", 0)) + 1
    payload = {
        **existing,
        **meta,
        "fingerprint": fingerprint,
        "times_used": times_used,
        "updated_at": datetime.now().isoformat(timespec="seconds"),
    }
    meta_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    if thumb is not None:
        thumb_small = thumb.copy()
        thumb_small.thumbnail((640, 640))
        thumb_small.save(d / "thumb.png")


# ─── endpoints ───────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "bank-pdf-extract",
        "ocr_disponivel": _TESSERACT_READY,
        "ocr_idioma": _TESSERACT_LANG if _TESSERACT_READY else None,
        "layouts_aprendidos": len(list(LAYOUTS_DIR.glob("*/meta.json"))),
    }


@app.post("/preview")
async def preview(
    file: UploadFile = File(...),
    max_rows: int = Form(400),
    use_ocr: str = Form("auto"),
    max_pages: int = Form(3),
):
    pdf_bytes = await file.read()
    fname = _sanitize(file.filename or "")
    _log.info("preview: arquivo=%s tamanho=%d use_ocr=%s", fname, len(pdf_bytes), use_ocr)
    try:
        rows, n_cols, stats, doc = _rows_from_pdf(pdf_bytes, use_ocr, max_rows, max_pages=max_pages)
        _log.info("preview ok: linhas=%d modo=%s", len(rows), stats.get("modo"))
        fingerprint = _fingerprint(doc, stats)
        learned = _load_layout(fingerprint)
        is_caixa = fingerprint == CAIXA_APP_FINGERPRINT
        is_sicredi = fingerprint == SICREDI_FINGERPRINT
        doc.close()
    except Exception as exc:
        tb = traceback.format_exc()
        _log.error("ERRO /preview:\n%s", tb)
        err = _sanitize(str(exc))
        return JSONResponse({"error": f"Falha ao processar o PDF. Detalhe: {err}", "traceback": tb}, status_code=200)

    learned_payload = None
    if learned:
        has_thumb = (LAYOUTS_DIR / re.sub(r"[^a-zA-Z0-9_\-]", "_", fingerprint) / "thumb.png").exists()
        learned_payload = {
            "found": True,
            "fingerprint": fingerprint,
            "banco_nome": learned.get("banco_nome", ""),
            "conta_banco": learned.get("conta_banco", ""),
            "column_map": learned.get("column_map", {}),
            "skip_header_rows": learned.get("skip_header_rows", 0),
            "times_used": learned.get("times_used", 0),
            "thumbnail_url": f"/layouts/{fingerprint}/thumb.png" if has_thumb else None,
        }
    elif is_caixa:
        learned_payload = {
            "found": True,
            "fingerprint": fingerprint,
            "banco_nome": "Caixa Econômica Federal (App/Internet Banking)",
            "conta_banco": "",
            "column_map": {"date_col": 0, "historico_col": 1, "debito_col": 2, "credito_col": 3, "complemento_col": 4},
            "skip_header_rows": 0,
            "times_used": 0,
            "thumbnail_url": None,
        }
    elif is_sicredi:
        learned_payload = {
            "found": True,
            "fingerprint": fingerprint,
            "banco_nome": "Sicredi",
            "conta_banco": "",
            "column_map": {"date_col": 0, "historico_col": 1, "debito_col": 2, "credito_col": 3, "complemento_col": 4},
            "skip_header_rows": 0,
            "times_used": 0,
            "thumbnail_url": None,
        }

    if not rows and not _TESSERACT_READY and stats.get("modo") != "texto nativo":
        stats["aviso"] = (
            "PDF sem texto selecionável e Tesseract OCR não encontrado nesta máquina. "
            "Instale o Tesseract-OCR (https://github.com/UB-Mannheim/tesseract/wiki) "
            "ou defina a variável TESSERACT_CMD com o caminho do executável."
        )

    return {"rows": rows, "columns": n_cols, "stats": stats, "fingerprint": fingerprint, "learned": learned_payload}


@app.post("/extract")
async def extract(
    file: UploadFile = File(...),
    date_col: int = Form(...),
    historico_col: int = Form(...),
    debito_col: int = Form(-1),
    credito_col: int = Form(-1),
    complemento_col: int = Form(-1),
    skip_header_rows: int = Form(0),
    use_ocr: str = Form("auto"),
    max_rows: int = Form(20000),
    banco_nome: str = Form(""),
    conta_banco: str = Form(""),
):
    pdf_bytes = await file.read()
    fname = _sanitize(file.filename or "")
    _log.info("extract: arquivo=%s tamanho=%d", fname, len(pdf_bytes))
    try:
        rows, _n_cols, stats, doc = _rows_from_pdf(pdf_bytes, use_ocr, max_rows)
        _log.info("extract rows ok: linhas=%d modo=%s", len(rows), stats.get("modo"))
    except Exception as exc:
        tb = traceback.format_exc()
        _log.error("ERRO /extract:\n%s", tb)
        err = _sanitize(str(exc))
        return JSONResponse({"error": f"Falha ao ler o PDF: {err}", "traceback": tb}, status_code=200)

    records = []
    for row in rows[skip_header_rows:]:
        data_raw = row[date_col] if 0 <= date_col < len(row) else ""
        historico_raw = row[historico_col] if 0 <= historico_col < len(row) else ""
        debito_raw = row[debito_col] if 0 <= debito_col < len(row) else ""
        credito_raw = row[credito_col] if 0 <= credito_col < len(row) else ""
        complemento_raw = row[complemento_col] if 0 <= complemento_col < len(row) else ""

        if _is_saldo_line(historico_raw):
            continue

        data = _parse_date(data_raw)
        valor_debito = _parse_valor(debito_raw) if debito_raw else None
        valor_credito = _parse_valor(credito_raw) if credito_raw else None

        if not data or (valor_debito is None and valor_credito is None):
            continue
        if valor_debito is not None and valor_debito == 0:
            valor_debito = None
        if valor_credito is not None and valor_credito == 0:
            valor_credito = None
        if valor_debito is None and valor_credito is None:
            continue

        records.append({
            "data": data,
            "historico": historico_raw.strip(),
            "valor_debito": abs(valor_debito) if valor_debito is not None else None,
            "valor_credito": abs(valor_credito) if valor_credito is not None else None,
            "codigo_historico": None,
            "complemento": complemento_raw.strip() or None,
        })

    try:
        fingerprint = _fingerprint(doc, stats)
        is_caixa = fingerprint == CAIXA_APP_FINGERPRINT
        is_sicredi = fingerprint == SICREDI_FINGERPRINT
        if records:
            thumb = _build_layout_thumbnail(doc, is_caixa, banco_nome, is_sicredi)
            effective_banco = banco_nome.strip() or ("Sicredi" if is_sicredi else "")
            _save_layout(
                fingerprint,
                {
                    "banco_nome": effective_banco,
                    "conta_banco": conta_banco.strip(),
                    "column_map": {
                        "date_col": date_col, "historico_col": historico_col,
                        "debito_col": debito_col, "credito_col": credito_col,
                        "complemento_col": complemento_col,
                    },
                    "skip_header_rows": skip_header_rows,
                    "sample_file_name": file.filename,
                },
                thumb,
            )
    except Exception:
        fingerprint = "unknown"
    finally:
        doc.close()

    return {"records": records, "count": len(records), "fingerprint": fingerprint}


@app.get("/layouts")
def list_layouts():
    out = []
    for meta_path in sorted(LAYOUTS_DIR.glob("*/meta.json")):
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            continue
        fingerprint = meta.get("fingerprint") or meta_path.parent.name
        has_thumb = (meta_path.parent / "thumb.png").exists()
        out.append({
            "fingerprint": fingerprint,
            "banco_nome": meta.get("banco_nome", ""),
            "conta_banco": meta.get("conta_banco", ""),
            "times_used": meta.get("times_used", 0),
            "updated_at": meta.get("updated_at"),
            "sample_file_name": meta.get("sample_file_name"),
            "thumbnail_url": f"/layouts/{fingerprint}/thumb.png" if has_thumb else None,
        })
    out.sort(key=lambda x: x.get("updated_at") or "", reverse=True)
    return {"layouts": out}


@app.get("/layouts/{fingerprint}/thumb.png")
def layout_thumbnail(fingerprint: str):
    d = _layout_dir(fingerprint)
    thumb_path = d / "thumb.png"
    if not thumb_path.exists():
        return JSONResponse({"error": "Miniatura não encontrada."}, status_code=404)
    return FileResponse(thumb_path, media_type="image/png")
