/**
 * Pré-processamento de extrato colorido para Tesseract (Node / scripts).
 */
import sharp from 'sharp';

export async function preprocessExtratoImageFile(inputPath, outputPath) {
  const meta = await sharp(inputPath).metadata();
  const long0 = Math.max(meta.width ?? 0, meta.height ?? 0);
  let pipeline = sharp(inputPath);
  if (long0 > 0 && long0 < 1400) {
    const target = 1920;
    const scale = target / long0;
    pipeline = pipeline.resize({
      width: Math.round((meta.width ?? 800) * scale),
      height: Math.round((meta.height ?? 600) * scale),
      kernel: sharp.kernel.lanczos3,
    });
  }
  await pipeline.greyscale().normalize().sharpen().png().toFile(outputPath);
}
