#!/usr/bin/env node

import assert from 'node:assert/strict';
import {access, readFile} from 'node:fs/promises';

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const codex = JSON.parse(await readFile('.codex-plugin/plugin.json', 'utf8'));
const claude = JSON.parse(await readFile('.claude-plugin/plugin.json', 'utf8'));

for (const manifest of [codex, claude]) {
  assert.equal(manifest.name, 'sat-pdf-audit');
  assert.equal(manifest.version, packageJson.version);
  assert.equal(manifest.license, 'MIT');
  assert.match(manifest.description, /user|user's/i);
}

assert.equal(codex.skills, './skills/');
assert.equal(codex.interface.displayName, 'SAT PDF Audit');
assert.match(codex.interface.longDescription, /own LlamaCloud API key/i);
await access(codex.interface.logo);
await access('skills/sat-pdf-audit/SKILL.md');
await access('skills/sat-pdf-audit/scripts/llamaparse.mjs');

console.log('plugin layout: Codex and Claude manifests passed');
