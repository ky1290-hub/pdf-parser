#!/usr/bin/env node

import assert from 'node:assert/strict';
import {cp, mkdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'skills', 'sat-pdf-audit');
const files = [
  'references/llamaparse.md',
  'references/protocol.md',
  'scripts/audit-deliverables.mjs',
  'scripts/inventory-pdfs.mjs',
  'scripts/llamaparse.mjs',
];

const check = process.argv.includes('--check');
for (const relative of files) {
  const source = path.join(root, relative);
  const destination = path.join(target, relative);
  if (check) {
    assert.equal(await readFile(destination, 'utf8'), await readFile(source, 'utf8'), `plugin copy drifted: ${relative}`);
  } else {
    await mkdir(path.dirname(destination), {recursive: true});
    await cp(source, destination);
  }
}
console.log(check ? `plugin skill mirror: ${files.length} files match` : `plugin skill mirror: synced ${files.length} files`);
