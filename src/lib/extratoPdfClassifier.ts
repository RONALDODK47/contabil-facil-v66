/**
 * Classifica documento de extrato: texto nativo (recorte) vs scanner/imagem (extração IA).
 */

export type ExtratoDocumentKind = 'native_text' | 'scanned_or_image';

const RE_DATA = /\d{1,2}\s*[/.-]\s*\d{1,2}(?:\s*[/.-]\s*\d{2,4})?/;
const RE_MOEDA = /[0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2}|[0-9]+\.[0-9]{2}/;

export function isExtratoImageFile(file: File): boolean {
  const n = file.name.toLowerCase();
  const t = (file.type || '').toLowerCase();
  return (
    t.startsWith('image/') ||
    n.endsWith('.png') ||
    n.endsWith('.jpg') ||
    n.endsWith('.jpeg') ||
    n.endsWith('.webp') ||
    n.endsWith('.gif') ||
    n.endsWith('.bmp') ||
    n.endsWith('.tif') ||
    n.endsWith('.tiff')
  );
}

function textLooksLikeExtrato(items: Array<{ text: string }>): boolean {
  if (items.length < 12) return false;
  const hasMoney = items.some((it) => RE_MOEDA.test(it.text));
  const hasDates = items.some((it) => RE_DATA.test(it.text));
  return hasMoney && hasDates;
}

/**
 * Decide se o extrato deve abrir o leitor-recortador (PDF com texto tabular)
 * ou a interface de extração com IA (scanner / imagem / PDF sem texto útil).
 */
export async function classifyExtratoDocument(file: File): Promise<ExtratoDocumentKind> {
  if (isExtratoImageFile(file)) return 'scanned_or_image';

  const name = file.name.toLowerCase();
  const type = (file.type || '').toLowerCase();
  const isPdf = type === 'application/pdf' || name.endsWith('.pdf');
  if (!isPdf) return 'scanned_or_image';

  try {
    // Import dinâmico: evita carregar pdf.js em caminhos só de imagem.
    const { parseAndRenderPDFPage } = await import('./leitorRecortador/pdfParser');
    const page = await parseAndRenderPDFPage(file, 1);
    if (!page.textItems.length) return 'scanned_or_image';

    if (textLooksLikeExtrato(page.textItems)) return 'native_text';
    if (page.textItems.length >= 40) return 'native_text';
    return 'scanned_or_image';
  } catch {
    return 'scanned_or_image';
  }
}
