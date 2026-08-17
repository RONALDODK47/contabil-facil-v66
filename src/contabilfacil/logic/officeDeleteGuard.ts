/**
 * Senha local só para dificultar exclusão acidental de empresa.
 * Não é segurança forte — o admin pode alterar/redefinir a qualquer momento.
 */
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from '../../lib/safeLocalStorage';

export const OFFICE_DELETE_PASSWORD_KEY = 'gc_office_delete_password';
export const DEFAULT_OFFICE_DELETE_PASSWORD = 'excluir';

export function getOfficeDeletePassword(): string {
  try {
    const stored = String(safeLocalStorageGetItem(OFFICE_DELETE_PASSWORD_KEY) || '').trim();
    return stored || DEFAULT_OFFICE_DELETE_PASSWORD;
  } catch {
    return DEFAULT_OFFICE_DELETE_PASSWORD;
  }
}

export function setOfficeDeletePassword(next: string): void {
  const value = String(next || '').trim();
  if (!value) throw new Error('Informe a nova senha de exclusão.');
  safeLocalStorageSetItem(OFFICE_DELETE_PASSWORD_KEY, value);
}

export function verifyOfficeDeletePassword(input: string): boolean {
  return String(input || '').trim() === getOfficeDeletePassword();
}
