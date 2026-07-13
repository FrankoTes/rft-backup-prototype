import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { activity, dashboard, deleteConfiguration, executeBackup, getPublicState, listConfigurations, saveConfiguration, testConfigurationConnection, versions } from '../service/service.mjs';

const port = process.env.PORT ?? 5173;
const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const body = async (req) => JSON.parse(await new Promise((resolve) => { let data = ''; req.on('data', (c) => data += c); req.on('end', () => resolve(data || '{}')); }));

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
      const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const ext = path.extname(file) === '.css' ? 'text/css' : path.extname(file) === '.js' ? 'text/javascript' : 'text/html';
      res.writeHead(200, { 'content-type': ext }); res.end(await readFile(path.join('src/ui', file)));
    } catch (error) { send(res, 500, { error: error.message }); }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) createRftUiServer().listen(port, () => console.log(`RFT Backup UI: http://localhost:${port}`));
