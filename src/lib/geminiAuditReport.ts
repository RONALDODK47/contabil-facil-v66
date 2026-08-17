import type { GeminiAuditIssue, GeminiAuditResultBase } from './geminiMonitorClient';

const TIPO_CORRECAO_LABEL: Record<string, string> = {
  usuario: 'Ação na interface',
  codigo: 'Correção no código',
  reimportar: 'Reimportar extrato',
};

const SEVERITY_LABEL: Record<string, string> = {
  error: 'Erro',
  warning: 'Alerta',
  info: 'Info',
};

export function formatGeminiAuditReportText(result: GeminiAuditResultBase): string {
  const lines: string[] = ['=== RELATÓRIO DE INCONSISTÊNCIAS — GEMINI ===', ''];

  if (result.relatorio) {
    lines.push('RESUMO GERAL', result.relatorio, '');
  } else if (result.summary) {
    lines.push('RESUMO', result.summary, '');
  }

  if ('saldoCoerente' in result && result.saldoCoerente === false) {
    lines.push('⚠ Saldo final provavelmente incoerente com o PDF', '');
  }

  if (result.acoesRecomendadas?.length) {
    lines.push('AÇÕES RECOMENDADAS');
    result.acoesRecomendadas.forEach((a, i) => lines.push(`${i + 1}. ${a}`));
    lines.push('');
  }

  if (result.issues?.length) {
    lines.push('PROBLEMAS DETECTADOS');
    result.issues.forEach((issue, idx) => {
      lines.push('', `--- ${idx + 1}. [${SEVERITY_LABEL[issue.severity] ?? issue.severity}] ${issue.title} ---`);
      if (issue.detail) lines.push(`O quê: ${issue.detail}`);
      if (issue.onde) lines.push(`Onde: ${issue.onde}`);
      if (issue.moduloOuArquivo) lines.push(`Módulo/arquivo: ${issue.moduloOuArquivo}`);
      if (issue.tipoCorrecao) {
        lines.push(`Tipo: ${TIPO_CORRECAO_LABEL[issue.tipoCorrecao] ?? issue.tipoCorrecao}`);
      }
      if (issue.comoCorrigir) lines.push(`Como corrigir: ${issue.comoCorrigir}`);
      if (issue.passos?.length) {
        lines.push('Passos:');
        issue.passos.forEach((p, i) => lines.push(`  ${i + 1}. ${p}`));
      }
    });
    lines.push('');
  }

  if (result.diagnosticoTecnico) {
    lines.push('DIAGNÓSTICO TÉCNICO (pipeline OCR)', result.diagnosticoTecnico, '');
  }

  return lines.join('\n').trim();
}

export function geminiAuditHasCriticalIssues(result: GeminiAuditResultBase | null | undefined): boolean {
  if (result && 'saldoCoerente' in result && result.saldoCoerente === false) return true;
  return (result?.issues ?? []).some((i) => i.severity === 'error');
}

export function geminiAuditExecutiveMessage(result: GeminiAuditResultBase): string {
  const critical = (result.issues ?? []).filter((i) => i.severity === 'error');
  const first = critical[0] ?? result.issues?.[0];
  const base = result.summary ?? result.relatorio?.slice(0, 180) ?? 'Análise concluída.';
  if (!first?.comoCorrigir) return base;
  return `${base} → Corrigir: ${first.comoCorrigir.slice(0, 120)}`;
}

export { TIPO_CORRECAO_LABEL, SEVERITY_LABEL };
