import os from 'node:os';
import { execSync } from 'node:child_process';
import { EMBEDDED_AI_CATALOG, MAX_EMBEDDED_RAM_GB } from './local-ai-catalog.mjs';

export { EMBEDDED_AI_CATALOG, MAX_EMBEDDED_RAM_GB };

let nvidiaSmiDisponivel = null;

function tryExec(cmd) {
  if (cmd.includes('nvidia-smi') && nvidiaSmiDisponivel === false) return '';
  try {
    const out = execSync(cmd, {
      encoding: 'utf8',
      timeout: 2000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (cmd.includes('nvidia-smi')) nvidiaSmiDisponivel = true;
    return out;
  } catch {
    if (cmd.includes('nvidia-smi')) nvidiaSmiDisponivel = false;
    return '';
  }
}

function tryPowerShell(script) {
  if (process.platform !== 'win32') return '';
  const escaped = script.replace(/"/g, '\\"');
  return tryExec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${escaped}"`);
}

function detectGpuNames(platform) {
  if (platform === 'win32') {
    const ps = tryPowerShell(
      'Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }',
    );
    if (ps) {
      return ps.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    }
    const wmic = tryExec('wmic path win32_VideoController get name');
    if (wmic) {
      return wmic
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && l.toLowerCase() !== 'name');
    }
    return [];
  }
  if (platform === 'linux') {
    const raw = tryExec('lspci | grep -iE "vga|3d|display"');
    return raw ? raw.split(/\n/).map((l) => l.trim()).filter(Boolean) : [];
  }
  if (platform === 'darwin') {
    const raw = tryExec('system_profiler SPDisplaysDataType | grep -E "Chipset Model|VRAM"');
    return raw ? raw.split(/\n/).map((l) => l.trim()).filter(Boolean) : [];
  }
  return [];
}

function detectVramGb(platform, gpuNames) {
  if (platform === 'win32') {
    const nvidia = tryExec('nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits');
    if (nvidia) {
      const mb = Number.parseInt(nvidia.split(/\r?\n/)[0]?.trim() ?? '', 10);
      if (Number.isFinite(mb) && mb > 0) return Math.round((mb / 1024) * 10) / 10;
    }
    const psVram = tryPowerShell(
      '[math]::Round((Get-CimInstance Win32_VideoController | Measure-Object AdapterRAM -Maximum).Maximum / 1GB, 1)',
    );
    if (psVram) {
      const gb = Number.parseFloat(psVram);
      if (Number.isFinite(gb) && gb >= 0.25 && gb <= 64) return gb;
    }
    const wmic = tryExec('wmic path win32_VideoController get AdapterRAM');
    if (wmic) {
      const values = wmic
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !/^adapterram$/i.test(l))
        .map((l) => Number.parseInt(l, 10))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (values.length > 0) {
        const maxBytes = Math.max(...values);
        const gb = maxBytes / 1024 ** 3;
        if (gb >= 0.25 && gb <= 64) return Math.round(gb * 10) / 10;
      }
    }
  }
  if (platform === 'linux') {
    const nvidia = tryExec('nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits');
    if (nvidia) {
      const mb = Number.parseInt(nvidia.split(/\n/)[0]?.trim() ?? '', 10);
      if (Number.isFinite(mb) && mb > 0) return Math.round((mb / 1024) * 10) / 10;
    }
  }
  if (platform === 'darwin') {
    const raw = tryExec('system_profiler SPDisplaysDataType');
    const match = raw.match(/VRAM \(Dynamic, Max\):\s*(\d+)\s*MB/i) || raw.match(/VRAM \(Total\):\s*(\d+)\s*MB/i);
    if (match) return Math.round((Number(match[1]) / 1024) * 10) / 10;
  }

  const joined = gpuNames.join(' ').toLowerCase();
  if (/(\d+)\s*gb/.test(joined)) {
    const m = joined.match(/(\d+)\s*gb/);
    if (m) return Number(m[1]);
  }
  return 0;
}

function classifyGpu(gpuNames) {
  const joined = gpuNames.join(' · ').trim();
  const lower = joined.toLowerCase();
  const virtualGpu = /microsoft basic|virtual|parsec|teamviewer|remote|iddcx|citrix/i.test(lower);
  const discrete =
    !virtualGpu &&
    (/nvidia|geforce|rtx|gtx|quadro|tesla/i.test(lower) ||
      /radeon\s+rx\s*\d|amd\s+radeon\s+rx/i.test(lower) ||
      /intel\s+arc/i.test(lower));
  const integrated =
    !discrete &&
    /intel\s+(uhd|iris|hd)|radeon\s+graphics|vega|microsoft basic/i.test(lower);
  return {
    gpuHint: joined || undefined,
    gpuName: gpuNames[0] || undefined,
    discreteGpu: discrete,
    integratedGpu: integrated,
  };
}

let cachedProfile = null;
let cachedProfileAt = 0;
const PROFILE_CACHE_MS = 60_000;

export function analyzeSystemProfile() {
  if (cachedProfile && Date.now() - cachedProfileAt < PROFILE_CACHE_MS) {
    return { ...cachedProfile, freeRamGb: Math.round((os.freemem() / 1024 ** 3) * 10) / 10 };
  }
  const totalRamGb = Math.round((os.totalmem() / 1024 ** 3) * 10) / 10;
  const freeRamGb = Math.round((os.freemem() / 1024 ** 3) * 10) / 10;
  const cpuCount = os.cpus().length;
  const cpuModel = os.cpus()[0]?.model?.trim() || 'CPU';
  const platform = process.platform;
  const arch = os.arch();
  const gpuNames = detectGpuNames(platform);
  const gpuInfo = classifyGpu(gpuNames);
  const vramGb = detectVramGb(platform, gpuNames);

  /** IA embarcada nunca assume mais RAM do que MAX_EMBEDDED_RAM_GB. */
  const effectiveRamGb = Math.min(totalRamGb, MAX_EMBEDDED_RAM_GB);
  const usableRamGb = Math.round(Math.max(freeRamGb, effectiveRamGb * 0.45) * 10) / 10;
  const compatible = EMBEDDED_AI_CATALOG.filter(
    (m) => (m.minRamGb ?? 0) <= effectiveRamGb && (m.maxRamGb ?? MAX_EMBEDDED_RAM_GB) >= effectiveRamGb,
  );
  const recommended = compatible[0] ?? EMBEDDED_AI_CATALOG[0];

  cachedProfile = {
    totalRamGb,
    freeRamGb,
    effectiveRamGb,
    maxEmbeddedRamGb: MAX_EMBEDDED_RAM_GB,
    usableRamGb,
    cpuCount,
    cpuModel,
    platform,
    arch,
    gpuHint: gpuInfo.gpuHint,
    gpuName: gpuInfo.gpuName,
    vramGb,
    discreteGpu: gpuInfo.discreteGpu,
    integratedGpu: gpuInfo.integratedGpu,
    compatibleModels: compatible.map((m) => m.id),
    recommendedModelId: recommended?.id,
    analyzedAt: new Date().toISOString(),
  };
  cachedProfileAt = Date.now();
  return { ...cachedProfile };
}

export function invalidateSystemProfileCache() {
  cachedProfile = null;
  cachedProfileAt = 0;
}
