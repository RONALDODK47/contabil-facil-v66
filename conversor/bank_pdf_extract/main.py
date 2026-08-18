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
from collections import OrderedDict
from datetime import datetime
from pathlib import Path
from typing import Optional

import fitz  # PyMuPDF
import numpy as np
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
import difflib
import unicodedata

from PIL import Image, ImageDraw, ImageOps

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
    __slots__ = ("text", "x0", "y0", "x1", "y1", "line_key")

    def __init__(self, text: str, x0: float, y0: float, x1: float, y1: float, line_key=None):
        self.text = text
        self.x0, self.y0, self.x1, self.y1 = x0, y0, x1, y1
        # (bloco, parágrafo, linha) do Tesseract, quando veio de OCR
        self.line_key = line_key


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


def _page_to_image(page: "fitz.Page", zoom: float = 2.6, autocontrast: bool = False) -> Image.Image:
    mat = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=mat, alpha=False)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    if autocontrast:
        # Extrato fotografado: a folha fica acinzentada e o contraste do toner
        # cai, apagando dígitos inteiros. Esticar a faixa tonal (escala de cinza
        # + autocontraste) recupera esses dígitos. Medido contra este extrato
        # Sicredi, é o que mais acerta — bem acima de nitidez (unsharp) e MUITO
        # acima de limiarização adaptativa, que destrói os números finos.
        img = ImageOps.autocontrast(img.convert("L"), cutoff=1)
    return img


# Palavras já lidas pelo OCR, por (conteúdo do arquivo, página, parâmetros).
# O /preview lê as primeiras páginas para o usuário conferir o mapeamento e, ao
# confirmar, o /extract lia o documento inteiro de novo — refazendo do zero o OCR
# das páginas que acabaram de ser lidas, o que fazia o botão de importar parecer
# que estava começando tudo outra vez. Fica só em memória (nunca em disco): são
# dados bancários, e o processo é local e de vida curta.
_OCR_CACHE: "OrderedDict[tuple, list[Word]]" = OrderedDict()
_OCR_CACHE_MAX_PAGINAS = 80


def _ocr_cache_chave(doc_hash: Optional[str], page_idx: int, zoom: float,
                     psm: Optional[int], autocontrast: bool) -> Optional[tuple]:
    if not doc_hash:
        return None
    return (doc_hash, page_idx, zoom, psm, autocontrast, _TESSERACT_LANG)


def _words_from_ocr_page(
    page: "fitz.Page",
    zoom: float = 2.6,
    psm: Optional[int] = None,
    autocontrast: bool = False,
    doc_hash: Optional[str] = None,
) -> list[Word]:
    if not _TESSERACT_READY:
        return []
    chave = _ocr_cache_chave(doc_hash, page.number, zoom, psm, autocontrast)
    if chave is not None and chave in _OCR_CACHE:
        _OCR_CACHE.move_to_end(chave)
        return _OCR_CACHE[chave]
    img = _page_to_image(page, zoom=zoom, autocontrast=autocontrast)
    config = f"--psm {psm}" if psm is not None else ""
    data = pytesseract.image_to_data(
        img, lang=_TESSERACT_LANG, config=config, output_type=pytesseract.Output.DICT
    )
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
        line_key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
        words.append(Word(text, float(x), float(y), float(x + w), float(y + h), line_key))
    if chave is not None:
        _OCR_CACHE[chave] = words
        while len(_OCR_CACHE) > _OCR_CACHE_MAX_PAGINAS:
            _OCR_CACHE.popitem(last=False)
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

# Resolução e segmentação do OCR para o extrato Sicredi fotografado. PSM 6
# ("um bloco uniforme de texto") mantém cada lançamento numa linha só; a
# segmentação automática quebra a tabela em blocos e embaralha as colunas.
_SICREDI_ZOOM = 2.0
_SICREDI_PSM = 6

# Faixas horizontais só das colunas de texto (fração da largura da página).
# Valor e Saldo NÃO entram aqui — ver _sicredi_linhas.
_SICREDI_DATA_MAX = 0.17
_SICREDI_DESCRICAO_MAX = 0.60
_SICREDI_DOCUMENTO_MAX = 0.72

# Um valor monetário impresso, possivelmente com rabisco grudado. Aceita ponto
# OU vírgula como separador de milhar porque o OCR troca um pelo outro direto.
_SICREDI_MONEY = re.compile(r"(?<!\d)(\d{1,3}(?:[.,]\d{3})*,\d{2})(?!\d)")
_SICREDI_MONEY_SOLTO = re.compile(r"\d[\d.,]*,\d{2}")
_SICREDI_DATA = re.compile(r"\b(\d{2})/(\d{2})/(\d{4})\b")

# "Lançamentos Futuros (Próximos 30 dias)": previsão de débitos a vencer,
# impressa depois do extrato e sem coluna Saldo — não é movimentação da conta.
# O C-cedilha sai como C, G ou Q no OCR.
_SICREDI_FUTUROS = re.compile(r"LAN[CGQ]AMENTOS?\s+FUTUROS")

# Histórico → sinal esperado do lançamento. Serve de trava contra saldo lido
# errado: um "APLICACAO FINANCEIRA" que apareça aumentando o saldo denuncia que
# o número foi lido errado. Só entram termos sem ambiguidade — "TED", por
# exemplo, fica de fora porque pode ser enviada ou recebida.
_SICREDI_DEBITO = ("PAGAMENTO", "TARIFA", "DEBITO", "APLICACAO", "SAQUE", "COMPRA",
                   "IOF", "IMPOSTO", "LIQUIDACAO BOLETO")
_SICREDI_CREDITO = ("RECEBIMENTO", "LIQ.COBRAN", "LIQ COBRAN", "DEPOSITO", "RESG",
                    "RENDIMENTO", "ESTORNO")

_SALDO_TOLERANCIA = 0.011

# Letras que o Tesseract devolve no lugar de dígitos dentro dos números do
# extrato. Mapa próprio (mais largo que o _fix_ocr_digits usado no layout
# CAIXA) porque aqui o rabisco de caneta encosta nos algarismos.
_SICREDI_LETRA_DIGITO = str.maketrans({
    "O": "0", "o": "0", "D": "0", "Q": "0",
    "l": "1", "I": "1", "i": "1", "|": "1", "!": "1",
    "Z": "2", "z": "2",
    "A": "4",
    "S": "5", "s": "5",
    "G": "6", "b": "6",
    "T": "7",
    "B": "8",
    "g": "9", "q": "9",
})


def _sem_acento(texto: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", texto)
                   if unicodedata.category(c) != "Mn")


def _is_sicredi_layout(words: list[Word]) -> bool:
    joined = " ".join(w.text for w in words[:80]).upper()
    return "SICREDI" in joined and ("EXTRATO" in joined or "PERIODO" in joined or "PERÍODO" in joined)


def _sicredi_valor(raw: str) -> tuple[Optional[float], bool, str]:
    """(valor, bem_formado, dígitos) de um número monetário lido pelo OCR."""
    if not raw:
        return None, False, ""
    texto = raw.strip().translate(_SICREDI_LETRA_DIGITO)
    negativo = texto.lstrip().startswith(("-", "~", "–", "—"))
    texto = re.sub(r"[^0-9.,]", "", texto)
    if not texto:
        return None, False, ""
    m = _SICREDI_MONEY.search(texto)
    if m:
        token = m.group(1)
        # "000,00" no lugar de "10.000,00": zero à esquerda denuncia dígito
        # comido pelo OCR — o extrato nunca imprime saldo com zero à esquerda.
        bem_formado = not re.match(r"0\d", token)
    else:
        m = _SICREDI_MONEY_SOLTO.search(texto)
        if not m:
            return None, False, ""
        token, bem_formado = m.group(0), False
    # Separador de milhar pode sair como vírgula ("-13,691,72"): só o último
    # separador é o decimal.
    inteiro, _, decimal = token.rpartition(",")
    inteiro = re.sub(r"[^0-9]", "", inteiro) or "0"
    try:
        valor = float(inteiro + "." + decimal)
    except ValueError:
        return None, False, ""
    return (-valor if negativo else valor), bem_formado, inteiro + decimal


def _sicredi_digitos(valor: float) -> str:
    return re.sub(r"[^0-9]", "", "%.2f" % abs(valor))


def _sicredi_perto(a: float, b: float) -> bool:
    return abs(a - b) <= _SALDO_TOLERANCIA


def _sicredi_sinal_esperado(historico: str) -> int:
    h = re.sub(r"\s+", " ", _sem_acento(historico).upper())
    for kw in _SICREDI_CREDITO:
        if kw in h:
            return 1
    for kw in _SICREDI_DEBITO:
        if kw in h:
            return -1
    return 0


def _sicredi_sinal_ok(delta: float, historico: str) -> bool:
    esperado = _sicredi_sinal_esperado(historico)
    if esperado == 0 or abs(delta) < 0.005:
        return True
    return (delta > 0) == (esperado > 0)


# Rótulos que o Sicredi imprime sempre iguais. O OCR come o espaço entre as
# palavras ("TARIFACOMR LIQUIDACAO") e isso atrapalha o casamento das regras de
# conta, que procuram o texto do histórico. Recompor o espaçamento de um rótulo
# fixo não inventa dado nenhum — só desfaz um erro de leitura.
_SICREDI_HISTORICOS = [
    "LIQ.COBRANCA SIMPLES",
    "TARIFA COM R LIQUIDACAO",
    "TARIFA BAIXA DE TITULOS",
    "APLICACAO FINANCEIRA",
    "RESG.APLIC FIN AVISO PREV",
    "LIQUIDACAO BOLETO SICREDI",
    "DEBITO CONVENIOS",
    "RECEBIMENTO PIX",
    "PAGAMENTO PIX",
    "DEBITO AUTOMATICO",
]


def _so_letras(texto: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", _sem_acento(texto).upper())


def _sicredi_historico_canonico(historico: str) -> str:
    """Recompõe o rótulo padrão do banco quando o OCR grudou/trocou os espaços."""
    limpo = re.sub(r"\s+", " ", historico).strip(" .-—–|")
    achatado = _so_letras(limpo)
    for padrao in _SICREDI_HISTORICOS:
        alvo = _so_letras(padrao)
        pos = achatado.find(alvo)
        if pos < 0:
            # Letra trocada pelo OCR ("LIO.COBRANCA" no lugar de
            # "LIQ.COBRANCA"): aceita o rótulo quase idêntico, mas só bem no
            # começo e com semelhança alta, para nunca confundir dois rótulos
            # diferentes entre si — PAGAMENTO PIX x RECEBIMENTO PIX dá 0,69 e
            # é recusado.
            for inicio in range(0, 4):
                trecho = achatado[inicio:inicio + len(alvo)]
                if len(trecho) < len(alvo):
                    break
                if difflib.SequenceMatcher(None, trecho, alvo).ratio() >= 0.88:
                    pos = inicio
                    break
        # só corrige se o rótulo estiver no começo (tolerando lixo de OCR antes)
        if pos < 0 or pos > 3:
            continue
        # devolve o rótulo canônico + o que vinha depois dele no texto original
        consumidos = 0
        idx = 0
        for idx, ch in enumerate(limpo):
            if re.match(r"[A-Za-z0-9]", _sem_acento(ch)):
                consumidos += 1
                if consumidos == pos + len(alvo):
                    idx += 1
                    break
        resto = limpo[idx:].strip()
        return (padrao + " " + resto).strip() if resto else padrao
    return limpo


def _sicredi_linhas(doc: "fitz.Document", max_pages: Optional[int] = None,
                    doc_hash: Optional[str] = None) -> list[dict]:
    """Recorta cada linha do extrato em data/descrição/documento/valor/saldo.

    As colunas Valor e Saldo não são recortadas por faixa fixa da largura: cada
    página é uma foto, com enquadramento e inclinação próprios, e uma faixa fixa
    junta as duas colunas numa célula só (lendo "143.871,33" e "153.871,33" como
    um número só). Em vez disso, a borda direita da coluna Saldo é calibrada com
    as próprias linhas da página — ela é impressa alinhada à direita —, e o Valor
    é o número monetário imediatamente à esquerda dela.
    """
    linhas_extrato: list[dict] = []
    for page_idx, page in enumerate(doc):
        if max_pages is not None and page_idx >= max_pages:
            break
        words = _words_from_ocr_page(
            page, zoom=_SICREDI_ZOOM, psm=_SICREDI_PSM, autocontrast=True, doc_hash=doc_hash
        )
        if not words:
            continue
        largura = page.rect.width * _SICREDI_ZOOM

        agrupadas: dict = {}
        for w in words:
            agrupadas.setdefault(w.line_key, []).append(w)
        ordem = sorted(agrupadas, key=lambda k: min(w.y0 for w in agrupadas[k]))

        bordas = []
        for key in ordem:
            direitas = [w.x1 for w in agrupadas[key]
                        if _SICREDI_MONEY.search(w.text) and w.x0 / largura > 0.55]
            if direitas:
                bordas.append(max(direitas))
        if not bordas:
            continue
        saldo_direita = sorted(bordas)[len(bordas) // 2]
        tolerancia = largura * 0.045

        for key in ordem:
            linha = sorted(agrupadas[key], key=lambda w: w.x0)
            dinheiro = [w for w in linha
                        if _SICREDI_MONEY.search(w.text) and w.x0 / largura > 0.55]
            na_coluna_saldo = [w.text for w in dinheiro
                               if abs(w.x1 - saldo_direita) <= tolerancia]
            a_esquerda = [w.text for w in dinheiro if w.x1 < saldo_direita - tolerancia]

            # Data e histórico saem juntos e só depois são separados pela regex
            # da data. Uma fronteira fixa entre as duas colunas não serve: cada
            # página é uma foto com enquadramento próprio, e nas deslocadas o
            # começo do histórico cai do lado da data e era descartado — virava
            # "SIMPLES" no lugar de "LIQ.COBRANCA SIMPLES", "FINANCEIRA" no
            # lugar de "APLICACAO FINANCEIRA".
            cabeca, documento = [], []
            for w in linha:
                frac = w.x0 / largura
                if frac < _SICREDI_DESCRICAO_MAX:
                    cabeca.append(w.text)
                elif frac < _SICREDI_DOCUMENTO_MAX:
                    documento.append(w.text)

            cabeca_txt = " ".join(cabeca).strip()
            dm = _SICREDI_DATA.search(cabeca_txt)
            historico = (cabeca_txt[:dm.start()] + " " + cabeca_txt[dm.end():]) if dm else cabeca_txt

            linhas_extrato.append({
                "data": dm.group(0) if dm else "",
                "descricao": _sicredi_historico_canonico(historico),
                "documento": " ".join(documento).strip(),
                "valor": a_esquerda[-1] if a_esquerda else "",
                "saldo": na_coluna_saldo[-1] if na_coluna_saldo else "",
                "texto": " ".join(w.text for w in linha),
            })
    return linhas_extrato


def _sicredi_lancamentos(linhas: list[dict]) -> tuple[Optional[float], list[dict]]:
    saldo_anterior: Optional[float] = None
    lancamentos: list[dict] = []
    for linha in linhas:
        if _SICREDI_FUTUROS.search(_sem_acento(linha["texto"]).upper()):
            break
        descricao_up = linha["descricao"].upper()
        if saldo_anterior is None and "SALDO" in descricao_up and "ANTERIOR" in descricao_up:
            saldo_anterior = _sicredi_valor(linha["saldo"])[0]
            continue
        dm = _SICREDI_DATA.search(linha["data"])
        if not dm or _is_saldo_line(descricao_up):
            continue
        saldo, saldo_ok, saldo_digitos = _sicredi_valor(linha["saldo"])
        valor, valor_ok, _ = _sicredi_valor(linha["valor"])
        lancamentos.append({
            "data": dm.group(0),
            "descricao": linha["descricao"].strip(),
            "documento": linha["documento"].strip(),
            "saldo": saldo, "saldo_ok": saldo_ok, "saldo_digitos": saldo_digitos,
            "valor": valor, "valor_ok": valor_ok,
        })
    return saldo_anterior, lancamentos


def _sicredi_concilia(saldo_anterior: Optional[float], lancamentos: list[dict]) -> list[dict]:
    """Fecha o valor de cada lançamento pela cadeia de saldos.

    A coluna Saldo é a fonte primária: no extrato fotografado ela fica na borda
    direita da folha, longe das anotações à caneta que cobrem a coluna Valor. O
    valor de cada lançamento sai da diferença entre saldos consecutivos — o que
    também recupera o sinal, que o OCR perde com frequência (o "-" some, ou vira
    "+"/"7"). A coluna Valor entra só como testemunha, para corrigir o saldo nos
    casos em que ele quebra a cadeia.
    """
    anterior = saldo_anterior if saldo_anterior is not None else 0.0
    resultado: list[dict] = []
    for i, lanc in enumerate(lancamentos):
        seguinte = lancamentos[i + 1] if i + 1 < len(lancamentos) else None
        seguinte_ok = bool(
            seguinte and seguinte["saldo"] is not None and seguinte["saldo_ok"]
            and seguinte["valor"] is not None and seguinte["valor_ok"]
        )
        valor = lanc["valor"]
        valor_ok = valor is not None and lanc["valor_ok"]
        base = anterior

        def confirma_seguinte(c: float) -> bool:
            return seguinte_ok and _sicredi_perto(abs(seguinte["saldo"] - c), abs(seguinte["valor"]))

        def confirma_valor(c: float) -> bool:
            return valor_ok and _sicredi_perto(abs(c - base), abs(valor))

        saldo = lanc["saldo"]
        if saldo is not None and lanc["saldo_ok"] and _sicredi_sinal_ok(saldo - base, lanc["descricao"]):
            if not confirma_valor(saldo):
                if confirma_valor(-saldo):
                    # O "-" impresso some com frequência no OCR. Só inverte o
                    # sinal se a própria coluna Valor confirmar o saldo invertido.
                    saldo = -saldo
                elif seguinte_ok:
                    # Dígito comido/sobrando: aceita um saldo reconstruído pela
                    # linha seguinte se a coluna Valor desta linha o confirmar,
                    # ou se ele for sósia do que o OCR leu aqui (mesmo número com
                    # um dígito de diferença) — nunca um número qualquer.
                    melhor = None
                    for c in (seguinte["saldo"] - abs(seguinte["valor"]),
                              seguinte["saldo"] + abs(seguinte["valor"])):
                        if not confirma_seguinte(c):
                            continue
                        semelhanca = difflib.SequenceMatcher(
                            None, _sicredi_digitos(c), lanc["saldo_digitos"]).ratio()
                        peso = (confirma_valor(c), semelhanca)
                        if (peso[0] or semelhanca >= 0.90) and (melhor is None or peso > melhor[0]):
                            melhor = (peso, c)
                    if melhor:
                        saldo = melhor[1]
        else:
            # Saldo ilegível (rabisco por cima, borrão) ou incoerente com o
            # histórico: reconstrói pela linha seguinte, e só recorre à coluna
            # Valor desta linha se a seguinte não ajudar.
            candidatos: list[float] = []
            if seguinte_ok:
                candidatos += [seguinte["saldo"] - abs(seguinte["valor"]),
                               seguinte["saldo"] + abs(seguinte["valor"])]
            if valor_ok:
                candidatos += [base + valor, base - valor]
            if saldo is not None:
                candidatos.append(saldo)
            if not candidatos:
                continue

            def peso(c: float) -> tuple:
                seguinte_coerente = (not seguinte_ok) or _sicredi_sinal_ok(
                    seguinte["saldo"] - c, seguinte["descricao"])
                # O "-" lido pelo OCR na linha seguinte é confiável quando
                # aparece: ele some com frequência, mas raramente é inventado.
                menos_lido = seguinte_ok and ((seguinte["saldo"] - c >= 0) == (seguinte["valor"] >= 0))
                return (_sicredi_sinal_ok(c - base, lanc["descricao"]), seguinte_coerente,
                        confirma_seguinte(c), confirma_valor(c), menos_lido)

            saldo = max(candidatos, key=peso)

        lanc["montante"] = round(saldo - base, 2)
        lanc["saldo_final"] = round(saldo, 2)
        resultado.append(lanc)
        anterior = saldo
    return resultado


def _rows_from_sicredi_pdf(doc: "fitz.Document", max_rows: int, max_pages: Optional[int] = None,
                           doc_hash: Optional[str] = None) -> tuple[list[list[str]], int, dict]:
    """Produz linhas limpas: [Data, Histórico, Débito, Crédito, Complemento]."""
    linhas = _sicredi_linhas(doc, max_pages=max_pages, doc_hash=doc_hash)
    saldo_anterior, lancamentos = _sicredi_lancamentos(linhas)
    conciliados = _sicredi_concilia(saldo_anterior, lancamentos)

    clean_rows: list[list[str]] = []
    for lanc in conciliados:
        montante = lanc["montante"]
        if montante == 0:
            continue
        texto = ("%.2f" % abs(montante)).replace(".", ",")
        debito = texto if montante < 0 else ""
        credito = texto if montante > 0 else ""
        clean_rows.append([lanc["data"], lanc["descricao"], debito, credito, lanc["documento"]])
        if len(clean_rows) >= max_rows:
            break

    stats = {
        "paginas": doc.page_count,
        "linhas": len(clean_rows),
        "modo": "ocr (layout Sicredi reconhecido)",
    }
    if conciliados:
        stats["saldo_anterior"] = saldo_anterior
        stats["saldo_final"] = conciliados[-1]["saldo_final"]
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

    # Identidade do conteúdo: deixa o /extract reaproveitar o OCR que o /preview
    # acabou de fazer, em vez de reler o documento inteiro do zero.
    doc_hash = hashlib.sha1(pdf_bytes).hexdigest()

    if use_ocr != "no" and doc.page_count > 0:
        first_words = (_words_from_native_page(doc[0])
                       or _words_from_ocr_page(doc[0], zoom=1.4, doc_hash=doc_hash))
        if _is_caixa_app_layout(first_words):
            rows, n_cols, stats = _rows_from_caixa_app_pdf(doc, max_rows, max_pages=max_pages)
            return rows, n_cols, stats, doc
        if _is_sicredi_layout(first_words):
            rows, n_cols, stats = _rows_from_sicredi_pdf(
                doc, max_rows, max_pages=max_pages, doc_hash=doc_hash)
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
    max_rows: int = Form(2000),
    use_ocr: str = Form("auto"),
    # Lê o extrato inteiro, não só as primeiras páginas: o preview mostrava 96
    # lançamentos de um extrato de 102 e passava a impressão de que a extração
    # tinha perdido linhas. Agora que o OCR fica em cache por conteúdo, ler tudo
    # aqui não custa nada a mais no total — é o /extract seguinte que sai de
    # graça, em vez de reler o documento do zero.
    max_pages: int = Form(40),
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
