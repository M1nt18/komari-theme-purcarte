import type { Plugin } from 'vite';
import type { ServerResponse } from 'node:http';
import { normalizeSettings } from '../src/config/settings-model';
import type { ConfigOptions } from '../src/config/default';

/** Loopback-only development harness. No remote mutation is forwarded. */
export function reviewPreview(target: string): Plugin {
  let saved: Partial<ConfigOptions> | null = null;
  const send = (response: ServerResponse, status: number, value: unknown) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(value));
  };
  return {
    name: 'local-review-only', apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url || '/', 'http://localhost').pathname;
        if (pathname === '/__review__/settings') { send(response, 200, saved); return; }
        if (!pathname.startsWith('/api/')) { next(); return; }
        try {
          if (pathname === '/api/me' && request.method === 'GET') {
            send(response, 200, { logged_in: true, username: 'Local review', uuid: 'local-review' }); return;
          }
          if (pathname === '/api/public' && request.method === 'GET') {
            const upstream = await fetch(new URL('/api/public', target), { signal: AbortSignal.timeout(10000) });
            if (!upstream.ok) throw new Error('Public API unavailable');
            const body = await upstream.json() as { status: string; data: Record<string, unknown> };
            if (body.status !== 'success' || !body.data) throw new Error('Invalid public API response');
            saved ??= { ...normalizeSettings(body.data?.theme_settings), enableJsonRPC2Api: false };
            send(response, 200, { ...body, data: { ...body.data, theme_settings: saved } }); return;
          }
          if (pathname === '/api/admin/theme/settings' && request.method === 'POST') {
            let body = '';
            for await (const chunk of request) {
              body += chunk.toString();
              if (body.length > 1024 * 1024) { send(response, 413, { status: 'error', message: 'File too large' }); return; }
            }
            saved = { ...normalizeSettings(JSON.parse(body), true), enableJsonRPC2Api: false };
            send(response, 200, { status: 'success', data: null }); return;
          }
          if (request.method !== 'GET' && request.method !== 'HEAD') {
            send(response, 405, { status: 'error', message: '本机审查预览禁止远程写入和检测' }); return;
          }
          // Only public data is needed for review, never forward browser credentials.
          delete request.headers.cookie; delete request.headers.authorization;
          next();
        } catch (error) {
          send(response, 400, { status: 'error', message: error instanceof Error ? error.message : 'Review request failed' });
        }
      });
    },
  };
}
