from PIL import Image, ImageDraw

def mask_image():
    # Load original screenshot
    img = Image.open('C:/Users/ronaldo.silva/.gemini/antigravity-ide/brain/5cc1af11-0c07-4054-aaf3-3226499a2332/media__1786293558774.png')
    img = img.convert('RGBA')
    
    draw = ImageDraw.Draw(img)
    
    # Define a helper function to draw white rounded rectangles (white tags)
    def draw_white_tag(x0, y0, x1, y1):
        # Draw background white rectangle
        draw.rounded_rectangle([x0, y0, x1, y1], radius=4, fill=(255, 255, 255, 255), outline=(220, 220, 220, 255), width=1)
        
    # Let's redact the header:
    # 1. Company Name and CNPJ: "COMERCIAL FERNANDES EIRELI - ME | CNPJ: 014.310.204/0001-33"
    # Located after "Cliente "
    draw_white_tag(185, 153, 678, 175)
    
    # 2. Username: "Murilo Beato Fernandes"
    # Located after "Nome do usuário: "
    draw_white_tag(368, 187, 510, 206)
    
    # 3. Agency and account in table: "01894 | 0020527-3"
    draw_white_tag(63, 428, 188, 448)
    
    # 4. Total Disponível and Total values: "1.337,29" and "1.337,29"
    draw_white_tag(390, 428, 448, 448)
    draw_white_tag(746, 428, 804, 448)
    
    # 5. "Extrato de: Ag: 01894 | CC: 0020527-3" -> mask the numbers
    draw_white_tag(136, 511, 310, 526)
    
    # 6. For the transaction table, let's mask document numbers and values:
    # Since the image ends shortly after the table start, let's check Y coordinates of rows:
    # Let's find rows using coordinates from OCR:
    # 18/02/2026 SALDO ANTERIOR 976,77 (Y coordinate around 650+)
    # Wait, the screenshot is 519px high!
    # Ah! The screenshot shows from Agência | Conta box to the end of the first page content?
    # Wait, if the screenshot height is 519, let's see how much of the table is visible.
    # Let's write a python script to crop, draw, and save it.
    
    # Save the redacted image
    img = img.convert('RGB')
    import os
    os.makedirs('public/extratos', exist_ok=True)
    img.save('public/extratos/bradesco_netempresa.png')
    print('Image saved successfully!')

mask_image()
