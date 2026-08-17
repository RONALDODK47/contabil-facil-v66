#!/usr/bin/env powershell
# Script: dev-vpn-simples.ps1
# Inicia: Firewall + Hamachi + npm run dev

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "INICIALIZANDO: Firewall + Hamachi + npm run dev" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host ""

# Verificar se está rodando como ADMIN
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")

if (!$isAdmin) {
    Write-Host "[AVISO] Este script DEVERIA rodar como ADMIN para configurar firewall" -ForegroundColor Yellow
    Write-Host "[INFO] Para melhor resultado, clique com botao direito no PowerShell" -ForegroundColor Yellow
    Write-Host "[INFO] E selecione: 'Executar como administrador'" -ForegroundColor Yellow
    Write-Host ""
}

# PASSO 1: Verificar Firewall
Write-Host "[PASSO 1] Verificando Firewall..." -ForegroundColor Cyan

if ($isAdmin) {
    Write-Host "  [OK] Rodando como ADMIN" -ForegroundColor Green
    
    # Regra para porta 5173
    $ruleExists5173 = Get-NetFirewallRule -DisplayName "ContabilFacil App (5173)" -ErrorAction SilentlyContinue
    if (!$ruleExists5173) {
        Write-Host "  [INFO] Criando regra de firewall para porta 5173..." -ForegroundColor Yellow
        New-NetFirewallRule -DisplayName "ContabilFacil App (5173)" `
            -Direction Inbound `
            -Action Allow `
            -Protocol TCP `
            -LocalPort 5173 `
            -ErrorAction SilentlyContinue | Out-Null
    }
    
    # Regra para porta 3000 (Vite dev)
    $ruleExists3000 = Get-NetFirewallRule -DisplayName "ContabilFacil App (3000)" -ErrorAction SilentlyContinue
    if (!$ruleExists3000) {
        Write-Host "  [INFO] Criando regra de firewall para porta 3000..." -ForegroundColor Yellow
        New-NetFirewallRule -DisplayName "ContabilFacil App (3000)" `
            -Direction Inbound `
            -Action Allow `
            -Protocol TCP `
            -LocalPort 3000 `
            -ErrorAction SilentlyContinue | Out-Null
    }
    
    Write-Host "  [OK] Firewall configurado!" -ForegroundColor Green
} else {
    Write-Host "  [AVISO] NAO esta rodando como ADMIN" -ForegroundColor Yellow
    Write-Host "  [INFO] Pulando configuracao de firewall"
}

# PASSO 2: Hamachi já deve estar rodando
Write-Host ""
Write-Host "[PASSO 2] Verificando Hamachi..." -ForegroundColor Cyan

$myHamachiIP = "25.xxx.xxx.xxx"

# Primeiro, tenta ler do arquivo de config (IP já salvo)
$configFile = "$PSScriptRoot\.hamachi-ip.txt"
if (Test-Path $configFile) {
    $savedIP = Get-Content $configFile -Raw -ErrorAction SilentlyContinue
    if ($savedIP -match "^25\.\d+\.\d+\.\d+") {
        $myHamachiIP = $savedIP.Trim()
        Write-Host "  [OK] IP Hamachi carregado do cache: $myHamachiIP" -ForegroundColor Green
        Write-Host "  [OK] Hamachi já está rodando!" -ForegroundColor Green
    }
} else {
    Write-Host "  [INFO] Sem cache de IP - verifique se Hamachi está rodando" -ForegroundColor Yellow
}

# PASSO 3: Obter IP Hamachi (automático)
Write-Host ""
Write-Host "[PASSO 3] Detectando IP Hamachi..." -ForegroundColor Cyan

$configFile = "$PSScriptRoot\.hamachi-ip.txt"
$myHamachiIP = "25.xxx.xxx.xxx"

# Tenta ler do arquivo de config
if (Test-Path $configFile) {
    $savedIP = Get-Content $configFile -Raw -ErrorAction SilentlyContinue
    if ($savedIP -match "^25\.\d+\.\d+\.\d+") {
        $myHamachiIP = $savedIP.Trim()
        Write-Host "  [OK] IP detectado: $myHamachiIP" -ForegroundColor Green
    }
}

# Se não conseguiu do arquivo, tenta extrair do Hamachi
if ($myHamachiIP -match "xxx" -and $hamachiFound) {
    try {
        $listOutput = & $hamachiPath list 2>&1
        if ($listOutput) {
            foreach ($line in $listOutput) {
                if ($line -match "(25\.\d+\.\d+\.\d+)") {
                    $myHamachiIP = $matches[1]
                    Write-Host "  [OK] IP detectado do Hamachi: $myHamachiIP" -ForegroundColor Green
                    # Salva para próxima vez
                    $myHamachiIP | Out-File -FilePath $configFile -Force -Encoding UTF8
                    break
                }
            }
        }
    } catch {}
}

# Se ainda assim não conseguiu, usa o padrão
if ($myHamachiIP -match "xxx") {
    Write-Host "  [AVISO] IP nao detectado, usando padrao" -ForegroundColor Yellow
}

# PASSO 4: Executar npm run dev
Write-Host ""
Write-Host "[PASSO 4] Iniciando aplicacao..." -ForegroundColor Cyan
Write-Host ""

Write-Host "================================================" -ForegroundColor Green
Write-Host "TUDO PRONTO! Rodando: npm run dev" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host ""

Write-Host "PROXIMOS PASSOS:" -ForegroundColor Cyan
Write-Host "  1. Abra seu navegador"
Write-Host "  2. Acesse: http://localhost:3000"
Write-Host "  3. Seu app esta rodando!"
Write-Host ""

Write-Host "COMPARTILHAR COM COLEGA:" -ForegroundColor Green
Write-Host "  Seu IP Hamachi: $myHamachiIP" -ForegroundColor Yellow
Write-Host "  Link para compartilhar: http://$myHamachiIP`:3000" -ForegroundColor Yellow
Write-Host "  Colega entra na rede: ContabilFacilSeguro / Ino#5564"
Write-Host ""

Write-Host "PARA PARAR:" -ForegroundColor Cyan
Write-Host "  Pressione: Ctrl + C"
Write-Host ""

# Executa npm run dev
npm run dev
