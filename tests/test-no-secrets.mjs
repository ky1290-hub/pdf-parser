#!/usr/bin/env node

import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {encoding: 'utf8'})
  .trim()
  .split('\n')
  .filter(Boolean)
  .filter(file => existsSync(file))
  .filter(file => !file.endsWith('.png'));

const findings = [];
const patterns = [
  {name: 'LlamaCloud key', regex: /\bllx-[A-Za-z0-9_-]{12,}\b/g},
  {name: 'authorization bearer value', regex: /Authorization\s*[:=]\s*["']?Bearer\s+(?!\$|\{|\[REDACTED\]|<)[A-Za-z0-9._-]{12,}/gi},
];

for (const file of files) {
  const text = await readFile(file, 'utf8');
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern.regex)) findings.push(`${pattern.name}: ${file}:${match.index}`);
  }
}

assert.deepEqual(findings, [], `possible committed secrets:\n${findings.join('\n')}`);
console.log(`secret scan: ${files.length} tracked text files checked`);
