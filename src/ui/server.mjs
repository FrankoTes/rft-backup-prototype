import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const port = process.env.PORT ?? 5173;
createServer(async (req, res) => { const file = req.url === '/' ? 'index.html' : req.url.slice(1); try { const body = await readFile(path.join('src/ui', file)); res.end(body); } catch { res.statusCode = 404; res.end('Not found'); } }).listen(port, () => console.log(`RFT Backup UI: http://localhost:${port}`));
