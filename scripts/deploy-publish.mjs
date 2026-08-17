/**
 * Publica alterações no GitHub (commit + pull --rebase + push).
 */
import { spawnSync } from 'node:child_process';
import { root } from './deploy-utils.mjs';

const DEFAULT_REMOTE = 'https://github.com/RONALDODK47/eye-vision-v1.0.7.git';

function git(...args) {
  const result = spawnSync('git', args, {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    windowsHide: false,
  });
  return result.status ?? 1;
}

function gitOutput(...args) {
  const result = spawnSync('git', args, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'ignore'],
    shell: false,
    windowsHide: false,
  });
  return result.stdout ? result.stdout.toString().trim() : '';
}

function hasStagedChanges() {
  const result = spawnSync('git', ['diff', '--cached', '--quiet'], {
    cwd: root,
    shell: false,
    windowsHide: false,
  });
  return (result.status ?? 1) !== 0;
}

function hasUnstagedChanges() {
  const result = spawnSync('git', ['diff', '--quiet'], {
    cwd: root,
    shell: false,
    windowsHide: false,
  });
  return (result.status ?? 1) !== 0;
}

/**
 * @param {{ message?: string, remote?: string, branch?: string, force?: boolean }} options
 */
export function publishToGit(options = {}) {
  const remote = options.remote || process.env.DEPLOY_GIT_REMOTE || DEFAULT_REMOTE;
  const branch = options.branch || gitOutput('rev-parse', '--abbrev-ref', 'HEAD') || 'main';
  const message =
    options.message ||
    process.env.DEPLOY_GIT_MESSAGE ||
    `Deploy: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;

  console.info('\n[deploy] Publicando no GitHub…');

  if (git('rev-parse', '--is-inside-work-tree') !== 0) {
    if (git('init') !== 0) process.exit(1);
  }

  if (git('remote', 'get-url', 'origin') !== 0) {
    if (git('remote', 'add', 'origin', remote) !== 0) process.exit(1);
  }

  git('add', '-A');

  if (hasStagedChanges()) {
    if (git('commit', '-m', message) !== 0) process.exit(1);
  } else if (!hasUnstagedChanges()) {
    console.info('[deploy] Nenhuma alteração para commitar.');
  } else {
    console.error('[deploy] Há alterações não adicionadas ao stage.');
    process.exit(1);
  }

  git('branch', '-M', branch);

  if (git('ls-remote', '--heads', 'origin', branch) === 0 && !options.force && process.env.DEPLOY_GIT_FORCE !== '1') {
    console.info(`[deploy] Sincronizando com origin/${branch}…`);
    const pull = git('pull', 'origin', branch, '--rebase', '--autostash');
    if (pull !== 0) {
      console.error('[deploy] Conflito no pull.');
      console.error('  Rode: set DEPLOY_GIT_FORCE=1 && npm run deploy');
      process.exit(1);
    }
  }

  const pushArgs = ['push', '-u', 'origin', branch];
  if (options.force || process.env.DEPLOY_GIT_FORCE === '1') {
    pushArgs.splice(1, 0, '--force-with-lease');
  }

  if (git(...pushArgs) !== 0) {
    console.error('[deploy] Push falhou. Verifique permissões no GitHub.');
    process.exit(1);
  }

  const remoteUrl = gitOutput('remote', 'get-url', 'origin') || remote;
  console.info(`[deploy] Push concluído → ${remoteUrl} (${branch})`);
  return { branch, remote: remoteUrl };
}
