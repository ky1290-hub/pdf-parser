#!/usr/bin/env node

import assert from 'node:assert/strict';
import {mkdtemp, readFile, stat, writeFile} from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

const script = path.resolve(process.argv[2] ?? 'scripts/llamaparse.mjs');

function runCli(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {env: {...process.env, ...env}});
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({code, stdout, stderr}));
  });
}

const temp = await mkdtemp(path.join(os.tmpdir(), 'sat-pdf-audit-llamaparse-'));
const pdf = path.join(temp, 'source.pdf');
const output = path.join(temp, 'private', 'result.json');
await writeFile(pdf, '%PDF-1.4\nsynthetic test only\n');

const requests = [];
let pollCount = 0;
const finalBody = JSON.stringify({job: {status: 'COMPLETED'}, markdown: {pages: [{markdown: '# Parsed'}]}});
const server = http.createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  requests.push({method: request.method, url: request.url, authorization: request.headers.authorization, body});
  response.setHeader('Content-Type', 'application/json');
  if (request.url === '/api/v1/beta/files' && request.method === 'POST') response.end(JSON.stringify({id: 'file-test'}));
  else if (request.url === '/api/v2/parse' && request.method === 'POST') response.end(JSON.stringify({id: 'job-test', status: 'PENDING'}));
  else if (request.url.startsWith('/api/v2/parse/job-test') && request.method === 'GET') {
    pollCount += 1;
    response.end(pollCount === 1 ? JSON.stringify({job: {status: 'PENDING'}}) : finalBody);
  } else {
    response.statusCode = 404;
    response.end(JSON.stringify({error: 'not found'}));
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();

try {
  const secret = 'user-owned-test-key-never-print';
  const result = await runCli([pdf, '--out', output, '--poll-ms', '250'], {
    NODE_ENV: 'test',
    LLAMA_CLOUD_API_KEY: secret,
    SAT_PDF_AUDIT_TEST_BASE_URL: `http://127.0.0.1:${address.port}`,
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(await readFile(output, 'utf8'), finalBody);
  assert.equal((await stat(output)).mode & 0o777, 0o600);
  assert.equal(result.stdout.includes(secret), false);
  assert.equal(result.stderr.includes(secret), false);
  assert.equal(requests.length, 4);
  assert.ok(requests.every(request => request.authorization === `Bearer ${secret}`));
  assert.match(requests[0].body, /purpose/);
  assert.match(requests[0].body, /source\.pdf/);
  assert.deepEqual(requests.slice(2).map(request => new URL(request.url, 'http://localhost').searchParams.getAll('expand')), [
    ['text', 'markdown', 'items', 'images_content_metadata'],
    ['text', 'markdown', 'items', 'images_content_metadata'],
  ]);

  const missingKey = await runCli([pdf, '--out', path.join(temp, 'missing.json')], {
    NODE_ENV: 'test',
    LLAMA_CLOUD_API_KEY: '',
    SAT_PDF_AUDIT_TEST_BASE_URL: `http://127.0.0.1:${address.port}`,
  });
  assert.equal(missingKey.code, 1);
  assert.match(missingKey.stderr, /LLAMA_CLOUD_API_KEY is required/);

  const cliKey = await runCli([pdf, '--out', path.join(temp, 'cli.json'), '--api-key', 'forbidden'], {
    NODE_ENV: 'test',
    LLAMA_CLOUD_API_KEY: 'present',
    SAT_PDF_AUDIT_TEST_BASE_URL: `http://127.0.0.1:${address.port}`,
  });
  assert.equal(cliKey.code, 1);
  assert.match(cliKey.stderr, /command-line keys are forbidden/);

  const requestCountBeforeOverwrite = requests.length;
  const existingOutput = path.join(temp, 'existing.json');
  await writeFile(existingOutput, 'preserve me');
  const overwrite = await runCli([pdf, '--out', existingOutput], {
    NODE_ENV: 'test',
    LLAMA_CLOUD_API_KEY: 'present',
    SAT_PDF_AUDIT_TEST_BASE_URL: `http://127.0.0.1:${address.port}`,
  });
  assert.equal(overwrite.code, 1);
  assert.match(overwrite.stderr, /output already exists/);
  assert.equal(await readFile(existingOutput, 'utf8'), 'preserve me');
  assert.equal(requests.length, requestCountBeforeOverwrite);

  console.log('llamaparse tests: 4 passed');
} finally {
  await new Promise(resolve => server.close(resolve));
}
