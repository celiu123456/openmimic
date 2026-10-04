import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

const INDEX_FILE = 'index.html';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

export interface StaticAsset {
  status: number;
  contentType: string;
  body: Buffer;
}

/** Resolves a URL path to a file under the build directory, if one exists. */
export type StaticHandler = (pathname: string) => Promise<StaticAsset | undefined>;

async function readAsset(file: string): Promise<StaticAsset | undefined> {
  try {
    const info = await stat(file);
    if (!info.isFile()) return undefined;
    const contentType = CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
    return { status: 200, contentType, body: await readFile(file) };
  } catch {
    return undefined;
  }
}

/**
 * Serve a built SPA (for example `web/dist`).
 *
 * Unknown extension-less paths fall back to `index.html` so history-mode
 * routes such as `/i/<token>` work on a hard refresh. Requests that escape
 * the root are refused, and a missing build directory simply serves nothing
 * (the caller keeps answering JSON 404s).
 */
export function createStaticHandler(rootDir: string): StaticHandler {
  const root = resolve(rootDir);
  return async (pathname) => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return undefined;
    }

    const target = resolve(root, decoded.replace(/^\/+/, ''));
    if (target !== root && !target.startsWith(root + sep)) return undefined;

    const direct = await readAsset(target);
    if (direct) return direct;
    if (extname(target) === '') return readAsset(join(root, INDEX_FILE));
    return undefined;
  };
}
