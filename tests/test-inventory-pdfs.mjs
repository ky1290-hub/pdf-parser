#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const script = process.argv[2];
if (!script) throw new Error('script path required');
let count = 0;
function check(name, condition) { if (!condition) throw new Error(`${name} failed`); count += 1; console.log(`ok ${count} - ${name}`); }
function temp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-pdfs-')); }
function run(root, args = [], env = process.env) {
  const result = spawnSync(process.execPath, [script, root, ...args], {encoding: 'utf8', env});
  let json = null; try { json = JSON.parse(result.stdout); } catch {}
  return {...result, json};
}
{
  const root = temp();
  const result = run(root);
  check('empty source directory fails', result.status === 1 && result.json?.errors.some(error => error.code === 'NO_PDFS_FOUND'));
}
{
  const root = temp();
  fs.writeFileSync(path.join(root, 'bad.pdf'), 'not a pdf');
  const result = run(root);
  check('invalid PDF header is explicit', result.status === 1 && result.json?.pdfs[0]?.pdf_header_valid === false && result.json?.errors.some(error => error.reason === 'invalid_pdf_header'));
}
{
  const root = temp();
  const report = path.join(root, 'report.json');
  fs.writeFileSync(report, '{"inventory_complete":true}');
  const result = run(path.join(root, 'missing'), ['--json', report]);
  check('invalid invocation removes stale report', result.status === 2 && !fs.existsSync(report));
}
{
  const root = temp();
  const report = path.join(root, 'late.pdf');
  fs.writeFileSync(report, 'sentinel');
  const result = run(root, ['--json', report]);
  check('JSON report path inside source root is rejected before deletion', result.status === 2 && fs.readFileSync(report, 'utf8') === 'sentinel');
}
{
  const root = temp();
  const bin = path.join(root, 'bin');
  const docs = path.join(root, 'docs');
  fs.mkdirSync(bin); fs.mkdirSync(docs);
  for (const name of ['pdfinfo', 'pdftotext', 'pdfimages']) {
    const file = path.join(bin, name);
    fs.writeFileSync(file, `#!/bin/sh\nif [ "$1" = "-v" ]; then echo "${name} fake" >&2; exit 0; fi\nexit 7\n`);
    fs.chmodSync(file, 0o755);
  }
  fs.writeFileSync(path.join(docs, 'broken.pdf'), '%PDF-fake');
  const result = run(docs, [], {...process.env, PATH: `${bin}:${process.env.PATH}`});
  check('runtime Poppler failure is explicit', result.status === 1 && result.json?.errors.some(error => error.code === 'PDF_INSPECTION_FAILED' && error.reason === 'exit_7'));
}
{
  const root = temp();
  const bin = path.join(root, 'bin');
  const docs = path.join(root, 'docs');
  fs.mkdirSync(bin); fs.mkdirSync(docs);
  const tools = {
    pdfinfo: '#!/bin/sh\nif [ "$1" = "-v" ]; then echo "pdfinfo fake 1" >&2; exit 0; fi\necho "Pages: 1"\n',
    pdftotext: '#!/bin/sh\nif [ "$1" = "-v" ]; then echo "pdftotext fake 1" >&2; exit 0; fi\nprintf "This page contains enough extracted text to exceed fifty bytes for a low raster risk.\\f"\n',
    pdfimages: '#!/bin/sh\nif [ "$1" = "-v" ]; then echo "pdfimages fake 1" >&2; exit 0; fi\necho "page num type width height"\necho "1 0 image 10 10"\n',
  };
  for (const [name, body] of Object.entries(tools)) { const file = path.join(bin, name); fs.writeFileSync(file, body); fs.chmodSync(file, 0o755); }
  fs.writeFileSync(path.join(docs, 'b.pdf'), '%PDF-fake-b');
  fs.writeFileSync(path.join(docs, 'a.pdf'), '%PDF-fake-a');
  fs.writeFileSync(path.join(docs, '.hidden.pdf'), '%PDF-fake-hidden');
  const result = run(docs, [], {...process.env, PATH: `${bin}:${process.env.PATH}`});
  check('complete inventory succeeds with tools and includes hidden PDFs', result.status === 0 && result.json?.inventory_complete === true && result.json?.pdf_count === 3);
  check('inventory order is deterministic', result.json?.pdfs.map(row => row.file).join(',') === '.hidden.pdf,a.pdf,b.pdf');
  check('page-level evidence and image rows are recorded', result.json?.pdfs.every(row => row.pages === 1 && row.page_evidence[0].raster_risk === 'low' && row.page_evidence[0].image_rows === 1));
  check('stable snapshot records matching before and after hashes', result.json?.pdfs.every(row => row.snapshot_stable === true && row.sha256_before === row.sha256_after && row.sha256 === row.sha256_before));
}
{
  const root = temp();
  const real = path.join(root, 'real.pdf');
  fs.writeFileSync(real, '%PDF-real');
  fs.symlinkSync(real, path.join(root, 'linked.pdf'));
  const result = run(root);
  check('PDF symlinks are explicit inventory errors', result.status === 1 && result.json?.errors.some(error => error.code === 'SYMLINK_SKIPPED' && error.file === 'linked.pdf'));
}
{
  const root = temp();
  for (let i = 0; i < 501; i += 1) fs.writeFileSync(path.join(root, `${i}.pdf`), '%PDF-x');
  const result = run(root);
  check('PDF count limit fails before bulk processing', result.status === 1 && result.json?.errors.some(error => error.code === 'PDF_COUNT_LIMIT_EXCEEDED') && result.json?.pdfs.length === 0);
}
{
  const root = temp();
  const huge = path.join(root, 'huge.pdf');
  fs.writeFileSync(huge, '%PDF-');
  fs.truncateSync(huge, 1024 * 1024 * 1024 + 1);
  const result = run(root);
  check('PDF size limit fails before hashing', result.status === 1 && result.json?.errors.some(error => error.reason === 'pdf_size_limit_exceeded'));
}
{
  const root = temp();
  const bin = path.join(root, 'bin');
  const docs = path.join(root, 'docs');
  fs.mkdirSync(bin); fs.mkdirSync(docs);
  const marker = path.join(root, 'unexpected-call');
  const pdfinfo = path.join(bin, 'pdfinfo');
  fs.writeFileSync(pdfinfo, '#!/bin/sh\nif [ "$1" = "-v" ]; then echo "pdfinfo fake" >&2; exit 0; fi\necho "Pages: 5001"\n');
  const pdftotext = path.join(bin, 'pdftotext');
  fs.writeFileSync(pdftotext, `#!/bin/sh\nif [ "$1" = "-v" ]; then echo "pdftotext fake" >&2; exit 0; fi\ntouch "${marker}"\n`);
  const pdfimages = path.join(bin, 'pdfimages');
  fs.writeFileSync(pdfimages, `#!/bin/sh\nif [ "$1" = "-v" ]; then echo "pdfimages fake" >&2; exit 0; fi\ntouch "${marker}"\n`);
  for (const file of [pdfinfo, pdftotext, pdfimages]) fs.chmodSync(file, 0o755);
  fs.writeFileSync(path.join(docs, 'too-many-pages.pdf'), '%PDF-fake');
  const result = run(docs, [], {...process.env, PATH: `${bin}:${process.env.PATH}`});
  check('page limit stops extraction and evidence allocation', result.status === 1 && result.json?.errors.some(error => error.reason === 'page_limit_exceeded') && result.json?.pdfs[0]?.page_evidence.length === 0 && !fs.existsSync(marker));
}
{
  const root = temp();
  const bin = path.join(root, 'bin');
  const docs = path.join(root, 'docs');
  fs.mkdirSync(bin); fs.mkdirSync(docs);
  const pdfinfo = path.join(bin, 'pdfinfo');
  fs.writeFileSync(pdfinfo, '#!/bin/sh\nif [ "$1" = "-v" ]; then echo "pdfinfo fake" >&2; exit 0; fi\nprintf x >> "$1"\necho "Pages: 1"\n');
  const pdftotext = path.join(bin, 'pdftotext');
  fs.writeFileSync(pdftotext, '#!/bin/sh\nif [ "$1" = "-v" ]; then echo "pdftotext fake" >&2; exit 0; fi\nprintf "enough extracted text to make the page classification deterministic and low risk\\f"\n');
  const pdfimages = path.join(bin, 'pdfimages');
  fs.writeFileSync(pdfimages, '#!/bin/sh\nif [ "$1" = "-v" ]; then echo "pdfimages fake" >&2; exit 0; fi\nexit 0\n');
  for (const file of [pdfinfo, pdftotext, pdfimages]) fs.chmodSync(file, 0o755);
  fs.writeFileSync(path.join(docs, 'changing.pdf'), '%PDF-fake');
  const result = run(docs, [], {...process.env, PATH: `${bin}:${process.env.PATH}`});
  check('source mutation during inventory fails snapshot', result.status === 1 && result.json?.pdfs[0]?.snapshot_stable === false && result.json?.errors.some(error => error.reason === 'source_changed_during_inventory'));
}
console.log(`1..${count}`);
