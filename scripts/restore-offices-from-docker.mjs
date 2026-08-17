/**
 * Script para restaurar todas as empresas salvas no Docker
 * Cria arquivos JSON em .data/restored-offices/
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = process.env.CONTABIL_DESKTOP_ROOT
  ? path.resolve(process.env.CONTABIL_DESKTOP_ROOT)
  : path.resolve(SCRIPT_DIR, '..');

const RESTORED_PATH = path.join(REPO_ROOT, '.data', 'restored-offices');

// Conectar direto ao PostgreSQL
const pool = new Pool({
  host:     process.env.POSTGRES_HOST     || 'localhost',
  port:     Number(process.env.POSTGRES_PORT || 5432),
  user:     process.env.POSTGRES_USER     || 'eye',
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB       || 'eye_vision',
  connectionTimeoutMillis: 8_000,
});

async function pgQuery(text, params = []) {
  return pool.query(text, params);
}

async function main() {
  try {
    console.log('🔍 Conectando ao Docker...\n');

    // 1. Carregar todos os offices
    console.log('📋 Buscando offices no PostgreSQL...');
    const officesResult = await pgQuery('SELECT * FROM offices ORDER BY office_token');
    const offices = officesResult.rows || [];

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

      // Carregar managers desta empresa
      const managersResult = await pgQuery(
        `SELECT office_token, company_slug, company_name, suffix, data, updated_at
         FROM company_manager_data
         WHERE office_token = $1
         ORDER BY company_slug, suffix`,
        [token]
      );

      // Agrupar managers por company_slug
      const managersBySlug = new Map();
      for (const row of managersResult.rows || []) {
        const slug = row.company_slug;
        let manager = managersBySlug.get(slug);

        if (!manager) {
          manager = {
            office_token: token,
            company_slug: slug,
            company_name: row.company_name || '',
            data: {},
            updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
          };
          managersBySlug.set(slug, manager);
        }

        manager.data[row.suffix || ''] = row.data || [];
        const ts = row.updated_at ? new Date(row.updated_at).toISOString() : manager.updated_at;
        if (ts > manager.updated_at) manager.updated_at = ts;
      }

      const managers = Array.from(managersBySlug.values());

      // 3. Salvar office + managers em JSON
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
          updated_at: office.updated_at ? new Date(office.updated_at).toISOString() : new Date().toISOString(),
          updated_by: office.updated_by || '',
        },
        managers,
        restoredAt: new Date().toISOString(),
      };

      await fs.mkdir(RESTORED_PATH, { recursive: true });
      const filePath = path.join(RESTORED_PATH, `${token}.json`);
      await fs.writeFile(filePath, JSON.stringify(officeData, null, 2), 'utf8');

      console.log(`   ✓ Salvo: ${filePath}`);
      console.log(`   • ${managers.length} empresa(s) associada(s)`);
      console.log();

      restored.push({
        token,
        name: office.name,
        companiesCount: managers.length,
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
    console.log(`   • Empresas restauradas: ${restored.length}`);
    console.log(`   • Caminho: ${RESTORED_PATH}`);
    console.log(`   • Relatório: ${reportPath}`);
    console.log(`\n📁 Arquivos criados:`);
    restored.forEach((r) => {
      console.log(`   • ${r.token}.json (${r.companiesCount} empresa${r.companiesCount !== 1 ? 's' : ''})`);
    });
    console.log();

  } catch (err) {
    console.error('\n❌ ERRO ao restaurar:');
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
