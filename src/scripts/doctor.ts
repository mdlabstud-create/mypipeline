import 'dotenv/config';

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import net from 'node:net';

const execFileAsync = promisify(execFile);

async function checkDocker(): Promise<string | null> {
  try {
    await execFileAsync('docker', ['info'], { timeout: 10_000 });
    return null;
  } catch {
    return 'Docker engine not reachable. Start Docker Desktop (or ensure dockerd is running) and retry.';
  }
}

function checkEnvFile(): string | null {
  if (!existsSync('.env')) {
    return 'Missing .env file. Copy .env.example → .env (or use the provided local .env defaults).';
  }
  return null;
}

function normalizeProxyServer(raw: string): string {
  const trimmed = raw.trim();
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

function parseProxyHostPort(server: string): { host: string; port: number } | null {
  try {
    const u = new URL(server.includes('://') ? server : `http://${server}`);
    const host = u.hostname;
    const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
    if (!host || !Number.isFinite(port) || port <= 0) return null;
    return { host, port };
  } catch {
    return null;
  }
}

/**
 * Sanity-check Webshare HTTP CONNECT credentials against a tiny external TLS host.
 *
 * This intentionally avoids scraping marketplaces; it's only a connectivity/auth probe.
 */
async function checkWebshareProxy(): Promise<string | null> {
  const rawServer =
    process.env.WEBSHARE_PROXY_SERVER ||
    process.env.WEBSHARE_PROXY_HOST ||
    process.env.WEBSHARE_PROXY_URL ||
    '';
  const username = process.env.WEBSHARE_PROXY_USERNAME || process.env.WEBSHARE_USERNAME || '';
  const password = process.env.WEBSHARE_PROXY_PASSWORD || process.env.WEBSHARE_PASSWORD || '';

  if (!rawServer.trim() || !username.trim() || !password.trim()) {
    return null;
  }

  const parsed = parseProxyHostPort(normalizeProxyServer(rawServer));
  if (!parsed) {
    return `WEBSHARE_PROXY_SERVER looks invalid (${rawServer}). Expected host:port (or a URL with scheme).`;
  }

  const auth = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

  const statusLine = await new Promise<string>((resolve, reject) => {
    const socket = net.createConnection({ host: parsed.host, port: parsed.port });
    const timeout = setTimeout(() => {
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      reject(new Error('timeout'));
    }, 8_000);

    socket.once('connect', () => {
      socket.write(
        [
          'CONNECT ipinfo.io:443 HTTP/1.1',
          'Host: ipinfo.io:443',
          `Proxy-Authorization: ${auth}`,
          '',
          ''
        ].join('\r\n')
      );
    });

    let buf = '';
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      const idx = buf.indexOf('\r\n\r\n');
      if (idx !== -1) {
        clearTimeout(timeout);
        const head = buf.slice(0, idx);
        try {
          socket.destroy();
        } catch {
          // ignore
        }
        resolve(head.split('\r\n')[0] ?? head);
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  }).catch((err: unknown) => {
    return `ERR (${String(err)})`;
  });

  if (typeof statusLine !== 'string') {
    return `Webshare proxy check failed (${String(statusLine)}).`;
  }

  if (statusLine.includes('200')) {
    return null;
  }

  if (statusLine.includes('407')) {
    return (
      'Webshare proxy authentication failed (HTTP 407). Common fixes: ensure you are using the Rotating Endpoint host ' +
      '`p.webshare.io` with the Proxy Username/Password from the dashboard, ensure your proxy list is not empty, and ' +
      'verify WEBSHARE_PROXY_USERNAME/WEBSHARE_PROXY_PASSWORD.'
    );
  }

  return `Webshare proxy CONNECT failed (${statusLine}).`;
}

async function main(): Promise<void> {
  const issues: string[] = [];

  const dockerIssue = await checkDocker();
  if (dockerIssue) issues.push(dockerIssue);

  const envIssue = checkEnvFile();
  if (envIssue) issues.push(envIssue);

  const webshareIssue = await checkWebshareProxy();
  if (webshareIssue) issues.push(webshareIssue);

  if (issues.length === 0) {
    console.warn('OK: environment looks good.');
    return;
  }

  console.error('Preflight failed:\n- ' + issues.join('\n- '));
  process.exit(1);
}

void main();

