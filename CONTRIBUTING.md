# Contributing

1. Use only synthetic, redistributable fixtures.
2. Never commit source exams, parser output, signed URLs, credentials, private paths, student data, or copyrighted excerpts.
3. Add a regression test for every validator change.
4. Run `npm test` on Node.js 20 or 22.
5. Keep automated structural checks distinct from manual release gates.
6. Document any output-contract change in README.md.

Security-sensitive findings should follow SECURITY.md rather than a public issue.
