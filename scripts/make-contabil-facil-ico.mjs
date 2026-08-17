/**
 * Gera contabil-facil.ico (CF azul, borda azul, fundo branco) a partir de um PNG
 * ou desenha via System.Drawing no PowerShell companion.
 * Este script só empacota PNGs em ICO multi-size (Node puro).
 *
 * Uso: node scripts/make-contabil-facil-ico.mjs [pngSource]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const INTERFACE_SRC = path.join(
  process.env.USERPROFILE || '',
  'Desktop',
  'SETUP SOFTWARE',
  'SETUP INTERFACE (PODE COMPARTILHAR)',
  'src',
);

const pngArg = process.argv[2];
const pngSource =
  pngArg ||
  path.join(
    process.env.USERPROFILE || '',
    '.cursor',
    'projects',
    'c-Users-ronaldo-silva-Desktop-SOFTWARE-NOVO-PRO',
    'assets',
    'contabil-facil-icon-source.png',
  );

const outIco = path.join(INTERFACE_SRC, 'contabil-facil.ico');
const outPng = path.join(INTERFACE_SRC, 'contabil-facil.png');

const ps = `
Add-Type -AssemblyName System.Drawing
$src = ${JSON.stringify(pngSource)}
$outIco = ${JSON.stringify(outIco)}
$outPng = ${JSON.stringify(outPng)}
$sizes = @(16, 32, 48, 64, 128, 256)

function New-DrawnBitmap([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
  $g.Clear([System.Drawing.Color]::White)
  $blue = [System.Drawing.Color]::FromArgb(255, 37, 99, 235)
  $penW = [Math]::Max(2, [int]([Math]::Round($size * 0.07)))
  $pen = New-Object System.Drawing.Pen $blue, $penW
  $pen.Alignment = [System.Drawing.Drawing2D.PenAlignment]::Inset
  $m = [int]([Math]::Round($size * 0.08))
  $radius = [Math]::Max(2, [int]([Math]::Round($size * 0.1)))
  $rect = New-Object System.Drawing.Rectangle ($m), ($m), ($size - 2 * $m - 1), ($size - 2 * $m - 1)
  # rounded rect path
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $radius * 2
  $path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
  $path.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
  $path.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
  $path.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  $g.DrawPath($pen, $path)
  $fontSize = [Math]::Max(8, [single]($size * 0.38))
  $font = New-Object System.Drawing.Font "Segoe UI", $fontSize, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $brush = New-Object System.Drawing.SolidBrush $blue
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $full = New-Object System.Drawing.RectangleF 0, ($size * 0.02), $size, $size
  $g.DrawString("CF", $font, $brush, $full, $sf)
  $g.Dispose(); $pen.Dispose(); $font.Dispose(); $brush.Dispose(); $path.Dispose()
  return $bmp
}

$bitmaps = @()
if (Test-Path $src) {
  $orig = [System.Drawing.Image]::FromFile($src)
  foreach ($s in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap $s, $s
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.Clear([System.Drawing.Color]::White)
    $g.DrawImage($orig, 0, 0, $s, $s)
    $g.Dispose()
    $bitmaps += $bmp
  }
  $orig.Dispose()
  # also save 256 png clean
  $bitmaps[-1].Save($outPng, [System.Drawing.Imaging.ImageFormat]::Png)
} else {
  foreach ($s in $sizes) { $bitmaps += (New-DrawnBitmap $s) }
  $bitmaps[-1].Save($outPng, [System.Drawing.Imaging.ImageFormat]::Png)
}

# Build ICO manually (PNG-compressed entries — Windows Vista+)
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter $ms
$bw.Write([uint16]0)      # reserved
$bw.Write([uint16]1)      # type icon
$bw.Write([uint16]$bitmaps.Count)
$imageDatas = @()
foreach ($bmp in $bitmaps) {
  $pngMs = New-Object System.IO.MemoryStream
  $bmp.Save($pngMs, [System.Drawing.Imaging.ImageFormat]::Png)
  $imageDatas += ,$pngMs.ToArray()
  $pngMs.Dispose()
}
$headerSize = 6 + (16 * $bitmaps.Count)
$offset = $headerSize
for ($i = 0; $i -lt $bitmaps.Count; $i++) {
  $s = $sizes[$i]
  $w = if ($s -ge 256) { 0 } else { $s }
  $h = $w
  $bw.Write([byte]$w)
  $bw.Write([byte]$h)
  $bw.Write([byte]0)  # colors
  $bw.Write([byte]0)  # reserved
  $bw.Write([uint16]1) # planes
  $bw.Write([uint16]32) # bitcount
  $bw.Write([uint32]$imageDatas[$i].Length)
  $bw.Write([uint32]$offset)
  $offset += $imageDatas[$i].Length
}
foreach ($data in $imageDatas) { $bw.Write($data) }
$bw.Flush()
[IO.File]::WriteAllBytes($outIco, $ms.ToArray())
$bw.Dispose(); $ms.Dispose()
foreach ($b in $bitmaps) { $b.Dispose() }
Write-Host "ICO OK $outIco"
Write-Host "PNG OK $outPng"
`;

const r = spawnSync('powershell.exe', ['-NoProfile', '-STA', '-Command', ps], {
  encoding: 'utf8',
  windowsHide: true,
});
if (r.stdout) process.stdout.write(r.stdout);
if (r.stderr) process.stderr.write(r.stderr);
if (r.status !== 0) process.exit(r.status ?? 1);

// Também copia para o Contábil Fácil já instalado, se existir
const installed = path.join(
  process.env.LOCALAPPDATA || '',
  'Programs',
  'Contabil Facil',
  'contabil-facil.ico',
);
if (fs.existsSync(path.dirname(installed)) && fs.existsSync(outIco)) {
  fs.copyFileSync(outIco, installed);
  console.log('[ico] instalado →', installed);
}

console.log('[ico] pronto');
