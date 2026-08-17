/**
 * Valida PDF Sicredi escaneado (Sindicato 06/2026).
 * Uso: node scripts/test-sicredi-scanner.mjs [caminho.pdf]
 */
import fs from 'fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const pdfPath =
  process.argv[2] ||
  'p:/EMPRESAS/ATIVAS/IMUNE ISENTAS/SINDICATO NACIONAL DE SERV FEDERAIS DA EDUCAÇÃO BASICA E PROF E TECNOLOGIA/RECORRENTE/2026/CONTABIL/DOCUMENTOS PARA CONTABILIZAÇÃO/06-2026/EXTRATO COM INFORMAÇÕES (3).pdf';

const buf = fs.readFileSync(pdfPath);
const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;

console.log('Arquivo:', pdfPath);
console.log('Páginas:', doc.numPages);

let hasNativeText = false;
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const text = tc.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
  if (text.length > 0) hasNativeText = true;
  console.log(`  pág ${p}: ${Math.round(vp.width)}x${Math.round(vp.height)}px — texto nativo: ${text.length} chars`);
}

console.log('Tipo:', hasNativeText ? 'PDF com texto' : 'PDF escaneado (scanner)');
console.log('Esperado: 4 páginas escaneadas, banco Sicredi detectável via OCR/visão');

const blob = `${pdfPath}`.toLowerCase();
const bankFromName = /sicredi/i.test(blob) ? 'sicredi' : null;
console.log('Banco pelo nome do arquivo:', bankFromName ?? 'não detectado (normal — OCR/visão detecta no cabeçalho)');
