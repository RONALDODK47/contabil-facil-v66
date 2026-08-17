import type { TributaryRegimeDetails } from './pricingTypes';

export type TributaryRegime = 'Simples Nacional' | 'Lucro Presumido' | 'Lucro Real';

/**
 * Regras tributárias para cada tipo de imposto por regime.
 * Retorna se é recuperável, alíquota zero, monofásico, ou ICMS ST.
 */
export function getTributaryRegimeDetails(
  regime: TributaryRegime,
  impostoTipo: string,
): TributaryRegimeDetails {
  const tipo = impostoTipo.toUpperCase();

  if (regime === 'Simples Nacional') {
    return getSimpleNacionalRules(tipo);
  }

  if (regime === 'Lucro Presumido') {
    return getLucroPresumidoRules(tipo);
  }

  if (regime === 'Lucro Real') {
    return getLucroRealRules(tipo);
  }

  return {
    regime,
    isRecuperavel: false,
    isAliquotaZero: false,
    isMonofasico: false,
    isIcmsSt: false,
    observacoes: 'Regime não reconhecido',
  };
}

function getSimpleNacionalRules(tipo: string): TributaryRegimeDetails {
  // Simples Nacional: geralmente SEM crédito para PIS/COFINS
  // ICMS limitado ao sublimite
  if (tipo.includes('PIS') || tipo.includes('PASEP')) {
    return {
      regime: 'Simples Nacional',
      isRecuperavel: false,
      isAliquotaZero: false,
      isMonofasico: false,
      isIcmsSt: false,
      observacoes: 'Regime: PIS geralmente não é recuperável em Simples Nacional',
    };
  }

  if (tipo.includes('COFINS')) {
    return {
      regime: 'Simples Nacional',
      isRecuperavel: false,
      isAliquotaZero: false,
      isMonofasico: false,
      isIcmsSt: false,
      observacoes: 'Regime: COFINS geralmente não é recuperável em Simples Nacional',
    };
  }

  if (tipo.includes('ICMS')) {
    return {
      regime: 'Simples Nacional',
      isRecuperavel: true,
      isAliquotaZero: false,
      isMonofasico: false,
      isIcmsSt: true, // Comum em Simples Nacional
      observacoes: 'Regime: ICMS em Simples Nacional é limitado; verifique sublimite e ICMS ST',
    };
  }

  if (tipo.includes('IPI')) {
    return {
      regime: 'Simples Nacional',
      isRecuperavel: false,
      isAliquotaZero: false,
      isMonofasico: false,
      isIcmsSt: false,
      observacoes: 'Regime: IPI geralmente não é recuperável em Simples Nacional',
    };
  }

  return {
    regime: 'Simples Nacional',
    isRecuperavel: false,
    isAliquotaZero: false,
    isMonofasico: false,
    isIcmsSt: false,
    observacoes: 'Regime Simples Nacional: créditos limitados conforme anexo',
  };
}

function getLucroPresumidoRules(tipo: string): TributaryRegimeDetails {
  // Lucro Presumido: créditos limitados
  // PIS/COFINS têm créditos restritos
  if (tipo.includes('PIS') || tipo.includes('PASEP')) {
    return {
      regime: 'Lucro Presumido',
      isRecuperavel: true,
      isAliquotaZero: false,
      isMonofasico: false,
      isIcmsSt: false,
      observacoes: 'Regime: PIS crédito limitado (insumos essenciais, energia, frete)',
    };
  }

  if (tipo.includes('COFINS')) {
    return {
      regime: 'Lucro Presumido',
      isRecuperavel: true,
      isAliquotaZero: false,
      isMonofasico: false,
      isIcmsSt: false,
      observacoes: 'Regime: COFINS crédito limitado (insumos essenciais, energia, frete)',
    };
  }

  if (tipo.includes('ICMS')) {
    return {
      regime: 'Lucro Presumido',
      isRecuperavel: true,
      isAliquotaZero: false,
      isMonofasico: false,
      isIcmsSt: false,
      observacoes: 'Regime: ICMS recuperável na aquisição de mercadoria/insumos',
    };
  }

  if (tipo.includes('IPI')) {
    return {
      regime: 'Lucro Presumido',
      isRecuperavel: true,
      isAliquotaZero: false,
      isMonofasico: false,
      isIcmsSt: false,
      observacoes: 'Regime: IPI recuperável na cadeia industrial',
    };
  }

  return {
    regime: 'Lucro Presumido',
    isRecuperavel: true,
    isAliquotaZero: false,
    isMonofasico: false,
    isIcmsSt: false,
    observacoes: 'Regime Lucro Presumido: créditos conforme legislação',
  };
}

function getLucroRealRules(tipo: string): TributaryRegimeDetails {
  // Lucro Real: créditos amplos
  if (tipo.includes('PIS') || tipo.includes('PASEP')) {
    return {
      regime: 'Lucro Real',
      isRecuperavel: true,
      isAliquotaZero: false,
      isMonofasico: false,
      isIcmsSt: false,
      observacoes: 'Regime: PIS não cumulativo - crédito amplo sobre insumos, energia, frete',
    };
  }

  if (tipo.includes('COFINS')) {
    return {
      regime: 'Lucro Real',
      isRecuperavel: true,
      isAliquotaZero: false,
      isMonofasico: false,
      isIcmsSt: false,
      observacoes: 'Regime: COFINS não cumulativa - crédito amplo sobre insumos, energia, frete',
    };
  }

  if (tipo.includes('ICMS')) {
    return {
      regime: 'Lucro Real',
      isRecuperavel: true,
      isAliquotaZero: false,
      isMonofasico: false,
      isIcmsSt: false,
      observacoes: 'Regime: ICMS integral conforme documento fiscal e operação',
    };
  }

  if (tipo.includes('IPI')) {
    return {
      regime: 'Lucro Real',
      isRecuperavel: true,
      isAliquotaZero: false,
      isMonofasico: false,
      isIcmsSt: false,
      observacoes: 'Regime: IPI integral na cadeia industrial',
    };
  }

  return {
    regime: 'Lucro Real',
    isRecuperavel: true,
    isAliquotaZero: false,
    isMonofasico: false,
    isIcmsSt: false,
    observacoes: 'Regime Lucro Real: créditos amplos conforme legislação',
  };
}

/**
 * Retorna ícone/badge visual para o regime.
 * Usado na UI para indicar recuperação/alíquota zero/monofásico/ICMS ST.
 */
export function getRegimeBadges(details: TributaryRegimeDetails): Array<{
  label: string;
  tone: string; // 'green', 'amber', 'red', 'blue'
  icon: string; // emoji ou ícone
}> {
  const badges = [];

  if (details.isRecuperavel) {
    badges.push({
      label: '✓ Recuperável',
      tone: 'green',
      icon: '✓',
    });
  } else {
    badges.push({
      label: '✗ Não recuperável',
      tone: 'red',
      icon: '✗',
    });
  }

  if (details.isAliquotaZero) {
    badges.push({
      label: 'Alíquota zero',
      tone: 'blue',
      icon: '0%',
    });
  }

  if (details.isMonofasico) {
    badges.push({
      label: 'Monofásico',
      tone: 'amber',
      icon: '⚡',
    });
  }

  if (details.isIcmsSt) {
    badges.push({
      label: 'ICMS ST',
      tone: 'amber',
      icon: '🔄',
    });
  }

  return badges;
}
