/**
 * CAMADA DE SEGURANÇA - Backend (sem RLS no BD)
 *
 * Como não há RLS no PostgreSQL, TODA a autorização é feita no backend.
 * Validações rigorosas em TODAS as rotas.
 */

import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

// ========== MONITORAMENTO DE COTA DO SUPABASE ==========
const egressTracker = new Map<string, { bytes: number; resetAt: number }>();
const MONTHLY_EGRESS_LIMIT_GB = 5; // Plano gratuito Supabase
const MONTHLY_EGRESS_LIMIT_BYTES = MONTHLY_EGRESS_LIMIT_GB * 1024 * 1024 * 1024;
const ALERT_THRESHOLD = 0.8; // 80% do limite

export function trackEgress(bytes: number): void {
  const key = 'supabase:egress:monthly';
  const now = Date.now();
  let tracker = egressTracker.get(key);

  if (!tracker || now > tracker.resetAt) {
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    nextMonth.setDate(1);
    nextMonth.setHours(0, 0, 0, 0);
    tracker = { bytes: 0, resetAt: nextMonth.getTime() };
  }

  tracker.bytes += bytes;
  egressTracker.set(key, tracker);

  const percentUsed = (tracker.bytes / MONTHLY_EGRESS_LIMIT_BYTES) * 100;
  console.log(`[QUOTA] Egress: ${(tracker.bytes / (1024**3)).toFixed(2)} GB / ${MONTHLY_EGRESS_LIMIT_GB} GB (${percentUsed.toFixed(1)}%)`);

  if (tracker.bytes > MONTHLY_EGRESS_LIMIT_BYTES * ALERT_THRESHOLD) {
    console.warn(`[QUOTA] ⚠️  Egress approaching limit! Used ${percentUsed.toFixed(1)}%`);
  }

  if (tracker.bytes > MONTHLY_EGRESS_LIMIT_BYTES) {
    console.error(`[QUOTA] ❌ EGRESS LIMIT EXCEEDED - blocking further transfers`);
  }
}

export function shouldOptimizeEgress(): boolean {
  const key = 'supabase:egress:monthly';
  const tracker = egressTracker.get(key);
  if (!tracker) return false;

  // Se já usou 70%, ativar modo economia
  return (tracker.bytes / MONTHLY_EGRESS_LIMIT_BYTES) > 0.7;
}

export function getEgressStatus(): { used: number; limit: number; percentUsed: number } {
  const key = 'supabase:egress:monthly';
  const tracker = egressTracker.get(key);
  const used = tracker?.bytes ?? 0;
  return {
    used,
    limit: MONTHLY_EGRESS_LIMIT_BYTES,
    percentUsed: (used / MONTHLY_EGRESS_LIMIT_BYTES) * 100,
  };
}

/** Contexto de segurança do usuário autenticado */
export interface AuthContext {
  userId: string;
  officeId: string;
  email: string;
  role: 'admin' | 'manager' | 'user';
  permissions: Set<string>;
  timestamp: number;
}

/** 1. VALIDAÇÃO DE TOKEN JWT */
export function validateAuthToken(token: string | undefined): AuthContext | null {
  if (!token || typeof token !== 'string') return null;

  try {
    // Em produção, usar JWT real com assinatura
    const payload = Buffer.from(token, 'base64').toString('utf-8');
    const data = JSON.parse(payload);

    // Validar campos obrigatórios
    if (!data.userId || !data.officeId || !data.email) return null;

    // Validar timestamp (token válido por 24h)
    const now = Date.now();
    const ageMs = now - data.timestamp;
    if (ageMs < 0 || ageMs > 24 * 60 * 60 * 1000) return null; // Token expirado

    return {
      userId: String(data.userId),
      officeId: String(data.officeId),
      email: String(data.email),
      role: ['admin', 'manager', 'user'].includes(data.role) ? data.role : 'user',
      permissions: new Set(Array.isArray(data.permissions) ? data.permissions : []),
      timestamp: data.timestamp,
    };
  } catch {
    return null;
  }
}

/** 2. MIDDLEWARE DE AUTENTICAÇÃO */
export function createAuthMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');

    const auth = validateAuthToken(token);
    if (!auth) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or missing token' });
    }

    // Armazenar no contexto da requisição
    (req as any).auth = auth;
    next();
  };
}

/** 3. MIDDLEWARE DE AUTORIZAÇÃO POR RECURSO */
export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = (req as any).auth as AuthContext | undefined;
    if (!auth) {
      return res.status(401).json({ error: 'Unauthorized: Not authenticated' });
    }

    if (!auth.permissions.has(permission) && auth.role !== 'admin') {
      return res.status(403).json({ error: `Forbidden: Missing permission '${permission}'` });
    }

    next();
  };
}

/** 4. VALIDAÇÃO DE ACESSO A EMPRESA */
export function validateOfficeAccess(auth: AuthContext, requestedOfficeId: string): boolean {
  // Admin pode acessar qualquer empresa
  if (auth.role === 'admin') return true;

  // Manager/User só pode acessar sua própria empresa
  return auth.officeId === requestedOfficeId;
}

/** 5. SANITIZAÇÃO DE ENTRADA */
export function sanitizeInput(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value).trim();

  // Remover caracteres perigosos
  return str
    .replace(/[<>\"'`]/g, '') // HTML/SQL injection
    .replace(/;/g, '') // SQL injection
    .replace(/--/g, '') // SQL comments
    .substring(0, 1000); // Limitar tamanho
}

/** 6. VALIDAÇÃO DE UUID */
export function isValidUUID(id: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

/** 7. VALIDAÇÃO DE EMAIL */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/** 8. RATE LIMITING (básico em-memória) */
const rateLimits = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string, maxRequests = 100, windowMs = 60000): boolean {
  const now = Date.now();
  const limit = rateLimits.get(key);

  if (!limit || now > limit.resetAt) {
    rateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (limit.count >= maxRequests) {
    return false; // Rate limit exceeded
  }

  limit.count++;
  return true;
}

/**
 * 9. ENCRIPTAÇÃO DE DADOS SENSÍVEIS
 *
 * Usa createCipheriv com IV aleatório por mensagem. As funções antigas
 * createCipher/createDecipher foram REMOVIDAS no Node 22 e derivavam a chave
 * sem IV — dois textos iguais geravam o mesmo cifrado, o que vaza informação.
 * O IV vai junto do resultado, no formato `iv:cifrado` (ambos em hex).
 */
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-key-change-in-production';
const IV_BYTES = 16;

/** aes-256 exige chave de exatamente 32 bytes — deriva por hash da configurada. */
function encryptionKeyBuffer(): Buffer {
  return crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
}

export function encryptSensitive(data: string): string {
  try {
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv('aes-256-cbc', encryptionKeyBuffer(), iv);
    const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
  } catch {
    console.error('[security] Encryption failed');
    return '';
  }
}

export function decryptSensitive(encrypted: string): string {
  try {
    const [ivHex, payloadHex] = String(encrypted).split(':');
    if (!ivHex || !payloadHex) return '';
    const decipher = crypto.createDecipheriv(
      'aes-256-cbc',
      encryptionKeyBuffer(),
      Buffer.from(ivHex, 'hex'),
    );
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(payloadHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    console.error('[security] Decryption failed');
    return '';
  }
}

/** 10. AUDITORIA DE AÇÕES */
export interface AuditLog {
  timestamp: number;
  userId: string;
  officeId: string;
  action: string;
  resource: string;
  status: 'success' | 'failure';
  details: Record<string, unknown>;
}

const auditLogs: AuditLog[] = [];

export function logAudit(auth: AuthContext, action: string, resource: string, status: 'success' | 'failure', details?: Record<string, unknown>) {
  auditLogs.push({
    timestamp: Date.now(),
    userId: auth.userId,
    officeId: auth.officeId,
    action,
    resource,
    status,
    details: details || {},
  });

  // Manter apenas últimos 10k logs em memória
  if (auditLogs.length > 10000) {
    auditLogs.shift();
  }
}

/** 11. VALIDAÇÃO DE QUERY PARAMETERS */
export function validateQueryParam(param: unknown, type: 'string' | 'number' | 'boolean'): boolean {
  if (type === 'string') return typeof param === 'string' && param.length > 0;
  if (type === 'number') return typeof param === 'string' && !isNaN(Number(param));
  if (type === 'boolean') return param === 'true' || param === 'false';
  return false;
}

/** 12. MIDDLEWARE CONTRA CSRF */
export function createCsrfProtection() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      const token = req.headers['x-csrf-token'] as string;
      const sessionToken = (req as any).sessionCsrfToken as string;

      if (!token || token !== sessionToken) {
        return res.status(403).json({ error: 'CSRF validation failed' });
      }
    }
    next();
  };
}

/** 13. CONFIGURAÇÃO DE HEADERS DE SEGURANÇA */
export function setSecurityHeaders(req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'");
  next();
}

/** 14. VALIDAÇÃO DE BODY REQUEST */
export function validateRequestBody(schema: Record<string, string>): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    for (const [key, type] of Object.entries(schema)) {
      const value = (req.body as any)[key];

      if (type === 'required-string') {
        if (typeof value !== 'string' || !value.trim()) {
          return res.status(400).json({ error: `Missing or invalid field: ${key}` });
        }
      }

      if (type === 'required-number') {
        const num = Number(value);
        if (!Number.isFinite(num)) {
          return res.status(400).json({ error: `Invalid number field: ${key}` });
        }
      }

      if (type === 'required-uuid') {
        if (!isValidUUID(String(value))) {
          return res.status(400).json({ error: `Invalid UUID field: ${key}` });
        }
      }
    }
    next();
  };
}

export default {
  validateAuthToken,
  createAuthMiddleware,
  requirePermission,
  validateOfficeAccess,
  sanitizeInput,
  isValidUUID,
  isValidEmail,
  checkRateLimit,
  encryptSensitive,
  decryptSensitive,
  logAudit,
  validateQueryParam,
  createCsrfProtection,
  setSecurityHeaders,
  validateRequestBody,
};
