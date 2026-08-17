#!/usr/bin/env node
/**
 * Script: dev-vpn-auto.mjs
 * 
 * Inicializa tudo automaticamente:
 * 1. Configura Firewall
 * 2. Liga Hamachi VPN
 * 3. Executa: npm run dev
 * 
 * Uso: npm run dev:vpn
 */

import { spawn, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { platform } from 'os';

const isWindows = platform() === 'win32';

console.log('\n');
console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║     🚀 Inicializando: Firewall + Hamachi + npm run dev     ║');
console.log('╚════════════════════════════════════════════════════════════╝');
console.log('\n');

// ============================================================
// PASSO 1: Configurar Firewall (se possível)
// ============================================================
async function configureFirewall() {
  console.log('[\x1b[36mPASSO 1\x1b[0m] Verificando Firewall...');
  
  if (!isWindows) {
    console.log('  ⚠️  Sistema não é Windows, pulando firewall');
    return;
  }

  try {
    // Verifica se já tem permissão admin
    const psCommand = `
      $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator");
      if ($isAdmin) {
        $ruleExists = Get-NetFirewallRule -DisplayName "ContabilFacil App (5173)" -ErrorAction SilentlyContinue;
        if (!$ruleExists) {
          New-NetFirewallRule -DisplayName "ContabilFacil App (5173)" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5173 -ErrorAction SilentlyContinue | Out-Null;
          Write-Host "✅ Firewall configurado!";
        } else {
          Write-Host "✅ Firewall já estava configurado";
        }
      } else {
        Write-Host "⚠️  Sem permissão admin para configurar firewall";
      }
    `;

    spawnSync('powershell', ['-NoProfile', '-Command', psCommand], {
      stdio: 'inherit'
    });
  } catch (err) {
    console.log('  ⚠️  Não foi possível configurar firewall (tudo bem, continuando...)');
  }
}

// ============================================================
// PASSO 2: Iniciar Hamachi VPN e Criar Rede
// ============================================================
async function startHamachi() {
  console.log('\n[\x1b[36mPASSO 2\x1b[0m] Verificando Hamachi...');

  if (!isWindows) {
    console.log('  ⚠️  Sistema não é Windows, pulando Hamachi');
    return;
  }

  // Tenta vários caminhos possíveis do Hamachi
  const possiblePaths = [
    'C:\\Program Files\\LogMeIn Hamachi\\hamachi.exe',
    'C:\\Program Files (x86)\\LogMeIn Hamachi\\hamachi.exe',
    'C:\\Program Files\\hamachi\\hamachi.exe',
    process.env.PROGRAMFILES + '\\LogMeIn Hamachi\\hamachi.exe',
    process.env['PROGRAMFILES(X86)'] + '\\LogMeIn Hamachi\\hamachi.exe'
  ];

  let hamachiPath = null;
  for (const path of possiblePaths) {
    if (existsSync(path)) {
      hamachiPath = path;
      break;
    }
  }

  if (!hamachiPath) {
    // Tenta usar 'hamachi' diretamente do PATH
    try {
      const result = spawnSync('where', ['hamachi.exe'], {
        encoding: 'utf-8'
      });
      if (result.stdout && result.stdout.trim()) {
        hamachiPath = result.stdout.trim().split('\n')[0];
      }
    } catch (e) {
      // Ignorar
    }
  }

  if (!hamachiPath) {
    console.log('  ❌ Hamachi NÃO encontrado');
    console.log('  📥 Baixe em: \x1b[34mhttps://www.logmeininc.com/hamachi\x1b[0m');
    console.log('  💡 Continuando sem VPN...\n');
    return;
  }

  console.log(`  ✅ Hamachi encontrado: ${hamachiPath}`);

  try {
    console.log('  ℹ️  Iniciando Hamachi...');
    
    // Tenta iniciar Hamachi
    spawnSync(hamachiPath, ['start'], {
      stdio: 'ignore'
    });

    // Aguarda um pouco
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verifica status
    const statusResult = spawnSync(hamachiPath, ['status'], {
      encoding: 'utf-8'
    });

    if (statusResult.stdout && (statusResult.stdout.includes('logon ok') || statusResult.stdout.includes('online'))) {
      console.log('  ✅ Hamachi iniciado com sucesso!');
    } else {
      console.log('  ℹ️  Hamachi iniciado (verifique se está conectado na rede)');
    }

    // CRIAR REDE (se não existir)
    console.log('  ℹ️  Verificando rede VPN...');
    await createHamachiNetwork(hamachiPath);

  } catch (err) {
    console.log('  ⚠️  Erro ao iniciar Hamachi (continuando mesmo assim)');
  }
}

// ============================================================
// FUNÇÃO: Criar Rede Hamachi
// ============================================================
async function createHamachiNetwork(hamachiPath) {
  const networkName = 'ContabilFacilSeguro';
  const networkPassword = 'Ino#5564';

  try {
    console.log('  ℹ️  Tentando criar rede VPN...');

    // Tenta criar a rede (pode falhar se já existe, isso é OK)
    try {
      const createResult = spawnSync(hamachiPath, ['create', networkName, networkPassword], {
        encoding: 'utf-8',
        timeout: 10000
      });

      if (!createResult.error) {
        console.log(`  ✅ Rede criada: ${networkName}`);
      }
    } catch (createErr) {
      // Ignora erro se rede já existe
      console.log('  ℹ️  Rede pode já existir (tudo bem!)');
    }

    // Aguarda um pouco
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Lista redes para confirmar
    try {
      const listResult = spawnSync(hamachiPath, ['list'], {
        encoding: 'utf-8',
        timeout: 10000
      });

      if (listResult.stdout && listResult.stdout.includes(networkName)) {
        console.log(`  ✅ Rede "${networkName}" ativa e pronta!`);
        console.log(`  ℹ️  Senha: Ino#5564`);
      } else if (!listResult.error) {
        console.log(`  ℹ️  Rede "${networkName}" está sendo preparada...`);
      }
    } catch (listErr) {
      console.log('  ℹ️  Rede VPN está sendo inicializada...');
    }
  } catch (err) {
    console.log('  ℹ️  Continuando sem criar rede automaticamente...');
    console.log('  💡 Você pode criar manualmente no Hamachi');
  }
}

// ============================================================
// PASSO 3: Executar npm run dev
// ============================================================
async function startDevServer() {
  console.log('\n[\x1b[36mPASSO 3\x1b[0m] Iniciando aplicação...\n');
  
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  🎉 TUDO PRONTO! Rodando: npm run dev                    ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  console.log('📱 PRÓXIMOS PASSOS:');
  console.log('  1. Abra seu navegador');
  console.log('  2. Acesse: \x1b[34mhttp://localhost:5173\x1b[0m');
  console.log('  3. Seu app está rodando!\n');

  console.log('🔗 COMPARTILHAR COM COLEGA:');
  console.log('  1. Veja seu IP Hamachi (25.xxx.xxx.xxx)');
  console.log('  2. Compartilhe: \x1b[34mhttp://25.xxx.xxx.xxx:5173\x1b[0m');
  console.log('  3. Colega entra mesma rede Hamachi\n');

  console.log('🛑 PARA PARAR:');
  console.log('  Pressione: \x1b[33mCtrl + C\x1b[0m\n');

  // Executa npm run dev
  const npmProcess = isWindows 
    ? spawn('npm.cmd', ['run', 'dev'])
    : spawn('npm', ['run', 'dev']);

  npmProcess.stdout.on('data', (data) => {
    process.stdout.write(data);
  });

  npmProcess.stderr.on('data', (data) => {
    process.stderr.write(data);
  });

  npmProcess.on('close', (code) => {
    console.log('\n\n╔════════════════════════════════════════════════════════════╗');
    console.log('║  ✅ Aplicação encerrada                                    ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    process.exit(code);
  });
}

// ============================================================
// EXECUTAR TUDO
// ============================================================
(async () => {
  try {
    await configureFirewall();
    await startHamachi();
    await startDevServer();
  } catch (err) {
    console.error('\n❌ Erro:', err.message);
    process.exit(1);
  }
})();
