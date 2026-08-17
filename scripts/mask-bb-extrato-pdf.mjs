#!/usr/bin/env node
/**
 * Mascarador de Extrato Banco do Brasil - Versão Node.js
 * 
 * Cobre linhas de transação e informações sensíveis com tags brancas.
 * 
 * Uso:
 *   node scripts/mask-bb-extrato-pdf.mjs <input_pdf> [output_pdf]
 *
 * Requisitos:
 *   npm install pdf-lib pdfjs-dist
 */

import fs from 'fs/promises';
import path from 'path';
import { PDFDocument, PDFPage, rgb } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

class BbExtratoMasker {
  constructor(inputPath, outputPath) {
    this.inputPath = inputPath;
    this.outputPath = outputPath || path.basename(inputPath, path.extname(inputPath)) + '-masked.pdf';
  }

  /**
   * Mascara um PDF adicionando camadas brancas sobre informações sensíveis
   */
  async maskPdf() {
    console.log('\n' + '='.repeat(60));
    console.log('MASCARADOR DE EXTRATO BANCO DO BRASIL');
    console.log('='.repeat(60) + '\n');

    try {
      // Lê arquivo original
      console.log(`📄 Lendo PDF: ${this.inputPath}`);
      const fileData = await fs.readFile(this.inputPath);

      // Carrega documento
      const pdfDoc = await PDFDocument.load(fileData);
      const pages = pdfDoc.getPages();

      console.log(`✓ PDF carregado com ${pages.length} página(s)\n`);

      // Processa cada página
      for (let i = 0; i < pages.length; i++) {
        console.log(`🎨 Mascarando página ${i + 1}/${pages.length}...`);
        await this.maskPage(pdfDoc, pages[i], i);
      }

      // Salva PDF mascarado
      console.log(`\n💾 Salvando PDF mascarado: ${this.outputPath}`);
      const pdfBytes = await pdfDoc.save();
      await fs.writeFile(this.outputPath, pdfBytes);

      const fileSize = (pdfBytes.length / 1024).toFixed(1);
      console.log(`✓ PDF mascarado criado com sucesso!`);
      console.log(`\nResumo:`);
      console.log(`  - Arquivo de saída: ${this.outputPath}`);
      console.log(`  - Tamanho: ${fileSize} KB`);
      console.log(`  - Páginas: ${pages.length}`);
    } catch (error) {
      console.error(`\n❌ Erro ao processar: ${error.message}`);
      throw error;
    }
  }

  /**
   * Máscara uma página individual
   */
  async maskPage(pdfDoc, page, pageNum) {
    const { width, height } = page.getSize();

    // Dimensões aproximadas
    const headerHeight = height * 0.15;      // Primeiros 15%
    const footerHeight = height * 0.10;      // Últimos 10%
    const footerStart = height - footerHeight;
    const contentStart = headerHeight;
    const contentEnd = footerStart;

    const white = rgb(1, 1, 1);
    const lightGray = rgb(0.94, 0.94, 0.94);
    const lightBlue = rgb(0.86, 0.94, 1);
    const lightGreen = rgb(0.86, 1, 0.94);

    // 1. Máscara cabeçalho (cliente, conta, agência)
    page.drawRectangle({
      x: 0,
      y: footerStart,
      width: width,
      height: headerHeight,
      color: lightBlue,
      opacity: 0.9,
    });

    page.drawText('[INFORMAÇÕES DE CLIENTE MASCARADAS]', {
      x: 15,
      y: footerStart + headerHeight - 30,
      size: 10,
      color: white,
    });

    // 2. Máscara linhas de transação
    const lineHeight = (contentEnd - contentStart) / 45; // ~45 linhas por página
    let yPos = contentEnd - lineHeight;

    while (yPos > contentStart) {
      page.drawRectangle({
        x: 0,
        y: yPos,
        width: width,
        height: lineHeight - 2,
        color: lightGray,
        opacity: 0.85,
      });

      page.drawText('[TRANSAÇÃO MASCARADA]', {
        x: 15,
        y: yPos + (lineHeight / 2) - 8,
        size: 9,
        color: white,
      });

      yPos -= lineHeight;
    }

    // 3. Máscara rodapé (saldos, totalizadores)
    page.drawRectangle({
      x: 0,
      y: 0,
      width: width,
      height: footerHeight,
      color: lightGreen,
      opacity: 0.9,
    });

    page.drawText('[SALDOS E TOTALIZADORES MASCARADOS]', {
      x: 15,
      y: 15,
      size: 10,
      color: white,
    });

    console.log(`  ✓ Página ${pageNum + 1} mascarada`);
  }
}

/**
 * Função principal
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
Mascarador de Extrato Banco do Brasil

Uso:
  node mask-bb-extrato-pdf.mjs <input_pdf> [output_pdf]

Exemplos:
  node scripts/mask-bb-extrato-pdf.mjs extrato.pdf extrato-mascarado.pdf
  node scripts/mask-bb-extrato-pdf.mjs extrato.pdf  # Usa: extrato-masked.pdf

Descrição:
  Cobre linhas de transação e informações sensíveis com camadas brancas.
  Útil para criar versões desensibilizadas de extratos bancários.
    `);
    process.exit(0);
  }

  const inputPath = args[0];
  const outputPath = args[1];

  try {
    const masker = new BbExtratoMasker(inputPath, outputPath);
    await masker.maskPdf();
  } catch (error) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Erro fatal:', error);
  process.exit(1);
});
