# Data Handling

## Private by default

Keep these artifacts outside public repositories and CI logs:

- source PDFs and attachments
- untouched parser/OCR responses
- signed image URLs and query strings
- organization, project, job, document, user, or student identifiers
- page renders, figure crops, translated exam text, answers, and explanations
- audit reports containing private paths or source content

## Third-party parsing

Before uploading a document to LlamaParse or another service:

1. Confirm that the user is authorized to upload and transform it.
2. Remove unnecessary personal, student, account, and institution data.
3. Check the provider's current retention, deletion, data-residency, and access-control terms.
4. Use the user's existing secret manager or environment. Never commit credentials.

## Raw and sanitized evidence

Store untouched parser output only in a private, access-controlled evidence area. For a shareable manifest:

- replace signed URLs with authorized local paths and SHA-256 hashes
- redact URL query strings and account/job/document IDs
- remove private filenames and absolute paths
- omit raw content previews
- preserve schema version, page number, geometry semantics, failure state, and hashes

## Copyright and redistribution

The code and protocol do not grant rights to source documents. Use only materials you are licensed or otherwise authorized to process. Do not publish converted exam content, page renders, figures, answer keys, or explanations unless redistribution rights are confirmed.
