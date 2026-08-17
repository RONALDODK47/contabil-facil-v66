#!/usr/bin/env node
/**
 * Test — Verifica se restore-from-docker-direct retorna todas as empresas
 */

import './load-env.mjs';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: Number(process.env.POSTGRES_PORT || 5432),
  user: process.env.POSTGRES_USER || 'eye',
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB || 'eye_vision',
  connectionTimeoutMillis: 10_000,
  max: 5,
});

async function test() {
  try {
    console.log('🔍 Testando restore-from-docker-direct...\n');

    // Listar todos os offices
    const officesRes = await pool.query(
      `SELECT office_token, companies_registry FROM offices ORDER BY jsonb_array_length(companies_registry) DESC, updated_at DESC`
    );
    
    console.log(`✅ Total de offices: ${officesRes.rows.length}`);
    
    let totalCompanies = 0;
    officesRes.rows.forEach((row, idx) => {
      const companies = Array.isArray(row.companies_registry) ? row.companies_registry : [];
      totalCompanies += companies.length;
      console.log(`   [${idx + 1}] ${row.office_token}: ${companies.length} empresa(s)`);
    });
    
    console.log(`\n📊 Total de empresas: ${totalCompanies}`);
    
  } catch (err) {
    console.error('❌ Erro:', err instanceof Error ? err.message : err);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

test();
