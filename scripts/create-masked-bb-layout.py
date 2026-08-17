#!/usr/bin/env python3
"""
Cria uma imagem mascarada do novo layout BB v2026 
baseada no extrato padrão, mas com dados sensíveis cobertos por tags brancas.
"""

from PIL import Image, ImageDraw, ImageFont
import os

def create_masked_bb_layout():
    """Cria imagem do novo layout BB v2026 com mascaramento."""
    
    # Dimensões baseadas no extrato original
    width = 800
    height = 600
    
    # Criar imagem base
    img = Image.new('RGB', (width, height), color='white')
    draw = ImageDraw.Draw(img)
    
    # Tentar usar fonte do sistema
    try:
        font_normal = ImageFont.truetype("arial.ttf", 11)
        font_bold = ImageFont.truetype("arialbd.ttf", 12)
        font_small = ImageFont.truetype("arial.ttf", 10)
        font_title = ImageFont.truetype("arialbd.ttf", 14)
    except:
        # Fallback para fonte padrão
        font_normal = ImageFont.load_default()
        font_bold = ImageFont.load_default()
        font_small = ImageFont.load_default()
        font_title = ImageFont.load_default()
    
    # Cores
    blue_header = '#1e40af'
    yellow_highlight = '#fef08a'
    gray_light = '#f3f4f6'
    gray_dark = '#6b7280'
    white = '#ffffff'
    green = '#059669'
    red = '#dc2626'
    
    # Header do BB
    draw.rectangle([0, 0, width, 60], fill=blue_header)
    
    # Logo BB (quadrado amarelo)
    draw.rectangle([20, 15, 50, 45], fill=yellow_highlight)
    draw.text((30, 25), "BB", fill=blue_header, font=font_bold)
    
    # Título
    draw.text((65, 20), "Extrato de Conta Corrente", fill=white, font=font_title)
    
    # Cliente (mascarado)
    draw.rectangle([0, 60, width, 90], fill=yellow_highlight)
    draw.text((20, 68), "Cliente:", fill=gray_dark, font=font_bold)
    
    # Tag branca mascarando cliente
    draw.rectangle([80, 65, 280, 85], fill=white, outline='#e5e7eb')
    draw.text((85, 69), "██████████████████████", fill='#f3f4f6', font=font_normal)
    
    # Agência e Conta (mascaradas)
    draw.text((350, 68), "Agência:", fill=gray_dark, font=font_normal)
    draw.rectangle([410, 65, 450, 85], fill=white, outline='#e5e7eb')
    draw.text((415, 69), "███", fill='#f3f4f6', font=font_normal)
    
    draw.text((470, 68), "Conta:", fill=gray_dark, font=font_normal)
    draw.rectangle([515, 65, 580, 85], fill=white, outline='#e5e7eb')
    draw.text((520, 69), "██████", fill='#f3f4f6', font=font_normal)
    
    # Seção Lançamentos
    y_pos = 110
    draw.text((20, y_pos), "Lançamentos", fill='#4a90a4', font=font_bold)
    y_pos += 25
    
    # Cabeçalho da tabela
    headers = ["Dia", "Lote", "Documento", "Histórico", "Valor"]
    x_positions = [20, 120, 180, 300, 650]
    
    # Fundo do cabeçalho
    draw.rectangle([15, y_pos, width-15, y_pos+25], fill=gray_light, outline='#d1d5db')
    
    for i, header in enumerate(headers):
        draw.text((x_positions[i], y_pos+5), header, fill=gray_dark, font=font_bold)
    
    y_pos += 30
    
    # Dados das transações (mascarados)
    transactions = [
        {
            "date": "30/04/2026",
            "lote": "",
            "doc": "",
            "desc": "Saldo Anterior",
            "value": "0,00 (+)",
            "color": green
        },
        {
            "date": "04/05/2026", 
            "lote": "14397",
            "doc": "masked",
            "desc": "Pix - Recebido\n01/05 09:03 [NOME MASCARADO]",
            "value": "500,00 (+)",
            "color": green
        },
        {
            "date": "04/05/2026",
            "lote": "14397", 
            "doc": "masked",
            "desc": "Pix - Recebido\n01/05 11:06 [NOME MASCARADO]",
            "value": "183,00 (+)",
            "color": green
        },
        {
            "date": "04/05/2026",
            "lote": "14397",
            "doc": "masked", 
            "desc": "Pix - Recebido\n02/05 07:27 [NOME MASCARADO]",
            "value": "10,00 (+)",
            "color": green
        },
        {
            "date": "04/05/2026",
            "lote": "13105",
            "doc": "50401",
            "desc": "Pagamento de Boleto\n[EMPRESA MASCARADA]",
            "value": "2.458,92 (-)",
            "color": red
        },
        {
            "date": "04/05/2026",
            "lote": "9903",
            "doc": "-",
            "desc": "BB Rende Fácil\nRende Facil", 
            "value": "11.986,29 (+)",
            "color": green
        }
    ]
    
    for i, tx in enumerate(transactions):
        # Fundo alternado
        if i % 2 == 1:
            draw.rectangle([15, y_pos, width-15, y_pos+35], fill='#fafafa')
        
        # Data
        draw.text((x_positions[0], y_pos+5), tx["date"], fill='#374151', font=font_normal)
        
        # Lote
        draw.text((x_positions[1], y_pos+5), tx["lote"], fill='#374151', font=font_normal)
        
        # Documento (mascarado se necessário)
        if tx["doc"] == "masked":
            draw.rectangle([x_positions[2], y_pos+3, x_positions[2]+80, y_pos+18], 
                          fill=white, outline='#e5e7eb')
            draw.text((x_positions[2]+5, y_pos+5), "█████████████", fill='#f3f4f6', font=font_small)
        else:
            draw.text((x_positions[2], y_pos+5), tx["doc"], fill='#374151', font=font_normal)
        
        # Histórico (com mascaramento de nomes)
        lines = tx["desc"].split('\n')
        for j, line in enumerate(lines):
            if "[NOME MASCARADO]" in line or "[EMPRESA MASCARADA]" in line:
                # Desenhar parte não mascarada
                parts = line.split('[')
                draw.text((x_positions[3], y_pos+5+j*12), parts[0], fill='#374151', font=font_normal)
                
                # Tag branca para parte mascarada
                if len(parts) > 1:
                    mask_x = x_positions[3] + len(parts[0]) * 6
                    draw.rectangle([mask_x, y_pos+3+j*12, mask_x+100, y_pos+15+j*12], 
                                  fill=white, outline='#e5e7eb')
                    draw.text((mask_x+5, y_pos+5+j*12), "███████████████", 
                             fill='#f3f4f6', font=font_small)
            else:
                draw.text((x_positions[3], y_pos+5+j*12), line, fill='#374151', font=font_normal)
        
        # Valor
        draw.text((x_positions[4], y_pos+5), tx["value"], fill=tx["color"], font=font_bold)
        
        y_pos += 40
    
    # Legenda na parte inferior
    legend_y = height - 80
    draw.text((20, legend_y), "Legenda:", fill=gray_dark, font=font_bold)
    legend_y += 20
    
    # Quadrado branco para legenda
    draw.rectangle([20, legend_y, 40, legend_y+15], fill=white, outline='#e5e7eb')
    draw.text((25, legend_y+2), "███", fill='#f3f4f6', font=font_small)
    draw.text((50, legend_y+3), "Dados sensíveis mascarados (CPF, CNPJ, nomes)", 
             fill=gray_dark, font=font_normal)
    
    # Quadrado verde para créditos
    legend_y += 20
    draw.rectangle([20, legend_y, 40, legend_y+15], fill=green)
    draw.text((25, legend_y+2), "(+)", fill=white, font=font_bold)
    draw.text((50, legend_y+3), "Créditos (entradas)", fill=gray_dark, font=font_normal)
    
    # Quadrado vermelho para débitos  
    legend_y += 20
    draw.rectangle([20, legend_y, 40, legend_y+15], fill=red)
    draw.text((25, legend_y+2), "(-)", fill=white, font=font_bold)
    draw.text((50, legend_y+3), "Débitos (saídas)", fill=gray_dark, font=font_normal)
    
    return img

def main():
    """Função principal."""
    print("🎨 Criando layout mascarado do BB v2026...")
    
    # Criar imagem
    img = create_masked_bb_layout()
    
    # Salvar
    output_path = os.path.join(
        os.path.dirname(os.path.dirname(__file__)), 
        'public', 
        'bb-v2026-masked-layout.png'
    )
    
    # Garantir que o diretório existe
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    
    img.save(output_path, 'PNG', quality=95)
    
    print(f"✅ Layout mascarado criado: {output_path}")
    print(f"📐 Dimensões: {img.size[0]}x{img.size[1]}")
    print("🛡️  Dados sensíveis mascarados com tags brancas")
    print("🔍 Abra a imagem para ver o novo layout v2026!")

if __name__ == '__main__':
    main()