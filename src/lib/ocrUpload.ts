/** Prepara blob de imagem para upload (compressão JPEG quando necessário). */
export async function prepareOcrUploadFile(blob: Blob): Promise<File> {
  const isImage = /^image\/(png|jpe?g|webp)$/i.test(blob.type || '');
  if (isImage && blob.size <= 2_000_000) {
    return blob instanceof File ? blob : new File([blob], 'ocr-upload', { type: blob.type || 'image/png' });
  }
  if (typeof document === 'undefined') {
    return blob instanceof File ? blob : new File([blob], 'ocr.png', { type: blob.type || 'image/png' });
  }
  try {
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bmp.close();
      return blob instanceof File ? blob : new File([blob], 'ocr.png', { type: blob.type || 'image/png' });
    }
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const jpeg = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92),
    );
    if (jpeg) return new File([jpeg], 'ocr.jpg', { type: 'image/jpeg' });
  } catch {
    /* ok */
  }
  return blob instanceof File ? blob : new File([blob], 'ocr.png', { type: blob.type || 'image/png' });
}
