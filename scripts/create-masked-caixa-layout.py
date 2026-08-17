#!/usr/bin/env python3
"""
Cria a imagem de referência do layout CAIXA "Extrato por período" com os dados
sensíveis cobertos por tags brancas.

A geometria é o que importa para o fingerprint do servidor OCR: logo, títulos,
rótulos e as posições das colunas ficam intactos. Razão social, agência/conta,
saldo anterior e as linhas de lançamento entram como tag branca rotulada.

Uso:
  python create-masked-caixa-layout.py [saida.png]
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

WIDTH = 850
HEIGHT = 430

# Paleta da marca CAIXA
AZUL = '#0058A0'
LARANJA = '#F58220'
TEXTO = '#1a1a1a'
CINZA = '#555555'
BORDA_TAG = '#c8c8c8'
TAG_TEXTO = '#9a9a9a'

# Colunas da tabela de lançamentos (x de início)
COL_DATA = 52
COL_DOC = 190
COL_HIST = 240
COL_FAV = 475
COL_CPF = 583
COL_VALOR = 668
COL_SALDO = 738

# Linhas do bloco de identificação
CAMPO_X = 52
VALOR_X = 245
CAMPO_Y0 = 155
CAMPO_DY = 28


def carregar_fontes():
    """Arial quando disponível; cai no bitmap padrão sem quebrar."""
    def try_font(nomes, tamanho):
        for nome in nomes:
            try:
                return ImageFont.truetype(nome, tamanho)
            except OSError:
                continue
        return ImageFont.load_default()

    regular = ['arial.ttf', 'Arial.ttf', 'DejaVuSans.ttf']
    bold = ['arialbd.ttf', 'Arial_Bold.ttf', 'DejaVuSans-Bold.ttf']
    return {
        'logo': try_font(bold, 30),
        'titulo': try_font(regular, 16),
        'secao': try_font(regular, 17),
        'normal': try_font(regular, 10),
        'header': try_font(regular, 10),
        'tag': try_font(regular, 9),
        'mini': try_font(regular, 9),
    }


def tag_branca(draw, box, rotulo, fonte):
    """Retângulo branco com borda leve e rótulo centralizado."""
    x0, y0, x1, y1 = box
    draw.rectangle([x0, y0, x1, y1], fill='white', outline=BORDA_TAG, width=1)
    tw = draw.textlength(rotulo, font=fonte)
    tx = x0 + (x1 - x0 - tw) / 2
    ty = y0 + (y1 - y0 - 9) / 2
    draw.text((tx, ty), rotulo, fill=TAG_TEXTO, font=fonte)


def desenhar_logo(draw, fontes):
    """CAIXA: letras azuis com o X laranja."""
    x, y = 52, 48
    for letra, cor in (('CAI', AZUL), ('X', LARANJA), ('A', AZUL)):
        draw.text((x, y), letra, fill=cor, font=fontes['logo'])
        x += draw.textlength(letra, font=fontes['logo'])


def criar_layout(saida: Path) -> Path:
    img = Image.new('RGB', (WIDTH, HEIGHT), color='white')
    draw = ImageDraw.Draw(img)
    f = carregar_fontes()

    desenhar_logo(draw, f)
    draw.text((700, 55), '#PESSOAL', fill=CINZA, font=f['mini'])
    draw.text((52, 105), 'Extrato por período', fill=TEXTO, font=f['titulo'])

    # ── Bloco de identificação ───────────────────────────────────────────────
    campos = [
        ('Cliente', None),                                  # mascarado
        ('Conta', None),                                    # mascarado
        ('Data', '05/05/2026 - 16:02'),
        ('Mês', 'Abril'),
        ('Período dos lançamentos', '01/04/2026 até 30/04/2026'),
    ]
    for i, (rotulo, valor) in enumerate(campos):
        y = CAMPO_Y0 + i * CAMPO_DY
        draw.text((CAMPO_X, y), rotulo, fill=CINZA, font=f['normal'])
        if valor is None:
            largura = 230 if rotulo == 'Cliente' else 200
            tag_branca(draw, (VALOR_X, y - 3, VALOR_X + largura, y + 14),
                       f'[{rotulo.upper()} MASCARADO]', f['tag'])
        else:
            draw.text((VALOR_X, y), valor, fill=TEXTO, font=f['normal'])

    # ── Saldo anterior ───────────────────────────────────────────────────────
    y_saldo = 295
    draw.text((COL_FAV, y_saldo), 'SALDO ANTERIOR', fill=TEXTO, font=f['normal'])
    tag_branca(draw, (COL_SALDO, y_saldo - 3, COL_SALDO + 100, y_saldo + 14),
               '[VALOR]', f['tag'])

    # ── Cabeçalho da tabela ──────────────────────────────────────────────────
    y_cab = 330
    draw.text((COL_DATA, y_cab - 8), 'Lançamentos', fill=TEXTO, font=f['secao'])
    for x, titulo in (
        (COL_DOC, 'Nr. Doc'),
        (COL_HIST, 'Histórico/Complemento'),
        (COL_FAV, 'Favorecido'),
        (COL_CPF, 'CPF/CNPJ'),
        (COL_VALOR, 'Valor'),
        (COL_SALDO, 'Saldo'),
    ):
        draw.text((x, y_cab), titulo, fill=TEXTO, font=f['header'])

    # ── Linhas de lançamento (todas mascaradas) ──────────────────────────────
    y_linha = 368
    for _ in range(2):
        tag_branca(draw, (COL_DATA, y_linha - 4, WIDTH - 50, y_linha + 15),
                   '[LANÇAMENTO MASCARADO]', f['tag'])
        y_linha += 40

    saida.parent.mkdir(parents=True, exist_ok=True)
    img.save(saida, 'PNG')
    return saida


def main():
    destino = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('caixa-layout-mascarado.png')
    caminho = criar_layout(destino)
    print(f'Layout CAIXA mascarado gerado: {caminho.resolve()}')


if __name__ == '__main__':
    main()
