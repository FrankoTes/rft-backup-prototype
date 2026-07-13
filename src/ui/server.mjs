import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { activity, dashboard, deleteConfiguration, executeBackup, getPublicState, listConfigurations, saveConfiguration, testConfigurationConnection, versions } from '../service/service.mjs';

export const UI_HOST = '127.0.0.1';
export const UI_ROOT = path.dirname(fileURLToPath(import.meta.url));
const port = process.env.PORT ?? 5173;
const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const body = async (req) => JSON.parse(await new Promise((resolve) => { let data = ''; req.on('data', (c) => data += c); req.on('end', () => resolve(data || '{}')); }));

function resolveUiFile(urlPathname) {
  let relativeRequest;
  try {
    relativeRequest = urlPathname === '/' ? 'index.html' : decodeURIComponent(urlPathname.slice(1));
  } catch {
    return null;
  }
  const resolved = path.resolve(UI_ROOT, relativeRequest);
  const insideRoot = resolved === UI_ROOT || resolved.startsWith(`${UI_ROOT}${path.sep}`);
  return insideRoot ? resolved : null;
}

export function createRftUiServer() {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        if (req.method === 'GET' && url.pathname === '/api/state') return send(res, 200, await getPublicState());
        if (req.method === 'GET' && url.pathname === '/api/dashboard') return send(res, 200, await dashboard());
        if (req.method === 'GET' && url.pathname === '/api/configurations') return send(res, 200, await listConfigurations());
        if (req.method === 'POST' && url.pathname === '/api/configurations') return send(res, 200, await saveConfiguration(await body(req)));
        if (req.method === 'PUT' && url.pathname.startsWith('/api/configurations/')) return send(res, 200, await saveConfiguration({ ...(await body(req)), id: url.pathname.split('/')[3] }));
        if (req.method === 'DELETE' && url.pathname.startsWith('/api/configurations/')) return send(res, 200, await deleteConfiguration(url.pathname.split('/')[3]));
        if (req.method === 'POST' && url.pathname === '/api/test-connection') return send(res, 200, await testConfigurationConnection(await body(req)));
        if (req.method === 'POST' && url.pathname.match(/^\/api\/configurations\/[^/]+\/backup$/)) return send(res, 200, await executeBackup(url.pathname.split('/')[3]));
        if (req.method === 'GET' && url.pathname === '/api/activity') return send(res, 200, await activity());
        if (req.method === 'GET' && url.pathname === '/api/versions') return send(res, 200, await versions());
        return send(res, 404, { error: 'Not found' });
      }
      const filePath = resolveUiFile(url.pathname);
      if (!filePath) { res.writeHead(403, { 'content-type': 'text/plain' }); return res.end('Forbidden'); }
      const ext = path.extname(filePath) === '.css' ? 'text/css' : path.extname(filePath) === '.js' ? 'text/javascript' : 'text/html';
      const fileBody = await readFile(filePath);
      res.writeHead(200, { 'content-type': ext }); res.end(fileBody);
    } catch (error) {
      if (error.code === 'ENOENT') { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
      send(res, 500, { error: error.message });
    }
  });
}

export function startRftUiServer({ listenPort = port } = {}) {
  const server = createRftUiServer();
  return server.listen(listenPort, UI_HOST, () => console.log(`RFT Backup UI: http://${UI_HOST}:${server.address().port}`));
}

if (import.meta.url === `file://${process.argv[1]}`) startRftUiServer();
