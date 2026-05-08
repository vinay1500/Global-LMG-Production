#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFilePath = resolve(rootDir, '.env.e2e.staging');
const startupTimeoutMs = Number(process.env.E2E_STARTUP_TIMEOUT_MS || 90_000);
const retryDelayMs = 1_000;

const requiredEnv = [
  'E2E_RUN_MUTATIONS',
  'E2E_ADMIN_EMAIL',
  'E2E_ADMIN_PASSWORD',
  'E2E_CLIENT_EMAIL',
  'E2E_CLIENT_PASSWORD',
  'E2E_ADMIN_WEB_BASE',
  'E2E_CLIENT_WEB_BASE',
  'E2E_ADMIN_API_BASE',
  'E2E_CLIENT_API_BASE',
];

const secretKeyPattern = /(PASSWORD|SECRET|TOKEN|PRIVATE|KEY|CREDENTIAL)/i;
const children = [];
const serviceChildren = [];
let shuttingDown = false;
let childFailure = null;

const parseEnvValue = (value) => {
  const trimmed = value.trim();

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const unquoted = trimmed.slice(1, -1);
    return trimmed.startsWith('"')
      ? unquoted
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\')
      : unquoted;
  }

  return trimmed;
};

const parseEnvFile = (path) => {
  if (!existsSync(path)) {
    throw new Error(`Missing ${path}. Create it from the staging E2E template before running.`);
  }

  const parsed = {};
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);

  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    if (line.startsWith('export ')) {
      line = line.slice('export '.length).trim();
    }

    const equalsIndex = line.indexOf('=');
    if (equalsIndex <= 0) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    const value = line.slice(equalsIndex + 1);

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }

    parsed[key] = parseEnvValue(value);
  }

  return parsed;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const asUrl = (value, key) => {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${key} must be a valid absolute URL.`);
  }
};

const urlPortOrDefault = (value, fallback) => {
  const url = asUrl(value, 'base URL');
  return url.port || fallback;
};

const joinUrl = (base, path) => `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;

const redactSecrets = (line, env) => {
  let redacted = line;
  for (const [key, value] of Object.entries(env)) {
    if (!secretKeyPattern.test(key) || !value || String(value).length < 4) {
      continue;
    }
    redacted = redacted.split(String(value)).join('[redacted]');
  }
  return redacted;
};

const pipeWithPrefix = (stream, label, env, write) => {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.length > 0) {
        write(`[${label}] ${redactSecrets(line, env)}\n`);
      }
    }
  });
  stream.on('end', () => {
    if (buffer.length > 0) {
      write(`[${label}] ${redactSecrets(buffer, env)}\n`);
    }
  });
};

const spawnManaged = (label, command, args, options) => {
  const child = spawn(command, args, {
    cwd: options.cwd,
    detached: process.platform !== 'win32',
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  children.push(child);
  if (options.service) {
    serviceChildren.push(child);
  }

  pipeWithPrefix(child.stdout, label, options.env, (line) => process.stdout.write(line));
  pipeWithPrefix(child.stderr, label, options.env, (line) => process.stderr.write(line));

  child.on('exit', (code, signal) => {
    if (!shuttingDown && options.service && code !== 0) {
      childFailure = new Error(
        `${label} exited early with code ${code ?? 'null'} signal ${signal ?? 'null'}.`,
      );
    }
  });

  return child;
};

const killChild = (child, signal) => {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  try {
    if (process.platform !== 'win32') {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Process is already gone.
    }
  }
};

const teardown = async () => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  for (const child of [...children].reverse()) {
    killChild(child, 'SIGTERM');
  }
  await sleep(3_000);
  for (const child of [...children].reverse()) {
    killChild(child, 'SIGKILL');
  }
};

const waitForHttp = async (label, url, timeoutMs) => {
  const startedAt = Date.now();
  let lastError = 'not attempted';

  process.stdout.write(`[e2e] Waiting for ${label}: ${url}\n`);

  while (Date.now() - startedAt < timeoutMs) {
    if (childFailure) {
      throw childFailure;
    }

    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.status >= 200 && response.status < 400) {
        process.stdout.write(`[e2e] ${label} is ready.\n`);
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'request failed';
    }

    await sleep(retryDelayMs);
  }

  throw new Error(`${label} did not become ready within ${timeoutMs}ms. Last result: ${lastError}`);
};

const waitForReadiness = async (env) => {
  await waitForHttp(
    'client API readiness',
    joinUrl(env.E2E_CLIENT_API_BASE, '/health/ready'),
    startupTimeoutMs,
  );
  await waitForHttp(
    'admin API readiness',
    joinUrl(env.E2E_ADMIN_API_BASE, '/health/ready'),
    startupTimeoutMs,
  );
  await waitForHttp('client frontend', env.E2E_CLIENT_WEB_BASE, startupTimeoutMs);
  await waitForHttp(
    'admin frontend login',
    joinUrl(env.E2E_ADMIN_WEB_BASE, '/login'),
    startupTimeoutMs,
  );
};

const isLocalHost = (hostname) =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname.endsWith('.local');

const isProductionLikeUrl = (value) => {
  const url = asUrl(value, 'target URL');
  const hostname = url.hostname.toLowerCase();

  if (isLocalHost(hostname)) {
    return false;
  }

  if (/(staging|stage|uat|qa|dev|test)/i.test(hostname)) {
    return false;
  }

  return (
    hostname === 'globallmg.org' ||
    hostname.endsWith('.globallmg.org') ||
    hostname.includes('production') ||
    hostname.includes('prod')
  );
};

const validateSafety = (env) => {
  const targetKeys = [
    'E2E_ADMIN_WEB_BASE',
    'E2E_CLIENT_WEB_BASE',
    'E2E_ADMIN_API_BASE',
    'E2E_CLIENT_API_BASE',
  ];
  const productionTargets = targetKeys.filter((key) => isProductionLikeUrl(env[key]));

  if (productionTargets.length > 0 && env.E2E_ALLOW_PRODUCTION_TARGET !== 'true') {
    throw new Error(
      `Refusing production-looking E2E targets without E2E_ALLOW_PRODUCTION_TARGET=true: ${productionTargets.join(', ')}`,
    );
  }

  if (productionTargets.length > 0) {
    process.stderr.write(
      `[e2e] Warning: production-looking E2E target variables allowed by explicit override: ${productionTargets.join(', ')}\n`,
    );
  }

  if (env.E2E_RUN_MUTATIONS === 'true' && productionTargets.length > 0) {
    process.stderr.write('[e2e] Warning: mutation mode is enabled against production-looking targets.\n');
  }
};

const validateRequiredEnv = (env) => {
  const missing = requiredEnv.filter((key) => !String(env[key] || '').trim());

  if (missing.length > 0) {
    throw new Error(`Missing required staging E2E env vars: ${missing.join(', ')}`);
  }

  if (!['true', 'false'].includes(env.E2E_RUN_MUTATIONS)) {
    throw new Error('E2E_RUN_MUTATIONS must be exactly true or false.');
  }
};

const runPlaywright = (env) =>
  new Promise((resolve) => {
    const child = spawnManaged('playwright', 'npm', ['run', 'test:e2e'], {
      cwd: rootDir,
      env,
      service: false,
    });

    child.on('exit', (code) => {
      resolve(code ?? 1);
    });
  });

const main = async () => {
  const fileEnv = parseEnvFile(envFilePath);
  const env = {
    ...process.env,
    ...fileEnv,
  };

  validateRequiredEnv(env);
  validateSafety(env);

  env.E2E_RUN_LIVE = 'true';

  const clientApiPort = urlPortOrDefault(env.E2E_CLIENT_API_BASE, '3001');
  const adminApiPort = urlPortOrDefault(env.E2E_ADMIN_API_BASE, '3005');
  const clientWebPort = urlPortOrDefault(env.E2E_CLIENT_WEB_BASE, '5173');
  const adminWebPort = urlPortOrDefault(env.E2E_ADMIN_WEB_BASE, '5174');

  const backendEnv = {
    ...env,
    PORT: clientApiPort,
    PUBLIC_WEB_ORIGIN: env.E2E_CLIENT_WEB_BASE,
  };
  const adminBackendEnv = {
    ...env,
    PORT: adminApiPort,
    PUBLIC_ADMIN_WEB_ORIGIN: env.E2E_ADMIN_WEB_BASE,
  };
  const frontendEnv = {
    ...env,
    VITE_API_BASE_URL: env.E2E_CLIENT_API_BASE,
  };
  const adminFrontendEnv = {
    ...env,
    VITE_API_BASE_URL: env.E2E_ADMIN_API_BASE,
  };

  spawnManaged('backend', 'npm', ['run', 'dev'], {
    cwd: resolve(rootDir, 'backend'),
    env: backendEnv,
    service: true,
  });
  spawnManaged('admin_backend', 'npm', ['run', 'dev'], {
    cwd: resolve(rootDir, 'admin_backend'),
    env: adminBackendEnv,
    service: true,
  });
  spawnManaged('frontend', 'npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', clientWebPort], {
    cwd: resolve(rootDir, 'frontend'),
    env: frontendEnv,
    service: true,
  });
  spawnManaged(
    'admin_frontend',
    'npm',
    ['run', 'dev', '--', '--host', '127.0.0.1', '--port', adminWebPort],
    {
      cwd: resolve(rootDir, 'admin_frontend'),
      env: adminFrontendEnv,
      service: true,
    },
  );

  await waitForReadiness(env);
  const playwrightExitCode = await runPlaywright(env);
  await teardown();
  process.exitCode = playwrightExitCode;
};

process.once('SIGINT', () => {
  void teardown().finally(() => process.exit(130));
});

process.once('SIGTERM', () => {
  void teardown().finally(() => process.exit(143));
});

void main().catch(async (error) => {
  process.stderr.write(`[e2e] ${error instanceof Error ? error.message : 'Staging E2E runner failed.'}\n`);
  await teardown();
  process.exitCode = 1;
});
