#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  extractJobMetadata,
  getTokenMinimums,
  getTokenLimits,
  prepareTailor,
  publishTailor,
  ROOT,
} from './pipeline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.join(ROOT, 'web');
const OUTPUT_ROOT = path.join(ROOT, 'output');
const HOST = '127.0.0.1';
const PORT = Number.parseInt(process.env.RESUME_APP_PORT || '4317', 10);
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.pdf': 'application/pdf',
};

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('Request body must be valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function sendFile(res, filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
    'Content-Length': stat.size,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  fs.createReadStream(filePath).pipe(res);
}

function resolveSafeFile(root, requestedPath) {
  const resolvedRoot = path.resolve(root);
  const resolvedFile = path.resolve(resolvedRoot, requestedPath);
  if (resolvedFile !== resolvedRoot && !resolvedFile.startsWith(`${resolvedRoot}${path.sep}`)) {
    return null;
  }
  return resolvedFile;
}

function openBrowser(url) {
  if (process.env.RESUME_APP_NO_BROWSER === '1' || process.argv.includes('--no-open')) return;
  const commands = {
    win32: ['rundll32.exe', ['url.dll,FileProtocolHandler', url]],
    darwin: ['open', [url]],
    linux: ['xdg-open', [url]],
  };
  const [command, args] = commands[process.platform] || commands.linux;
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/api/config') {
    sendJson(res, 200, {
      model: process.env.OPENAI_MODEL || 'gpt-5.6-sol',
      tokenLimits: getTokenLimits(),
      tokenMinimums: getTokenMinimums(),
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/extract') {
    const body = await readJsonBody(req);
    sendJson(res, 200, await extractJobMetadata(body.jd));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/prepare') {
    const body = await readJsonBody(req);
    sendJson(res, 200, await prepareTailor(body));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/publish') {
    const body = await readJsonBody(req);
    const result = await publishTailor(body);
    sendJson(res, 200, {
      ...result,
      pdfUrl: `/output/${encodeURIComponent(result.pdfFilename)}`,
    });
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/output/')) {
    const filename = decodeURIComponent(url.pathname.slice('/output/'.length));
    if (path.basename(filename) !== filename || !filename.toLowerCase().endsWith('.pdf')) {
      sendJson(res, 400, { error: 'Invalid PDF path.' });
      return;
    }
    const filePath = resolveSafeFile(OUTPUT_ROOT, filename);
    if (!filePath || !fs.existsSync(filePath)) {
      sendJson(res, 404, { error: 'PDF not found.' });
      return;
    }
    sendFile(res, filePath);
    return;
  }

  if (req.method === 'GET') {
    const relativePath = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const filePath = resolveSafeFile(WEB_ROOT, relativePath);
    if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      sendFile(res, filePath);
      return;
    }
  }

  sendJson(res, 404, { error: 'Not found.' });
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    console.error(error);
    if (!res.headersSent) sendJson(res, 500, { error: error.message });
    else res.end();
  });
});

server.on('error', (error) => {
  console.error(`Resume Tailor failed to start: ${error.message}`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}`;
  console.log(`Resume Tailor is ready at ${url}`);
  console.log('Press Ctrl+C to stop it.');
  openBrowser(url);
});
