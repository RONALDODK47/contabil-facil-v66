#!/usr/bin/env python3
"""
Script para mascarar extrato do Banco do Brasil com tags brancas.
Cobre transações sensíveis com tags descritivas em branco.

Uso:
  python mask-bb-extrato-pdf.py <input_pdf> <output_pdf>
"""

import sys
import re
from pathlib import Path
from typing import List, Tuple

try:
    from pdf2image import convert_from_path
    from PIL import Image, ImageDraw, ImageFont
    import PyPDF2
except ImportError:
    print("Erro: Bibliotecas necessárias não instaladas.")
    print("Instale com: pip install pdf2image pillow PyPDF2")
    sys.exit(1)


class BbExtratoMasker:
    """Mascara extrato BB cobrindo informações sensíveis com tags brancas."""

    # Padrões de informação sensível
    PATTERNS = {
        # CPF/CNPJ: 000.000.000-00 ou 00000000000000
        'cpf_cnpj': r'\b(\d{2,3}\.\d{3}\.\d{3}[-/]?\d{2}|\d{11,14})\b',
        # Nomes próprios após CPF/CNPJ
        'nome': r'(?:^|\s)([A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇ\s\.]+)(?:\s|$)',
    }

    SENSITIVE_KEYWORDS = [
        'PIX', 'RECEBIDO', 'ENVIADO', 'BOLETO', 'TRANSFERÊNCIA',
        'PAGAMENTO', 'DÉBITO', 'CRÉDITO', 'TED', 'DOC'
    ]

    def __init__(self, input_path: str, output_path: str, dpi: int = 150):
        """
        Inicializa o mascarador.
        
        Args:
            input_path: Caminho do PDF de entrada
            output_path: Caminho do PDF de saída mascarado
            dpi: Resolução para conversão (padrão: 150)
        """
        self.input_path = Path(input_path)
        self.output_path = Path(output_path)
        self.dpi = dpi

        if not self.input_path.exists():
            raise FileNotFoundError(f"Arquivo não encontrado: {input_path}")

    def convert_pdf_to_images(self) -> List[Image.Image]:
        """Converte PDF em imagens PIL."""
        print(f"Convertendo PDF para imagens (DPI: {self.dpi})...")
        images = convert_from_path(str(self.input_path), dpi=self.dpi)
        print(f"✓ {len(images)} páginas convertidas")
        return images

    def mask_transaction_lines(self, image: Image.Image) -> Image.Image:
        """
        Máscara linhas de transação com tags brancas.
        
        Estratégia: 
        - Detecta linhas com padrão de transação (data, valor, tipo)
        - Cobre com retângulos brancos
        - Adiciona texto branco descritivo
        """
        draw = ImageDraw.Draw(image)
        width, height = image.size

        # Altura aproximada de uma linha em pixels (ajustar conforme necessário)
        line_height = int(height / 50)  # Aproximadamente 50 linhas por página
        
        # Cores
        white = (255, 255, 255)
        light_gray = (240, 240, 240)

        # Identifica áreas de transação (aproximadamente entre as colunas)
        # BB layout: Data | Lote | Documento | Histórico | Valor
        
        # Assume que transações começam no topo após cabeçalho
        # e ocupam a maior parte vertical da página
        
        header_height = int(height * 0.15)  # Primeiros 15% são cabeçalho
        footer_height = int(height * 0.08)  # Últimos 8% são rodapé
        
        # Cobre a área principal de transações com padrão de mascaramento
        for y in range(header_height, height - footer_height, line_height):
            # Cobre linha com retângulo branco semi-transparente
            mask_rect = [0, y, width, y + line_height - 2]
            draw.rectangle(mask_rect, fill=light_gray, outline=None)
            
            # Adiciona tag descritiva em branco
            tag_y = y + (line_height // 2) - 8
            draw.text(
                (15, tag_y),
                "[TRANSAÇÃO MASCARADA]",
                fill=white,
                font=None
            )

        return image

    def mask_header_info(self, image: Image.Image) -> Image.Image:
        """Máscara informações do cabeçalho (cliente, conta, agência)."""
        draw = ImageDraw.Draw(image)
        width, height = image.size

        white = (255, 255, 255)
        light_blue = (220, 240, 255)

        # Cobre informações de cliente/conta/agência (primeiras linhas)
        header_area = int(height * 0.12)
        
        # Máscara cliente
        draw.rectangle([0, 0, width, header_area], fill=light_blue, outline=None)
        draw.text((15, 20), "[INFORMAÇÕES DE CLIENTE MASCARADAS]", fill=white, font=None)

        return image

    def mask_footer_info(self, image: Image.Image) -> Image.Image:
        """Máscara informações de rodapé (saldos, totalizadores)."""
        draw = ImageDraw.Draw(image)
        width, height = image.size

        white = (255, 255, 255)
        light_green = (220, 255, 240)

        # Rodapé (últimas linhas)
        footer_height = int(height * 0.10)
        footer_start = height - footer_height

        draw.rectangle([0, footer_start, width, height], fill=light_green, outline=None)
        draw.text((15, footer_start + 15), "[SALDOS E TOTALIZADORES MASCARADOS]", fill=white, font=None)

        return image

    def process_page(self, image: Image.Image, page_num: int) -> Image.Image:
        """
        Processa uma página mascarando informações sensíveis.
        
        Args:
            image: Imagem PIL da página
            page_num: Número da página (para logging)
            
        Returns:
            Imagem mascarada
        """
        print(f"Mascarando página {page_num}...")
        
        # Aplica máscaras em ordem
        image = self.mask_header_info(image)
        image = self.mask_transaction_lines(image)
        image = self.mask_footer_info(image)

        print(f"✓ Página {page_num} mascarada")
        return image

    def create_masked_pdf(self):
        """Cria PDF mascarado."""
        print("\n" + "=" * 60)
        print("MASCARADOR DE EXTRATO BANCO DO BRASIL")
        print("=" * 60)

        # Converte para imagens
        images = self.convert_pdf_to_images()

        # Processa cada página
        masked_images = []
        for i, img in enumerate(images, 1):
            masked = self.process_page(img, i)
            masked_images.append(masked)

        # Salva como PDF
        print(f"\nSalvando PDF mascarado em: {self.output_path}")
        
        # Converte RGB para garantir compatibilidade
        rgb_images = [img.convert('RGB') for img in masked_images]
        
        rgb_images[0].save(
            str(self.output_path),
            save_all=True,
            append_images=rgb_images[1:] if len(rgb_images) > 1 else [],
            optimize=True
        )

        print("✓ PDF mascarado criado com sucesso!")
        print(f"\nResumo:")
        print(f"  - Páginas processadas: {len(masked_images)}")
        print(f"  - Arquivo de saída: {self.output_path}")
        print(f"  - Tamanho: {self.output_path.stat().st_size / 1024:.1f} KB")


def main():
    """Função principal."""
    if len(sys.argv) < 2:
        print("Uso: python mask-bb-extrato-pdf.py <input_pdf> [output_pdf]")
        print("\nExemplos:")
        print("  python mask-bb-extrato-pdf.py extrato.pdf extrato-mascarado.pdf")
        print("  python mask-bb-extrato-pdf.py extrato.pdf  # Usa padrão: extrato-masked.pdf")
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else Path(input_path).stem + "-masked.pdf"

    try:
        masker = BbExtratoMasker(input_path, output_path)
        masker.create_masked_pdf()
    except FileNotFoundError as e:
        print(f"❌ Erro: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"❌ Erro ao processar: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
