/**
 * Restaura todas as empresas do arquivo eye-vision-dados-RECUPERADO.json
 * para o servidor ERP via API /api/agent/sync/save
 */

import fs from 'fs';

const BACKUP_FILE = 'C:\\Users\\ronaldo.silva\\Desktop\\eye-vision-dados-RECUPERADO.json';
const API_BASE = 'http://localhost:3000/api/agent';

// Sufixos que vão para o manager por empresa
const MANAGER_SUFFIXES = [
  'extrato', 'plano', 'razao', 'folha', 'folhaRelatorio',
  'balancete', 'fiscalSped', 'fiscalNfe', 'fiscalPgdas',
  'honorariosLancamentos', 'honorariosRelatorio',
];

function slugFromName(name) {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

async function main() {
  console.log('📂 Lendo backup:', BACKUP_FILE);
  const raw = fs.readFileSync(BACKUP_FILE, 'utf-8');
  const backup = JSON.parse(raw);
  const storage = backup.storage;

  const token = storage['gc_company_access_token'] || 'CL-FN14-AZ4ZV81Y';
  console.log(`🔑 Token: ${token}`);
  console.log(`📅 Exportado em: ${backup.exportedAt}`);

  // --- 1. MONTA OFFICE PAYLOAD ---
  const registry = storage['contabilfacil_companies_registry_v1'];
  const deletedCompanies = storage['contabilfacil_deleted_companies_v1'] || [];
  const selectedCompany = storage['contabilfacil_selected_company_v1'] || '';
  const pricingRegistry = storage['contabilfacil_pricing_companies_registry_v1'] || [];
  const pricingSelected = storage['contabilfacil_pricing_selected_company_v1'] || '';

  // extra_storage: tudo que NÃO é manager data nem as chaves explícitas acima
  const explicitKeys = new Set([
    'contabilfacil_companies_registry_v1',
    'contabilfacil_deleted_companies_v1',
    'contabilfacil_selected_company_v1',
    'contabilfacil_pricing_companies_registry_v1',
    'contabilfacil_pricing_selected_company_v1',
    'gc_company_access_token',
    'simulador_contracts',
    'simulador_parcelamentos',
    'simulador_aplicacoes',
  ]);

  function isManagerDataKey(key) {
    if (!key.startsWith('contabilfacil_')) return false;
    const rest = key.slice('contabilfacil_'.length);
    return MANAGER_SUFFIXES.some(s => rest.endsWith(`_${s}`));
  }

  const extraStorage = {};
  for (const [key, value] of Object.entries(storage)) {
    if (explicitKeys.has(key)) continue;
    if (isManagerDataKey(key)) continue;
    if (key === 'gc_company_access_token') continue;
    extraStorage[key] = value;
  }

  const officePayload = {
    companies_registry: registry,
    deleted_companies: deletedCompanies,
    selected_company: selectedCompany,
    pricing_companies_registry: pricingRegistry,
    pricing_selected_company: pricingSelected,
    simulador_contracts: storage['simulador_contracts'] || [],
    simulador_parcelamentos: storage['simulador_parcelamentos'] || [],
    simulador_aplicacoes: storage['simulador_aplicacoes'] || [],
    extra_storage: extraStorage,
  };

  // --- 2. MONTA MANAGERS POR EMPRESA ---
  // Detecta slugs de empresas a partir das chaves do storage
  const companySlugsFound = new Set();
  for (const key of Object.keys(storage)) {
    if (!key.startsWith('contabilfacil_')) continue;
    for (const suffix of MANAGER_SUFFIXES) {
      if (key.endsWith(`_${suffix}`)) {
        const slug = key
          .slice('contabilfacil_'.length, key.length - suffix.length - 1);
        if (slug) companySlugsFound.add(slug);
      }
    }
  }

  // Mapeia slug → nome real (do registry)
  const slugToName = {};
  if (Array.isArray(registry)) {
    for (const company of registry) {
      const s = slugFromName(company.name || '');
      slugToName[s] = company.name;
    }
  }

  const managers = [];
  for (const slug of companySlugsFound) {
    const companyName = slugToName[slug] || slug.replace(/_/g, ' ');
    const data = {};
    for (const suffix of MANAGER_SUFFIXES) {
      const key = `contabilfacil_${slug}_${suffix}`;
      if (key in storage) {
        const val = storage[key];
        if (Array.isArray(val) && val.length > 0) {
          data[suffix] = val;
        } else if (typeof val === 'string') {
          // Alguns estão como string JSON (fiscalPgdas etc.)
          try {
            const parsed = JSON.parse(val);
            if (Array.isArray(parsed) && parsed.length > 0) data[suffix] = parsed;
          } catch { /* skip */ }
        }
      }
    }
    if (Object.keys(data).length > 0) {
      managers.push({ company_slug: slug, company_name: companyName, data });
      const suffixList = Object.keys(data).map(s => `${s}(${data[s].length})`).join(', ');
      console.log(`  📁 ${companyName} (${slug}): ${suffixList}`);
    }
  }

  console.log(`\n✅ ${managers.length} empresa(s) com dados para restaurar`);

  // --- 3. ENVIA AO SERVIDOR ---
  const payload = {
    office: officePayload,
    managers,
  };

  console.log(`\n🚀 Enviando para ${API_BASE}/sync/save/${encodeURIComponent(token)} ...`);

  const resp = await fetch(`${API_BASE}/sync/save/${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const result = await resp.json();
  if (result.ok) {
    console.log('✅ RESTAURAÇÃO CONCLUÍDA COM SUCESSO!');
    console.log(`   Empresas restauradas: ${managers.map(m => m.company_name).join(', ')}`);
  } else {
    console.error('❌ Falha na restauração:', result);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('❌ Erro fatal:', err);
  process.exit(1);
});
