// Local development server: serves the static app and runs the /api functions the way Vercel does.
// Usage: GEMINI_API_KEY=... npm run dev     (or `npm run dev:mock` to use canned AI answers)
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.PORT || 3000);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5).replace(/[^a-z0-9-]/gi, '');
      const mod = await import(pathToFileURL(join(root, 'api', `${name}.js`)).href);
      return await mod.default(req, res);
    }
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (path === '/' || path === '\\') path = '/index.html';
    const file = join(root, path);
    if (!file.startsWith(root) || file.includes(`${root}/api`) || file.includes('/.git')) { res.statusCode = 404; return res.end('Not found'); }
    await stat(file);
    res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch (err) {
    if (!res.headersSent) { res.statusCode = err.code === 'ENOENT' || err.code === 'ERR_MODULE_NOT_FOUND' ? 404 : 500; res.end(res.statusCode === 404 ? 'Not found' : 'Server error'); }
    if (res.statusCode === 500) console.error(err);
  }
});

server.listen(port, () => console.log(`Plumbline running at http://localhost:${port}${process.env.MOCK_AI === '1' ? ' (mock AI)' : process.env.GEMINI_API_KEY ? ' (Gemini)' : ' (rule-based only: set GEMINI_API_KEY)'}`));
