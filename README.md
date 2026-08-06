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
- A Google Cloud project with a **service account** (not OAuth login — a service
  account lets the script run headlessly with no browser login each time)

---

## One-time Google Cloud setup

1. Create a project at console.cloud.google.com
2. Enable these APIs: **Google Docs API**, **Google Drive API**, **Google Sheets API**
3. Create a service account → generate a JSON key → save as `config/service-account.json`
   (already in `.gitignore` — never commit this file)
4. Copy the service account's email (looks like `xxx@xxx.iam.gserviceaccount.com`)
5. Share these three things with that email as **Editor**:
   - your resume template Google Doc
   - the Drive folder you want tailored resumes saved into
   - your tracking Google Sheet

---

## One-time content setup

**Template Doc** — design your resume's final formatting once. Wherever real content
goes, type a placeholder token instead, e.g. `{{SUMMARY}}`, `{{ROLE1_BULLET1}}`,
`{{ROLE1_BULLET2}}`, `{{SKILLS}}`. Apply real formatting (bold, bullet, size) to the
token text itself. Never edit this doc again — only copies of it get modified.

**Bullet bank** — a Google Sheet or `data/bullet-bank.json` with every bullet you've
written across every role, tagged with skills/keywords, plus 2–3 length variants of
key bullets (short/medium/long) so a swap never overflows its box.

**Token limits config** — `config/token-limits.json` mapping each token to a max
character count matching what its box on the template can actually hold, e.g.:
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
GOOGLE_SERVICE_ACCOUNT_PATH=./config/service-account.json
TEMPLATE_DOC_ID=          # from the template doc's URL
OUTPUT_FOLDER_ID=         # target Drive folder
TRACKING_SHEET_ID=
BULLET_BANK_SHEET_ID=     # or omit if using data/bullet-bank.json

---

## Project structure

```
/config
  service-account.json     (gitignored)
  token-limits.json
/data
  bullet-bank.json         (optional, if not using a Sheet)
/src
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
2. Load bullet bank + token limits.
3. Call GPT with JD + bullet bank + limits. The API uses **Structured Outputs** to return
   valid JSON with one key per template token and no extra commentary.
4. Validate the JSON: every required token present, every value under its limit.
   If a value is over limit, ask GPT to shorten just that field — don't
   silently truncate.
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

---

## Build prompt
