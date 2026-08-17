/**
 * Envio de e-mail via SMTP — partilhado entre reset de senha e confirmação de nome.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function sendSmtpEmail({ to, subject, text, html }) {
  const host = String(process.env.SMTP_HOST || '').trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '').trim();
  const from = String(process.env.SMTP_FROM || user || 'noreply@contabilfacil.local').trim();
  if (!host || !user || !pass) {
    throw new Error('SMTP não configurado (SMTP_HOST / SMTP_USER / SMTP_PASS).');
  }

  // Preferir nodemailer se existir no runtime; senão PowerShell (.NET) no Windows.
  try {
    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
    await transporter.sendMail({ from, to, subject, text, html });
    return 'nodemailer';
  } catch {
    /* fallback Windows */
  }

  if (process.platform !== 'win32') {
    throw new Error('SMTP indisponível (instale nodemailer ou use Windows com SMTP).');
  }

  const safe = (s) =>
    String(s || '')
      .replace(/'/g, "''")
      .replace(/\r?\n/g, '`n');

  const ps = `
$ErrorActionPreference = 'Stop'
$smtp = New-Object System.Net.Mail.SmtpClient('${safe(host)}', ${port})
$smtp.EnableSsl = $${port === 465 || port === 587}
$smtp.Credentials = New-Object System.Net.NetworkCredential('${safe(user)}', '${safe(pass)}')
$msg = New-Object System.Net.Mail.MailMessage
$msg.From = '${safe(from)}'
$msg.To.Add('${safe(to)}')
$msg.Subject = '${safe(subject)}'
$msg.Body = '${safe(text)}'
$msg.IsBodyHtml = $false
$smtp.Send($msg)
$msg.Dispose()
$smtp.Dispose()
`;
  await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
    { windowsHide: true, timeout: 60_000 },
  );
  return 'powershell-smtp';
}
