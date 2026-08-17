const ADMIN_LOGIN_EMAILS = new Set([
  'ronaldojunior.gyn@gmail.com',
  'ronaldojunior.gyn@usuario.local',
  'ronaldojunior.gyn.emergencia@usuario.local',
]);

export function isAdminLoginEmailIdentifier(value: string): boolean {
  return ADMIN_LOGIN_EMAILS.has(String(value || '').trim().toLowerCase());
}
