# Contabil Fácil

Sistema de contabilidade distribuído como aplicativo Windows: um instalador
`.exe` que sobe a stack (Postgres + MinIO + app) em Docker na máquina do
usuário, com aviso de atualização dentro do próprio programa.

**Versão atual: 23.0.0**

## Para quem vai usar

Baixe o instalador em [Releases](https://github.com/RONALDODK47/contabil-facil/releases)
e siga o [guia de instalação](./INSTALACAO_USUARIOS.md). É preciso ter o
[Docker Desktop](https://www.docker.com/products/docker-desktop/) instalado.

## Para quem desenvolve

### Rodando local

```bash
npm install
```

```bash
npm run dev
```

Sobe o Express + Vite em `http://localhost:3000`. O servidor de OCR sobe junto
em `http://127.0.0.1:8765`.

Configure a `GEMINI_API_KEY` no `.env` (veja o `.env.example`).

Para OCR em PDFs escaneados, instale o Tesseract:

- **Windows** — https://github.com/UB-Mannheim/tesseract/wiki
- **macOS** — `brew install tesseract`
- **Linux** — `sudo apt-get install tesseract-ocr`

### Rodando via Docker

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

Portas ficam expostas só em `127.0.0.1`. O app roda em `:3000`, o console do
MinIO em `:9001`.

### Gerando o instalador e lançando versões

```bash
npm run instalador
```

Detalhes do fluxo de release em [INSTALADOR.md](./INSTALADOR.md).

## Como a distribuição funciona

| Arquivo | Papel |
| --- | --- |
| `installer/src/Launcher.cs` | Launcher em C# — vira o `ContabilFacil.exe` |
| `installer/contabil-facil.iss` | Script do instalador (Inno Setup) |
| `releases.json` | **Decide qual versão os usuários enxergam** |
| `version.json` | Versão embarcada na cópia instalada |
| `scripts/version.mjs` | `npm run versao` — sobe a versão em todos os arquivos |
| `scripts/build-installer.mjs` | `npm run instalador` — compila launcher + instalador |

Publicar no GitHub Releases não libera nada sozinho: a versão só chega aos
usuários quando o `latest_stable` do `releases.json` apontar para ela.

## Funcionalidades

- OCR integrado, sobe junto com a app
- Extração de extratos bancários
- PDFs com texto nativo e escaneados (via Tesseract)
- API REST de extração
- Persistência em Postgres + MinIO
