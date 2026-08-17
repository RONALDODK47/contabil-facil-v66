/**
 * Script para restaurar todas as empresas do Docker usando psql
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = process.env.CONTABIL_DESKTOP_ROOT
  ? path.resolve(process.env.CONTABIL_DESKTOP_ROOT)
  : path.resolve(SCRIPT_DIR, '..');

const RESTORED_PATH = path.join(REPO_ROOT, '.data', 'restored-offices');

async function execPsql(sql) {
  const { stdout } = await execFileAsync('docker', [
    'exec',
    'eye-vision-postgres',
    'psql',
    '-U', 'eye',
    '-d', 'eye_vision',
    '-c', sql,
  ]);
  return stdout;
}

async function main() {
  try {
    console.log('🔍 Conectando ao Docker via psql...\n');

    // 1. Buscar todos os offices
    console.log('📋 Buscando offices no PostgreSQL...');
    const officesJson = await execPsql(
      'SELECT json_agg(row_to_json(t)) FROM (SELECT * FROM offices WHERE office_token != \'1\' ORDER BY office_token) t'
    );

    let offices = [];
    try {
      const match = officesJson.match(/\[\{[\s\S]*\}\]/);
      if (match) {
        offices = JSON.parse(match[0]);
      }
    } catch (e) {
      console.log('Resposta:', officesJson.substring(0, 200));
    }

    if (offices.length === 0) {
      console.log('❌ Nenhuma empresa encontrada no Docker');
      process.exit(0);
    }

    console.log(`✓ Encontradas ${offices.length} empresa(s)\n`);

    // 2. Para cada office, carregar managers
    const restored = [];

    for (const office of offices) {
      const token = office.office_token;
      console.log(`📂 Restaurando: ${token}`);

      // Buscar managers
      const managersJson = await execPsql(
        `SELECT json_agg(json_build_object(
          'office_token', office_token,
          'company_slug', company_slug,
          'company_name', company_name,
          'data', json_object_agg(suffix, data),
          'updated_at', MAX(updated_at)::text
        )) FROM company_manager_data WHERE office_token = '${token}' GROUP BY office_token, company_slug, company_name`
      );

      let managers = [];
      try {
        const match = managersJson.match(/\[\{[\s\S]*\}(?:\s*,\s*\{[\s\S]*\})*\]/);
        if (match) {
          managers = JSON.parse(match[0]);
        }
      } catch (e) {
        // Tentar formato alternativo
      }

      // 3. Salvar em JSON
      const officeData = {
        office_token: token,
        office: {
          name: office.name || '',
          companies_registry: office.companies_registry || [],
          selected_company: office.selected_company || '',
          pricing_companies_registry: office.pricing_companies_registry || [],
          pricing_selected_company: office.pricing_selected_company || '',
          simulador_contracts: office.simulador_contracts || [],
          simulador_parcelamentos: office.simulador_parcelamentos || [],
          simulador_aplicacoes: office.simulador_aplicacoes || [],
          simulador_precificacao: office.simulador_precificacao || [],
          extra_storage: office.extra_storage || {},
          updated_at: office.updated_at ? office.updated_at : new Date().toISOString(),
          updated_by: office.updated_by || '',
        },
        managers: managers.length > 0 ? managers : [],
        restoredAt: new Date().toISOString(),
      };

      await fs.mkdir(RESTORED_PATH, { recursive: true });
      const filePath = path.join(RESTORED_PATH, `${token}.json`);
      await fs.writeFile(filePath, JSON.stringify(officeData, null, 2), 'utf8');

      console.log(`   ✓ Salvo: ${filePath}`);
      console.log(`   • ${managers.length} empresa(s) associada(s)`);
      console.log(`   • ${Object.keys(officeData.office.companies_registry).length} empresa(s) registrada(s)`);
      console.log();

      restored.push({
        token,
        name: office.name || token,
        companiesCount: managers.length,
        registryCount: officeData.office.companies_registry.length,
        filePath,
      });
    }

    // 4. Salvar relatório
    const reportPath = path.join(REPO_ROOT, '.data', 'restore-report.json');
    const report = {
      restoredAt: new Date().toISOString(),
      totalOffices: restored.length,
      offices: restored,
      path: RESTORED_PATH,
    };
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

    // 5. Resumo
    console.log('\n' + '='.repeat(60));
    console.log('✅ RESTAURAÇÃO CONCLUÍDA');
    console.log('='.repeat(60));
    console.log(`\n📊 Resumo:`);
    console.log(`   • Escritórios restaurados: ${restored.length}`);
    console.log(`   • Caminho: ${RESTORED_PATH}`);
    console.log(`   • Relatório: ${reportPath}`);
    console.log(`\n📁 Arquivos criados:`);
    restored.forEach((r) => {
      console.log(
        `   • ${r.token}.json (${r.registryCount} empresa${r.registryCount !== 1 ? 's' : ''} registrada${r.registryCount !== 1 ? 's' : ''})`
      );
    });
    console.log();

  } catch (err) {
    console.error('\n❌ ERRO ao restaurar:');
    console.error(err instanceof Error ? err.message : String(err));
    console.error(err instanceof Error ? err.stack : '');
    process.exit(1);
  }
}

main();
