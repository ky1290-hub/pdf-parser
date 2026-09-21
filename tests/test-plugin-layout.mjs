#!/usr/bin/env node

import assert from 'node:assert/strict';
import {access, readFile} from 'node:fs/promises';

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const portable = JSON.parse(await readFile('plugin.json', 'utf8'));
const codex = JSON.parse(await readFile('.codex-plugin/plugin.json', 'utf8'));
const claude = JSON.parse(await readFile('.claude-plugin/plugin.json', 'utf8'));

for (const manifest of [portable, codex, claude]) {
  assert.equal(manifest.name, 'pdf-parser');
  assert.equal(manifest.version, packageJson.version);
  assert.equal(manifest.license, 'MIT');
  assert.match(manifest.description, /user|user's/i);
}

assert.equal(portable.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
assert.equal(portable.author.name, 'Ivypath Education');
assert.equal(portable.extensions['com.openai'].interface.composerIcon, './assets/ipe-plugin-icon.png');
assert.equal(codex.skills, './skills/');
assert.equal(codex.interface.displayName, 'PDF Parser');
assert.match(codex.interface.longDescription, /own LlamaCloud API key/i);
await access(codex.interface.logo);
await access('skills/pdf-parser/SKILL.md');
await access('skills/pdf-parser/scripts/llamaparse.mjs');
await access('TERMS.md');
await access('OPENAI_SUBMISSION.md');

const icon = await readFile('assets/ipe-plugin-icon.png');
assert.equal(icon.subarray(1, 4).toString('ascii'), 'PNG');
assert.equal(icon.readUInt32BE(16), 512);
assert.equal(icon.readUInt32BE(20), 512);

console.log('plugin layout: portable, Codex, and Claude manifests passed');
