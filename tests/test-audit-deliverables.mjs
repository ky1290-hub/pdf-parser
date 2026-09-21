#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const script = process.argv[2];
if (!script) throw new Error('script path required');
let passed = 0;
function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-deliverables-'));
  for (const [name, body] of Object.entries(files)) {
    const full = path.join(root, name);
    fs.mkdirSync(path.dirname(full), {recursive: true});
    fs.writeFileSync(full, body);
  }
  return root;
}
function run(root, expected = 1, extra = []) {
  const args = [script, root];
  if (expected !== null) args.push('--expected', String(expected));
  args.push(...extra);
  const result = spawnSync(process.execPath, args, {encoding: 'utf8'});
  let json = null;
  try { json = JSON.parse(result.stdout); } catch {}
  return {status: result.status, stderr: result.stderr, json};
}
function check(name, condition, detail = '') {
  if (!condition) throw new Error(`${name} failed${detail ? `: ${detail}` : ''}`);
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}
const validMd = `# Sample\n\n### 1\n\nWhat is 1 + 1?\n\nA. 1\nB. 2\nC. 3\nD. 4\n\n> **Answer: B**\n`;
const validHtml = `<!doctype html><html><body><h4 class="qno">1</h4><p>What is 1 + 1?</p><p>A. 1</p><p>B. 2</p><p>C. 3</p><p>D. 4</p><div class="answer">Answer: B</div></body></html>`;

{
  const root = fixture({});
  const result = run(root, null);
  check('requires expected count', result.status === 2 && result.stderr.includes('--expected is required'));
}
{
  const root = fixture({});
  const result = run(root, 1);
  check('empty directory fails closed', result.status === 1 && result.json?.issues.some(issue => issue.code === 'NO_MARKDOWN_DELIVERABLES'));
}
{
  const root = fixture({'Nested/Sample_Complete.MD': validMd, 'Nested/Sample_Complete.HTML': validHtml});
  const result = run(root, 1);
  check('valid nested uppercase deliverables pass structural checks', result.status === 0 && result.json?.automated_structural_checks_pass === true);
  check('release pass remains false', result.json?.release_pass === false);
}
{
  const root = fixture({'Sample_Complete.md': validMd.replace('What is 1 + 1?', 'According to the graph shown, what is 1 + 1?'), 'Sample_Complete.html': validHtml});
  const result = run(root, 1);
  check('missing exhibit is a hard failure', result.status === 1 && result.json?.issues.some(issue => issue.code === 'MISSING_EXHIBIT'));
}
{
  const md1 = validMd.replace('> **Answer: B**', '');
  const md2 = validMd.replace('### 1', '### 2').replace('> **Answer: B**', '> **Answer: B**\n> **Answer: B**');
  const html1 = validHtml.replace('<div class="answer">Answer: B</div>', '');
  const html2 = validHtml.replace('>1</h4>', '>2</h4>').replace('<div class="answer">Answer: B</div>', '<div class="answer">Answer: B</div><div class="answer">Answer: B</div>');
  const root = fixture({'A_Complete.md': md1, 'A_Complete.html': html1, 'B_Complete.md': md2, 'B_Complete.html': html2});
  const result = run(root, 2);
  check('balanced answer corruption fails per question', result.status === 1 && result.json?.issues.filter(issue => /ANSWER_ASSOCIATION/.test(issue.code)).length >= 4);
}
{
  const md = `${validMd}\n\`\`\`markdown\n### 2\n> **Answer: A**\n\`\`\`\n`;
  const root = fixture({'Sample_Complete.md': md, 'Sample_Complete.html': validHtml});
  const result = run(root, 1);
  check('fenced code requires manual review instead of counting', result.status === 1 && result.json?.issues.some(issue => issue.code === 'FENCED_CODE_REQUIRES_MANUAL_REVIEW'));
}
{
  const md = validMd.replace('What is 1 + 1?', 'See the figure shown.\n\n![x](../outside.png)');
  const html = validHtml.replace('</body>', '<img src="data:image/png;base64,AAAA"></body>');
  const root = fixture({'Sample_Complete.md': md, 'Sample_Complete.html': html});
  const result = run(root, 1);
  check('path traversal and malformed embedded image fail', result.status === 1 && result.json?.issues.some(issue => issue.code === 'INVALID_MARKDOWN_IMAGE') && result.json?.issues.some(issue => issue.code === 'INVALID_HTML_IMAGE'));
}
{
  const root = fixture({'Sample_Complete.md': validMd.replace('What is 1 + 1?', '한글 What is 1 + 1?'), 'Sample_Complete.html': validHtml});
  const en = run(root, 1);
  const any = run(root, 1, ['--language', 'any']);
  check('English mode catches Hangul', en.status === 1 && en.json?.issues.some(issue => issue.code === 'NON_ENGLISH_CJK_RESIDUE'));
  check('language any permits multilingual text', any.status === 0);
}
{
  const root = fixture({'Sample_Complete.md': '# Sample\n\n### Question 1\n\nWhat?\n\nA. one\nB. two\nC. three\nD. four\n\n**Answer:** A\n', 'Sample_Complete.html': '<h4 id="q1" class="pill qno active"><strong>1.</strong></h4><p>What?</p><p>A. one</p><p>B. two</p><p>C. three</p><p>D. four</p><section class="answer box">Answer: A</section>'});
  const result = run(root, 1);
  check('documented flexible heading and class forms pass', result.status === 0);
}
{
  const root = fixture({});
  const reportPath = path.join(root, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify({automated_structural_checks_pass: true}));
  const result = run(path.join(root, 'missing'), 1, ['--json', reportPath]);
  check('invalid invocation removes stale report', result.status === 2 && !fs.existsSync(reportPath));
}
{
  const root = fixture({'Sample_Complete.md': '<!-- ### 1\n> **Answer: A** -->', 'Sample_Complete.html': '<div hidden><h4 class="qno">1</h4><div class="answer">Answer: A</div></div>'});
  const result = run(root, 1);
  check('hidden or commented content cannot satisfy the contract', result.status === 1 && result.json?.issues.some(issue => issue.code === 'HIDDEN_OR_INERT_CONTENT'));
}
{
  const root = fixture({'Sample_Complete.md': validMd, 'Sample_Complete.html': validHtml.replace('</body>', '<script>alert(1)</script></body>')});
  const blocked = run(root, 1);
  const allowed = run(root, 1, ['--allow-active-content']);
  check('active content fails by default', blocked.status === 1 && blocked.json?.issues.some(issue => issue.code === 'ACTIVE_OR_EXTERNAL_CONTENT' && issue.severity === 'error'));
  check('explicit active-content override remains a warning', allowed.status === 0 && allowed.json?.issues.some(issue => issue.code === 'ACTIVE_OR_EXTERNAL_CONTENT' && issue.severity === 'warning'));
}
{
  const root = fixture({'Sample_Complete.md': validMd.replace('> **Answer: B**', '> **Answer: A**'), 'Sample_Complete.html': validHtml});
  const result = run(root, 1);
  check('answer value mismatch fails', result.status === 1 && result.json?.issues.some(issue => issue.code === 'ANSWER_VALUE_MISMATCH'));
}
{
  const root = fixture({'Sample_Complete.md': validMd, 'Sample_Complete.html': validHtml.replace('What is 1 + 1?', 'Who wrote Hamlet?').replace('A. 1', 'A. Austen').replace('B. 2', 'B. Shakespeare')});
  const result = run(root, 1);
  check('material MD and HTML content mismatch fails', result.status === 1 && result.json?.issues.some(issue => issue.code === 'QUESTION_CONTENT_PARITY_FAILED'));
}
{
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const md = validMd.replace('What is 1 + 1?', 'The figure below represents one pixel.\n\n![pixel](pixel.png)');
  const html = validHtml.replace('What is 1 + 1?', 'The figure below represents one pixel.<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=">');
  const root = fixture({'Sample_Complete.md': md, 'Sample_Complete.html': html, 'pixel.png': png});
  const result = run(root, 1);
  check('valid bounded PNG bytes pass and match', result.status === 0 && result.json?.assets[0]?.sha256);
}
{
  const root = fixture({'Sample_Complete.md': validMd.replace('What is 1 + 1?', 'Open https://x.test/?X-Amz-Signature=secret'), 'Sample_Complete.html': validHtml.replace('What is 1 + 1?', 'Open https://x.test/?X-Amz-Signature=secret')});
  const result = run(root, 1);
  check('signed URL pattern fails without leaking the URL', result.status === 1 && result.json?.issues.some(issue => issue.code === 'SENSITIVE_URL_OR_SECRET_PATTERN') && !JSON.stringify(result.json).includes('secret'));
}
{
  const root = fixture({'Sample_Complete.md': validMd.replace('What is 1 + 1?', '[click](javascript:alert(1))'), 'Sample_Complete.html': validHtml.replace('What is 1 + 1?', '<p>click</p>')});
  const result = run(root, 1);
  check('unsafe Markdown link fails active-content gate', result.status === 1 && result.json?.issues.some(issue => issue.code === 'ACTIVE_OR_EXTERNAL_CONTENT'));
}
{
  const root = fixture({'Sample_Complete.md': validMd, 'Sample_Complete.html': validHtml.replace('What is 1 + 1?', 'What is 1 + 1? https://x.test/?x=1&amp;token=secret')});
  const result = run(root, 1);
  check('HTML-encoded credential query fails', result.status === 1 && result.json?.issues.some(issue => issue.code === 'SENSITIVE_URL_OR_SECRET_PATTERN'));
}
{
  const root = fixture({'Sample_Complete.md': validMd, 'Sample_Complete.html': '<textarea><h4 class="qno">1</h4><div class="answer">Answer: B</div></textarea>'});
  const result = run(root, 1);
  check('browser-inert textarea content fails', result.status === 1 && result.json?.issues.some(issue => issue.code === 'HIDDEN_OR_INERT_CONTENT'));
}
{
  const root = fixture({'Sample_Complete.md': validMd, 'Sample_Complete.html': '<!-- <h4 class="qno">1</h4><div class="answer">Answer: B</div>'});
  const result = run(root, 1);
  check('unclosed HTML comment fails', result.status === 1 && result.json?.issues.some(issue => issue.code === 'HTML_COMMENT_NOT_ALLOWED'));
}
{
  const root = fixture({'Sample_Complete.md': validMd, 'Sample_Complete.html': validHtml.replace('</body>', '<style>body{display:none}</style></body>')});
  const result = run(root, 1);
  check('style-based invisibility fails active-content gate', result.status === 1 && result.json?.issues.some(issue => issue.code === 'ACTIVE_OR_EXTERNAL_CONTENT'));
}
{
  const root = fixture({'Sample_Complete.md': validMd, 'Sample_Complete.html': `<dialog>${validHtml}</dialog>`});
  const result = run(root, 1);
  check('closed dialog content fails inert-content gate', result.status === 1 && result.json?.issues.some(issue => issue.code === 'HIDDEN_OR_INERT_CONTENT'));
}
{
  const root = fixture({'Sample_Complete.md': validMd, 'Sample_Complete.html': `<div data-x='<h4 class="qno">1</h4><div class="answer">Answer: B</div>'></div>`});
  const result = run(root, 1);
  check('HTML-like tags inside attributes cannot satisfy counts', result.status === 1 && result.json?.issues.some(issue => issue.code === 'HTML_TAG_INSIDE_ATTRIBUTE'));
}
{
  const root = fixture({'Sample_Complete.md': validMd.replace('What is 1 + 1?', '[x][unsafe]\n\n[unsafe]: javascript:alert(1)'), 'Sample_Complete.html': validHtml});
  const result = run(root, 1);
  check('unsafe Markdown reference link fails', result.status === 1 && result.json?.issues.some(issue => issue.code === 'ACTIVE_OR_EXTERNAL_CONTENT'));
}
{
  const root = fixture({'Sample_Complete.md': validMd, 'Sample_Complete.html': validHtml.replace('</body>', '<a href="java&#x73;cript:alert(1)">x</a></body>')});
  const result = run(root, 1);
  check('entity-encoded active URL fails', result.status === 1 && result.json?.issues.some(issue => issue.code === 'ACTIVE_OR_EXTERNAL_CONTENT'));
}
{
  const root = fixture({'Sample_Complete.md': validMd, 'Sample_Complete.html': validHtml.replace('What is 1 + 1?', 'What is 1 + 1? https://x.test/?token&equals;secret')});
  const result = run(root, 1);
  check('named-entity credential separator fails', result.status === 1 && result.json?.issues.some(issue => issue.code === 'SENSITIVE_URL_OR_SECRET_PATTERN'));
}
{
  const root = fixture({'Sample_Complete.md': validMd.replace('What is 1 + 1?', 'The figure below is raw.\n\n<img src="data:image/png;base64,AAAA">'), 'Sample_Complete.html': validHtml});
  const result = run(root, 1);
  check('raw HTML image in Markdown fails', result.status === 1 && result.json?.issues.some(issue => issue.code === 'RAW_HTML_IMAGE_IN_MARKDOWN'));
}
{
  const root = fixture({'Sample_Complete.md': validMd, 'Sample_Complete.html': `<title>${validHtml}</title>`});
  const result = run(root, 1);
  check('title RCDATA cannot satisfy structural counts', result.status === 1 && result.json?.totals.html_questions === 0);
}
{
  const root = fixture({'Sample_Complete.md': validMd, 'Sample_Complete.html': '<div data-x=<h4 class="qno">1</h4><div class="answer">Answer: B</div>></div>'});
  const result = run(root, 1);
  check('unquoted phantom tag attribute fails', result.status === 1 && result.json?.issues.some(issue => issue.code === 'HTML_TAG_INSIDE_ATTRIBUTE'));
}
{
  const root = fixture({'Sample_Complete.md': validMd.replace('What is 1 + 1?', '[x](<javascript:alert(1)>)'), 'Sample_Complete.html': validHtml});
  const result = run(root, 1);
  check('angle-bracket unsafe Markdown link fails', result.status === 1 && result.json?.issues.some(issue => issue.code === 'ACTIVE_OR_EXTERNAL_CONTENT'));
}
{
  const root = fixture({'Sample_Complete.md': validMd, 'Sample_Complete.html': validHtml.replace('</body>', '<a href=java&#x09;script:alert(1)>x</a></body>')});
  const result = run(root, 1);
  check('unquoted entity-whitespace active URL fails', result.status === 1 && result.json?.issues.some(issue => issue.code === 'ACTIVE_OR_EXTERNAL_CONTENT'));
}
{
  const root = fixture({'Sample_Complete.md': validMd, 'Sample_Complete.html': validHtml.replace('</body>', '<img data-src="data:image/png;base64,AAAA"></body>')});
  const result = run(root, 1);
  check('data-src alternate image source fails', result.status === 1 && result.json?.issues.some(issue => issue.code === 'ALTERNATE_IMAGE_SOURCE_NOT_ALLOWED'));
}
{
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const imageMd = Array.from({length: 5}, (_, i) => `![p${i}](pixel.png)`).join('\n');
  const imageHtml = Array.from({length: 5}, () => `<img src="data:image/png;base64,${png.toString('base64')}">`).join('');
  const md = validMd.replace('What is 1 + 1?', `The figure below is repeated.\n${imageMd}`);
  const html = validHtml.replace('What is 1 + 1?', `The figure below is repeated.${imageHtml}`);
  const root = fixture({'Sample_Complete.md': md, 'Sample_Complete.html': html, 'pixel.png': png});
  const result = run(root, 1);
  check('image reference count is bounded', result.status === 1 && result.json?.issues.some(issue => issue.code === 'IMAGE_REFERENCE_LIMIT_EXCEEDED'));
}
{
  const root = fixture({'Sample_Complete.md': validMd, 'Sample_Complete.html': `<select><option>${validHtml}</option></select>`});
  const result = run(root, 1);
  check('select-option content cannot satisfy structural counts', result.status === 1 && result.json?.issues.some(issue => issue.code === 'HIDDEN_OR_INERT_CONTENT'));
}
{
  const root = fixture({'Sample_Complete.md': validMd, 'Sample_Complete.html': validHtml.replace('</body>', '<input type="image" src="data:image/png;base64,AAAA"></body>')});
  const result = run(root, 1);
  check('alternate renderable input image fails', result.status === 1 && result.json?.issues.some(issue => issue.code === 'ACTIVE_OR_EXTERNAL_CONTENT'));
}
{
  const root = fixture({'Sample_Complete.md': validMd.replace('What is 1 + 1?', '<data:application/xhtml+xml;base64,AAAA>'), 'Sample_Complete.html': validHtml});
  const result = run(root, 1);
  check('unsafe data autolink fails', result.status === 1 && result.json?.issues.some(issue => issue.code === 'ACTIVE_OR_EXTERNAL_CONTENT'));
}
{
  const root = fixture({'Sample_Complete.md': validMd, 'Sample_Complete.html': validHtml.replace('What is 1 + 1?', 'https://x.test/#access_token=secret')});
  const result = run(root, 1);
  check('OAuth fragment token fails without report leakage', result.status === 1 && result.json?.issues.some(issue => issue.code === 'SENSITIVE_URL_OR_SECRET_PATTERN') && !JSON.stringify(result.json).includes('secret'));
}
{
  const valid = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const badChunkType = Buffer.from(valid);
  badChunkType[39] = 'a'.charCodeAt(0);
  const base64 = badChunkType.toString('base64');
  const md = validMd.replace('What is 1 + 1?', 'The figure below is invalid.\n\n![pixel](pixel.png)');
  const html = validHtml.replace('What is 1 + 1?', `The figure below is invalid.<img src="data:image/png;base64,${base64}">`);
  const root = fixture({'Sample_Complete.md': md, 'Sample_Complete.html': html, 'pixel.png': badChunkType});
  const result = run(root, 1);
  check('PNG reserved chunk-type bit is enforced', result.status === 1 && result.json?.issues.some(issue => /INVALID_(?:MARKDOWN|HTML)_IMAGE/.test(issue.code)));
}
{
  const valid = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const noIdat = Buffer.concat([valid.subarray(0, 33), valid.subarray(valid.length - 12)]);
  const base64 = noIdat.toString('base64');
  const md = validMd.replace('What is 1 + 1?', 'The figure below represents one pixel.\n\n![pixel](pixel.png)');
  const html = validHtml.replace('What is 1 + 1?', `The figure below represents one pixel.<img src="data:image/png;base64,${base64}">`);
  const root = fixture({'Sample_Complete.md': md, 'Sample_Complete.html': html, 'pixel.png': noIdat});
  const result = run(root, 1);
  check('PNG without IDAT fails structural decoding', result.status === 1 && result.json?.issues.some(issue => /INVALID_(?:MARKDOWN|HTML)_IMAGE/.test(issue.code)));
}
{
  const root = fixture({'Sample_Complete.md': validMd, 'Sample_Complete.html': `<div popover>${validHtml}</div>`});
  const result = run(root, 1);
  check('closed popover content fails inert-content gate', result.status === 1 && result.json?.issues.some(issue => issue.code === 'HIDDEN_OR_INERT_CONTENT'));
}
{
  const root = fixture({'Sample_Complete.md': validMd, 'Sample_Complete.html': validHtml.replace('<body>', '<body background="https://tracker.test/x">')});
  const result = run(root, 1);
  check('legacy background resource fails active-content gate', result.status === 1 && result.json?.issues.some(issue => issue.code === 'ACTIVE_OR_EXTERNAL_CONTENT'));
}
{
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const b64 = png.toString('base64');
  const md = `### 1\nThe figure below is first.\n![p](pixel.png)\n> **Answer: A**\n\n### 2\nSecond question.\n> **Answer: B**\n`;
  const html = `<h4 class="qno">1</h4><p>The figure below is first.</p><div class="answer">Answer: A</div><h4 class="qno">2</h4><p>Second question.</p><img src="data:image/png;base64,${b64}"><div class="answer">Answer: B</div>`;
  const root = fixture({'Sample_Complete.md': md, 'Sample_Complete.html': html, 'pixel.png': png});
  const result = run(root, 2);
  check('cross-question image relocation fails association gate', result.status === 1 && result.json?.issues.some(issue => issue.code === 'QUESTION_IMAGE_COUNT_MISMATCH'));
}
{
  const md = validMd.replace('> **Answer: B**', '> **Answer:**\nB');
  const root = fixture({'Sample_Complete.md': md, 'Sample_Complete.html': validHtml});
  const result = run(root, 1);
  check('empty Markdown answer marker cannot capture the next line', result.status === 1 && result.json?.issues.some(issue => issue.code === 'EMPTY_OR_UNREADABLE_MARKDOWN_ANSWER'));
}
{
  const many = '<img src="data:image/png;base64,AAAA">'.repeat(1001);
  const root = fixture({'Sample_Complete.md': validMd, 'Sample_Complete.html': validHtml.replace('</body>', `${many}</body>`)});
  const result = run(root, 1);
  check('HTML image cardinality is capped before decoding', result.status === 1 && result.json?.issues.some(issue => issue.code === 'IMAGE_REFERENCE_LIMIT_EXCEEDED'));
}
{
  const root = fixture({'Sample_Complete.md': validMd, 'Sample_Complete.html': validHtml, '.private.json': '{}'});
  const result = run(root, 1);
  check('hidden entries make the audit incomplete', result.status === 1 && result.json?.issues.some(issue => issue.code === 'HIDDEN_ENTRY_PRESENT'));
}
{
  const root = fixture({'Sample_Complete.md': validMd, 'Sample_Complete.html': validHtml, 'target.txt': 'x'});
  fs.symlinkSync(path.join(root, 'target.txt'), path.join(root, 'linked.txt'));
  const result = run(root, 1);
  check('symlink entries make the audit incomplete', result.status === 1 && result.json?.issues.some(issue => issue.code === 'SYMLINK_ENTRY_PRESENT'));
}
{
  const root = fixture({'A_Complete.md': validMd, 'A_Complete.html': validHtml, 'B_Complete.md': validMd, 'B_Complete.html': validHtml});
  const result = run(root, 2);
  check('duplicate deliverable bytes cannot inflate expected count', result.status === 1 && result.json?.issues.some(issue => issue.code === 'DUPLICATE_DELIVERABLE_CONTENT'));
}
{
  const root = fixture({'Sample_Complete.md': validMd, 'Sample_Complete.html': validHtml.replace('</body>', '<link rel="stylesheet" href="hide.css"></body>'), 'hide.css': 'body{display:none}'});
  const result = run(root, 1);
  check('local stylesheet link fails active-content gate', result.status === 1 && result.json?.issues.some(issue => issue.code === 'ACTIVE_OR_EXTERNAL_CONTENT'));
}
{
  const root = fixture({'Sample_Complete.md': validMd, 'Sample_Complete.html': `<datalist>${validHtml}</datalist>`});
  const result = run(root, 1);
  check('datalist content cannot satisfy structural counts', result.status === 1 && result.json?.issues.some(issue => issue.code === 'HIDDEN_OR_INERT_CONTENT'));
}
{
  const markers = Array.from({length: 1001}, (_, i) => `### ${i + 1}\n> **Answer: A**`).join('\n');
  const root = fixture({'Sample_Complete.md': markers, 'Sample_Complete.html': validHtml});
  const result = run(root, 1);
  check('question section cardinality is capped before materialization', result.status === 1 && result.json?.issues.some(issue => issue.code === 'MARKDOWN_QUESTION_LIMIT_EXCEEDED'));
}
{
  const md = `### 1\nSame question text.\nA. X\nB. Y\n> **Answer: A**\n\n### 2\nSame question text.\nA. X\nB. Y\n> **Answer: B**\n`;
  const html = `<h4 class="qno">1</h4><p>Same question text.</p><p>A. X</p><p>B. Y</p><div class="answer">Answer: A</div><h4 class="qno">2</h4><p>Same question text.</p><p>A. X</p><p>B. Y</p><div class="answer">Answer: B</div>`;
  const root = fixture({'Sample_Complete.md': md, 'Sample_Complete.html': html});
  const result = run(root, 2);
  check('renumbered duplicate questions fail canonical fingerprint gate', result.status === 1 && result.json?.issues.some(issue => issue.code === 'DUPLICATE_QUESTION_FINGERPRINT'));
}
{
  const valid = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const textChunk = Buffer.from('AAAAHHRFWHRBdXRob3JpemF0aW9uOiBCZWFyZXIgc2VjcmV04VAu+g==', 'base64');
  const withMetadata = Buffer.concat([valid.subarray(0, valid.length - 12), textChunk, valid.subarray(valid.length - 12)]);
  const base64 = withMetadata.toString('base64');
  const md = validMd.replace('What is 1 + 1?', 'The figure below has metadata.\n\n![pixel](pixel.png)');
  const html = validHtml.replace('What is 1 + 1?', `The figure below has metadata.<img src="data:image/png;base64,${base64}">`);
  const root = fixture({'Sample_Complete.md': md, 'Sample_Complete.html': html, 'pixel.png': withMetadata});
  const result = run(root, 1);
  check('unapproved PNG metadata chunk fails', result.status === 1 && result.json?.issues.some(issue => /INVALID_(?:MARKDOWN|HTML)_IMAGE/.test(issue.code)));
}
{
  const md = validMd.replace('> **Answer: B**', '> **Answer: A = 2**').replace(/^[A-D]\. .*\n/gm, '');
  const html = validHtml.replace('Answer: B', 'Answer: A = 3').replace(/<p>[A-D]\. [^<]*<\/p>/g, '');
  const root = fixture({'Sample_Complete.md': md, 'Sample_Complete.html': html});
  const result = run(root, 1);
  check('complete A-prefixed free-response mismatch fails without value leakage', result.status === 1 && result.json?.issues.some(issue => issue.code === 'ANSWER_VALUE_MISMATCH') && !JSON.stringify(result.json).includes('A = 2') && !JSON.stringify(result.json).includes('A = 3'));
}
{
  const root = fixture({'Sample_Complete.md': `<pre>${validMd}</pre>`, 'Sample_Complete.html': validHtml});
  const result = run(root, 1);
  check('raw preformatted Markdown cannot satisfy structural markers', result.status === 1 && result.json?.issues.some(issue => issue.code === 'HIDDEN_OR_INERT_CONTENT'));
}
{
  const tokens = 'x '.repeat(20_001);
  const md = validMd.replace('What is 1 + 1?', tokens);
  const html = validHtml.replace('What is 1 + 1?', tokens);
  const root = fixture({'Sample_Complete.md': md, 'Sample_Complete.html': html});
  const result = run(root, 1);
  check('per-question token materialization is capped', result.status === 1 && result.json?.issues.some(issue => issue.code === 'QUESTION_TOKEN_LIMIT_EXCEEDED'));
}
{
  const root = fixture({'Sample_Complete.md': validMd, 'Sample_Complete.html': validHtml});
  const inside = path.join(root, 'Late_Complete.md');
  fs.writeFileSync(inside, 'sentinel');
  const result = spawnSync(process.execPath, [script, root, '--expected', '1', '--json', inside], {encoding: 'utf8'});
  check('JSON report path inside audited root is rejected before deletion', result.status === 2 && fs.readFileSync(inside, 'utf8') === 'sentinel');
}
{
  const md = validMd.replace(/^[A-D]\. .*\n/gm, '');
  const html = validHtml.replace(/<p>[A-D]\. [^<]*<\/p>/g, '');
  const root = fixture({'Sample_Complete.md': md, 'Sample_Complete.html': html});
  const result = run(root, 1);
  check('symmetric choice omission fails for choice-label answers', result.status === 1 && result.json?.issues.some(issue => issue.code === 'MARKDOWN_CHOICE_SET_INVALID'));
}
{
  const html = `<noembed>${validHtml}</noembed>`;
  const root = fixture({'Sample_Complete.md': validMd, 'Sample_Complete.html': html});
  const result = run(root, 1);
  check('browser-inert noembed content fails closed', result.status === 1 && result.json?.issues.some(issue => issue.code === 'HIDDEN_OR_INERT_CONTENT'));
}
{
  const html = `<frameset><frame src="local.html"><noframes>${validHtml}</noframes></frameset>`;
  const root = fixture({'Sample_Complete.md': validMd, 'Sample_Complete.html': html, 'local.html': validHtml});
  const result = run(root, 1);
  check('legacy frames and noframes fallback fail closed', result.status === 1 && result.json?.issues.some(issue => issue.code === 'HIDDEN_OR_INERT_CONTENT'));
}
{
  const stem = 'Shared context '.repeat(200);
  const md = `### 1\n${stem}\nA. alpha\nB. beta\nC. gamma\nD. delta\n> **Answer: A**\n`;
  const html = `<h4 class="qno">1</h4><p>${stem}</p><div class="answer">Answer: A</div>`;
  const root = fixture({'Sample_Complete.md': md, 'Sample_Complete.html': html});
  const result = run(root, 1);
  check('response choices cannot be omitted behind a long shared stem', result.status === 1 && result.json?.issues.some(issue => issue.code === 'RESPONSE_STRUCTURE_MISMATCH'));
}
{
  const md = validMd.replace('What is 1 + 1?', 'According to the graph shown, what is 1 + 1?\n\n![graph](broken');
  const root = fixture({'Sample_Complete.md': md, 'Sample_Complete.html': validHtml});
  const result = run(root, 1);
  check('malformed Markdown image cannot satisfy exhibit requirement', result.status === 1 && result.json?.issues.some(issue => issue.code === 'MISSING_EXHIBIT'));
}
{
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const md = validMd.replace('What is 1 + 1?', 'The figure is shown.\n\n![pixel](pixel.png)');
  const html = validHtml.replace('What is 1 + 1?', `The figure is shown.<img width="0" height="0" src="data:image/png;base64,${png.toString('base64')}">`);
  const root = fixture({'Sample_Complete.md': md, 'Sample_Complete.html': html, 'pixel.png': png});
  const result = run(root, 1);
  check('zero-dimension HTML exhibit fails', result.status === 1 && result.json?.issues.some(issue => issue.code === 'INVISIBLE_ZERO_DIMENSION_IMAGE'));
}
{
  const lines = Array.from({length: 65}, (_, index) => `A. candidate ${index}`).join('\n');
  const md = `### 1\n${lines}\n> **Answer: A**\n`;
  const html = `<h4 class="qno">1</h4>${Array.from({length: 65}, (_, index) => `<p>A. candidate ${index}</p>`).join('')}<div class="answer">Answer: A</div>`;
  const root = fixture({'Sample_Complete.md': md, 'Sample_Complete.html': html});
  const result = run(root, 1);
  check('response candidate allocation is capped before parsing', result.status === 1 && result.json?.issues.some(issue => issue.code === 'RESPONSE_CANDIDATE_LIMIT_EXCEEDED'));
}
{
  const md = `${validMd}\n### 3\nWhat?\n> **Answer: A**\n`;
  const html = `${validHtml.replace('</body>', '<h4 class="qno">2</h4><p>What?</p><div class="answer">A</div></body>')}`;
  const root = fixture({'Sample_Complete.md': md, 'Sample_Complete.html': html});
  const result = run(root, 2);
  check('question sequence mismatch fails', result.status === 1 && result.json?.issues.some(issue => issue.code === 'QUESTION_SEQUENCE_MISMATCH'));
}
console.log(`1..${passed}`);
