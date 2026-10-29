#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const [url, outputPath, ...extra] = process.argv.slice(2);
if (!url || !outputPath || extra.length) {
  console.error('Usage: node tools/capture-preview.mjs <digest-url> <output-html-path>');
  process.exit(2);
}

let parsedUrl;
try {
  parsedUrl = new URL(url);
} catch {
  console.error('Digest URL must be an absolute HTTP(S) URL.');
  process.exit(2);
}
if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
  console.error('Digest URL must use HTTP or HTTPS.');
  process.exit(2);
}

function isSelfContained(html) {
  if (!/<html\b/i.test(html) || !/<\/html\s*>/i.test(html)) return false;
  if (/<script\b/i.test(html)) return false;
  if (/<(?:img|iframe|audio|video|source|embed|object)\b[^>]*\bsrc\s*=/i.test(html)) return false;
  if (/<[^>]+\bsrcset\s*=/i.test(html)) return false;
  if (/<link\b[^>]*\bhref\s*=\s*["']?https?:/i.test(html)) return false;
  if (/<(?:link|a)\b[^>]*\bhref\s*=\s*["']\/\//i.test(html)) return false;
  if (/@import\s+(?:url\()?\s*["']?https?:/i.test(html)) return false;
  if (/url\(\s*["']?\s*(?:https?:)?\/\//i.test(html)) return false;
  return true;
}

try {
  const response = await fetch(parsedUrl, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Digest request failed with HTTP ${response.status}.`);
  const contentType = response.headers.get('content-type') ?? '';
  if (!/\btext\/html\b/i.test(contentType)) throw new Error('Digest response is not HTML.');
  const bytes = Buffer.from(await response.arrayBuffer());
  const html = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (!isSelfContained(html)) throw new Error('Digest HTML is not a self-contained document.');
  const destination = resolve(outputPath);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  console.log(`Saved ${bytes.length} bytes; sha256 ${sha256}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Digest capture failed.');
  process.exit(1);
}
