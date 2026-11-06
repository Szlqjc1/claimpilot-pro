# Changelog

All notable user-visible changes to ClaimPilot PRO. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/). Entries are drawn from the git history; decision ids (D-xx) point to
`DECISIONS.md`.

## [1.0.0] - 2026-11-06

### Added

- **AI-RPA expense review demo** for a fictional US automotive supplier: claims list and dashboard with KPIs, claim
  review with the original invoice, the 🚀 Run AI-RPA Audit button, AI Structured Data and an AI-annotated invoice,
  an append-only audit log, and 130 seeded claims including seven hero claims with fixed risk scores. Runs offline
  in mock AI mode; DeepSeek live mode is optional. (`9386e97`)
- **Posting to SAP** (simulated): reviewers resolve or waive each exception with a note, then post the claim, which
  records a MIRO document number and audit entries. (`ef0c89c`, D-20)
- **Sign-in** with email and password, revocable database sessions and three demo accounts; every page and API
  route requires a session. (`5d39aef`, D-26)
- **Roles and segregation of duties**: only reviewers and admins resolve exceptions or post, nobody acts on a claim
  they submitted, and claims are always filed under the signed-in user. (`387ec4c`, D-27)
- **Attribution of system actions**: the audit log shows "initiated by …" under AI and SAP rows, and handled
  exceptions show who handled them. (`1deaee8`, D-31)
- **Escalation routing and a work queue**: flagged claims are assigned by department to a role owner (never the
  submitter), shown as an "Assigned · …" badge, and listed on `/queue` by stage with an Unassigned section.
  (`a03443b`, `8911503`, D-34)
- **Review economics**: an expected-loss layer beside the risk score, the `/economics` page with a cost curve and
  the top claims to review, and `pnpm cost:curve`. (`0673083`, D-35)
- **Grounded Q&A** on `/ask`: answers about claim status, vendor spend, policy limits and priorities, built from
  database facts, with a deterministic template in mock mode and a citation check on model answers. (`e5ceabd`,
  D-36)
- **Extraction provenance and OCR grounding**: each extracted field is checked against the OCR text (✓ found /
  ✗ not found / not extracted); live runs keep the model's extraction and a field-level diff; seeded claims always
  score on their reference extraction; a "Model extraction" / "Fallback" badge shows how a claim was scored.
  (`d1f168d`, `dc39d46`, `e8daca5`, `ba97935`, `a4241a5`, D-37)
- **Grounding benchmark** (`pnpm bench:grounding`, `docs/GROUNDING_BENCH.md`): false alarms on degraded scans and
  detection of injected extraction errors, with confidence bounds. (`0188957`, D-38)
- **Reviewer dispositions**: a third choice, **Not an exception**, records that a rule was wrong, and `/economics`
  shows alert precision by rule. (`0ab0942`, D-39)
- **Realistic scan profile and OCR clean-up for uploads**: grayscale deskew and upscale before Tesseract, chosen by
  measurement; word-level OCR is kept for each upload. (`925b496`, D-40)
- **CI pipeline** running lint, typecheck, tests and build. (`8ae6696`)
- **Screenshots** in the README, regenerated as the UI changed. (`ba090bf`, `fe58ba5`, `66e3d36`, `431949f`)
- **Delivery**: MIT licence, a dev container, a first-run preflight that creates `.env` and seeds the database
  before `pnpm dev`, and a "Run it" section in the README. (`89b3cf2`)
- **Documentation**: grading index `docs/SUBMISSION.md` and measured accessibility evidence `docs/ACCESSIBILITY.md`
  (`pnpm a11y:audit`). (`afbc17d`, `8e847f8`)

### Changed

- AI panels stay visible after a claim is posted. (`ef0c89c`, D-19)
- The session cookie is `Secure` whenever the request arrived over HTTPS, so sign-in also works on a local
  production build over plain http. (`1deaee8`, D-30)
- Sign-in is throttled per account and globally, not only per IP; the global ceiling is 1000/min and the limiter
  evicts least-recently-used entries. (`7d8af1c`, `fc71a10`, D-32, D-33)
- The posting summary in the audit log is now "Exceptions Cleared Before Posting", distinct from a single
  "Exception Resolved". (`22b8b8f`)
- R-14 fires on a critical value that is not in the OCR text or has low OCR-layer confidence, never on an empty
  field and never on the model's self-reported confidence. (`f73cbd6`, D-37)
- Confidence numbers are labelled with their source ("OCR: fixture (simulated)" or Tesseract) everywhere they
  appear, and the README shows the annotated invoice. (`d847d99`)
- The CI badge points at the real repository. (`ddc0058`)

### Fixed

- Invalid configuration now stops the server with one clear message instead of silently falling back to mock mode.
  (`ce2e1b4`, D-21, D-22)
- Running an audit in `pnpm dev` no longer triggers a full page rebuild. (`74fee70`, D-23)
- The screenshot script's temporary style tag is removed in a type-safe way. (`316d9f9`)
