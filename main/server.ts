import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { registerRoutes } from './routes';
import { setupKdsWebSocket } from './services/kds';

let server: http.Server | null = null;
let app: Express;
let wss: WebSocketServer | null = null;

const PORT = parseInt(process.env.PORT || '3001', 10);
let activePort = PORT;

export function getActivePort(): number {
  return activePort;
}

export function isServerRunning(): boolean {
  return server !== null;
}

/**
 * Locate the Next.js static export directory.
 *
 * Dev build  → <repo-root>/frontend/out
 * Packaged   → <resourcesPath>/frontend-out   (see electron-builder extraResources)
 */
function getFrontendDir(): string | null {
  const candidates = [
    // Development / unpackaged: relative to dist/
    path.join(__dirname, '../frontend/out'),
    // Packaged: electron-builder copies it to resources/frontend-out
    path.join(process.resourcesPath || '', 'frontend-out'),
  ];

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) {
      return dir;
    }
  }
  return null;
}

export function startServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    app = express();

    app.use(cors());
    app.use(express.json());

    // ── API health check ───────────────────────────────────────────────
    app.get('/api/health', (_req: Request, res: Response) => {
      res.json({
        status: 'ok',
        service: 'Flo Local API',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
      });
    });

    // ── All API routes ─────────────────────────────────────────────────
    registerRoutes(app);

    // ── Serve Next.js static export ────────────────────────────────────
    // Must come AFTER API routes so /api/* is not caught by the SPA fallback.
    const frontendDir = getFrontendDir();
    if (frontendDir) {
      console.log(`[Server] Serving frontend from: ${frontendDir}`);
      app.use(express.static(frontendDir));

      // Smart static page serving for static export:
      // Checks for <dir>/<path>/index.html or <dir>/<path>.html before falling back.
      app.get(/^(?!\/api|\/kds).*$/, (req: Request, res: Response) => {
        const cleanPath = req.path.replace(/^\/+|\/+$/g, '');
        if (cleanPath) {
          const nestedHtml = path.join(frontendDir, cleanPath, 'index.html');
          if (fs.existsSync(nestedHtml)) {
            return res.sendFile(nestedHtml);
          }
          const directHtml = path.join(frontendDir, `${cleanPath}.html`);
          if (fs.existsSync(directHtml)) {
            return res.sendFile(directHtml);
          }
        }
        res.sendFile(path.join(frontendDir, 'index.html'));
      });
    } else {
      console.warn('[Server] Frontend build not found. Run `npm run build:frontend` first.');
      app.get('/', (_req: Request, res: Response) => {
        res.send(`
          <html><body style="font-family:sans-serif;padding:2rem">
            <h2>Flo – Frontend not built</h2>
            <p>Run <code>npm run build:frontend</code> then restart the app.</p>
          </body></html>
        `);
      });
    }

    // ── Global error handler ───────────────────────────────────────────
    app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      console.error('[Server] Error:', err);
      res.status(500).json({ error: err.message || 'Internal server error' });
    });

    const tryListen = (portToTry: number) => {
      const s = app.listen(portToTry, '0.0.0.0', () => {
        server = s;
        activePort = portToTry;
        console.log(`[Server] HTTP server running on http://127.0.0.1:${portToTry}`);

        // Quick self-health check: verify 127.0.0.1 is actually reaching our server (not hijacked by another app returning 426)
        const checkReq = http.get(`http://127.0.0.1:${portToTry}/api/health`, (res) => {
          if (res.statusCode === 200) {
            console.log(`[Server] Port ${portToTry} verified healthy.`);
            if (server) {
              wss = new WebSocketServer({ server, path: '/kds' });
              setupKdsWebSocket(wss);
              console.log(`[Server] KDS WebSocket running on ws://localhost:${portToTry}/kds`);
            }
            resolve();
          } else {
            console.warn(`[Server] Port ${portToTry} responded with status ${res.statusCode} (${res.statusMessage}). Port collision detected!`);
            s.close(() => {
              const fallbackPort = portToTry === PORT ? 3088 : portToTry + 1;
              console.log(`[Server] Falling back to port ${fallbackPort}...`);
              tryListen(fallbackPort);
            });
          }
        });

        checkReq.on('error', (err) => {
          console.warn(`[Server] Health check note on port ${portToTry}:`, err.message);
          if (server) {
            wss = new WebSocketServer({ server, path: '/kds' });
            setupKdsWebSocket(wss);
          }
          resolve();
        });
        checkReq.setTimeout(1500, () => {
          checkReq.destroy();
          resolve();
        });
      });

      s.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          const fallbackPort = portToTry === PORT ? 3088 : portToTry + 1;
          console.log(`[Server] Port ${portToTry} in use (EADDRINUSE), trying ${fallbackPort}`);
          tryListen(fallbackPort);
        } else {
          reject(err);
        }
      });
    };

    tryListen(PORT);
  });
}

export function stopServer(): void {
  if (wss) {
    try {
      wss.close();
    } catch {}
    wss = null;
  }
  if (server) {
    try {
      server.close();
    } catch {}
    server = null;
  }
  console.log('[Server] HTTP server stopped');
}

/** Returns the first non-loopback IPv4 address on the machine. */
export function getLocalIP(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name];
    if (!iface) continue;
    for (const alias of iface) {
      if (alias.family === 'IPv4' && !alias.internal) {
        return alias.address;
      }
    }
  }
  return '127.0.0.1';
}
