# Resume Tailoring Pipeline

Automates tailoring a resume to a job description without ever touching layout.
GPT only writes text (JSON). A script does all Google Docs/Drive/Sheets work.
Formatting can't break because nothing regenerates it.

```
JD + bullet bank → GPT (returns JSON) → script fills template tokens →
export PDF → log row in tracking sheet
```

---

## Prerequisites

- Node.js 18+
- A Google account (Docs, Drive, Sheets)
- An OpenAI API key
- A Google Cloud project with an **OAuth 2.0 Desktop app client**

---

## One-time Google Cloud setup

1. Create a project at console.cloud.google.com
2. Enable these APIs: **Google Docs API**, **Google Drive API**, **Google Sheets API**
3. Configure the Google Auth Platform consent screen. Use the **Internal** audience
   for an organization-only tool, or add your account as a test user.
4. Create an OAuth client with application type **Desktop app**.
5. Download its JSON as `config/oauth-client.json` (already in `.gitignore`).
6. Run `npm run auth`, sign in with the account that owns the Docs/Drive/Sheet,
   and approve access. The refresh token is saved as `config/oauth-token.json`.

---

## One-time content setup

**Template Doc** — design your resume's final formatting once. Wherever real content
goes, type a placeholder token instead, e.g. `{{SUMMARY}}`, `{{ROLE1_BULLET1}}`,
`{{ROLE1_BULLET2}}`, `{{SKILLS}}`. Apply real formatting (bold, bullet, size) to the
token text itself. Never edit this doc again — only copies of it get modified.

**Bullet bank** — copy `data/bullet-bank.example.json` to the gitignored local file
`data/bullet-bank.json`, then replace the fictional entries with every bullet you've
written across every role. Tag them with skills/keywords and provide 2–3 length
variants of key bullets (short/medium/long) so a swap never overflows its box. You
can use a Google Sheet instead by setting `BULLET_BANK_SHEET_ID`.

**Token length configs** — `config/token-minimums.json` and
`config/token-limits.json` map each token to its minimum and maximum character
counts. Generation automatically revises fields outside that range, e.g.:
```json
{ "SUMMARY": 220, "ROLE1_BULLET1": 140, "ROLE1_BULLET2": 140, "SKILLS": 180 }
```
This gets passed into the GPT prompt so it never generates text that overflows.

**Tracking Sheet** — one header row: `date | company | role | filename | doc_link | pdf_link | status`

---

## Environment variables (`.env`)

```
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-sol   # optional; this is the default
GOOGLE_OAUTH_CLIENT_PATH=./config/oauth-client.json
GOOGLE_OAUTH_TOKEN_PATH=./config/oauth-token.json
TEMPLATE_DOC_ID=          # from the template doc's URL
OUTPUT_FOLDER_ID=         # target Drive folder
TRACKING_SHEET_ID=
BULLET_BANK_SHEET_ID=     # or omit if using data/bullet-bank.json
```

---

## Quick start for a new user

Each user must supply their own OpenAI API key, Google OAuth client, resume
template, Drive output folder, tracking sheet, and bullet bank. Do not share
`.env`, OAuth files, generated resumes, or candidate profiles between users.

```powershell
git clone https://github.com/testme76/TailorResume.git
Set-Location TailorResume
npm install
Copy-Item .env.example .env
Copy-Item data/bullet-bank.example.json data/bullet-bank.json
```

Next, complete the Google Cloud and content setup described above, place the
downloaded OAuth client at `config/oauth-client.json`, and fill in `.env` and
`data/bullet-bank.json` with your own values. Then authorize and verify the app:

```powershell
npm run auth
npm test
npm run app
```

The web app is intentionally local-only at `http://127.0.0.1:4317`. Do not
change it to a public network address unless authentication, per-user storage,
credential protection, and rate limiting have been added.

---

## Project structure

```
/config
  oauth-client.json        (gitignored OAuth desktop client)
  oauth-token.json         (gitignored; created by npm run auth)
  token-minimums.json
  token-limits.json
/data
  bullet-bank.example.json (safe fictional example committed to Git)
  bullet-bank.json         (gitignored local content; optional if using a Sheet)
/src
  auth.js                  # one-time browser OAuth authorization
  openai.js                # calls OpenAI Responses API, returns validated JSON
  docs.js                  # copyTemplate(), replaceTokens(), exportPdf()
  sheets.js                # appendTrackingRow(), checkNameCollision()
  naming.js                # builds "YYYY-MM-DD_Company_Role.pdf", sanitizes
  index.js                 # CLI entry point, orchestrates the run
.env.example
.gitignore
package.json
README.md
```

---

## Workflow (what `index.js` does per run)

1. Take a job description as input (file path, pasted text, or stdin) plus
   `--company` and `--role` flags.
2. Load bullet bank + minimum/maximum token lengths.
3. Call GPT with JD + bullet bank + limits. The API uses **Structured Outputs** to return
   valid JSON with one key per template token and no extra commentary.
4. Validate the JSON: every required token present and every value inside its
   configured length range. Rewrite only fields that are too short or too long;
   never silently truncate or pad them with unsupported claims.
5. Build filename: `YYYY-MM-DD_Company_Role.pdf`. Check the tracking sheet /
   output folder for a collision; append `_v2` etc. if needed.
6. Copy `TEMPLATE_DOC_ID` into `OUTPUT_FOLDER_ID` (Drive API `files.copy`), renamed.
7. For each token, call Docs API `documents.batchUpdate` with a
   `replaceAllText` request — this only swaps the text run's characters,
   inherited formatting is untouched.
8. Export the filled doc to PDF (Drive API `files.export` or download endpoint).
9. Append a row to the tracking sheet.
10. Print the Doc link and PDF path to the console.

## CLI usage (target)

```
npm run tailor -- --jd ./jd.txt --company "Stripe" --role "Product Manager"
```

## Local web app

For the everyday workflow, start the local-only web interface:

```powershell
npm.cmd run app
```

It opens `http://127.0.0.1:4317`. Paste a complete job posting (or use the
clipboard button), let Terra identify the company and role, generate an editable
preview, then confirm before any Google Doc or PDF is created.

Each prepared preview receives a `generationId`. Publishing the same preview
again returns the original result instead of creating duplicate files. Publication
progress is stored locally under `data/publications/`: incomplete Docs and PDF
downloads are cleaned up, while a tracking-sheet failure can be retried without
regenerating the resume. These local state files are intentionally gitignored.

---

## Automated applications (SmartRecruiters and Workable)

The application runner uses a persistent local Chrome profile and deterministic ATS
adapters. It does not use an AI browser agent or discover/filter jobs. Unsupported
sites, CAPTCHAs, and unknown required questions are logged as `needs_attention`.
In headed mode, SmartRecruiters CAPTCHA pages stay open for a bounded manual solve;
the runner resumes automatically after the challenge disappears.
Profile policies can skip jobs that require security clearance, U.S. citizenship,
or required questions such as professional references. Answer rules may use `"valueFrom":
"job.salaryHighEnd"` to deterministically select the highest amount in the posted
salary or compensation range.

Copy and complete the local configuration files first:

```powershell
Copy-Item config/candidate-profile.example.json config/candidate-profile.json
Copy-Item config/apply-settings.example.json config/apply-settings.json
```

Inspect a job without generating a resume or filling a form:

```powershell
npm.cmd run apply -- --inspect --url "https://jobs.workable.com/view/..."
```

Add `--inspect-form` instead to open the application form and print its required
questions and choices without filling or submitting anything.

Fill an application but stop before submission (the default):

```powershell
npm.cmd run apply -- --url "https://jobs.workable.com/view/..."
```

A single URL may also be passed directly:

```powershell
npm.cmd run apply -- "https://jobs.smartrecruiters.com/..."
```

For live submission, both set `submit.enabled` to `true` in
`config/apply-settings.json` and pass `--submit`. Process a manually curated queue
with `--queue data/application-queue.txt`. Every result is appended to
`data/application-history.jsonl`, with screenshots under `output/application-audit/`.

## Chrome tailoring extension

The unpacked Manifest V3 extension in `extension/` reads the current job posting and
generates its tailored resume through the local app. It intentionally does not fill or
submit application forms. Successfully inspected jobs are remembered by canonical URL
so duplicate reviews are skipped. Tailored snapshots and Why-this-company drafts stay
bound when moving from a job page to a different application URL. See
`extension/README.md` for installation and usage.

## Build prompt
