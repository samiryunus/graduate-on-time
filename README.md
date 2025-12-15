# Transfer-to-Grad Planner (Static Website)

## Run locally
- Open `index.html` in a modern browser (Chrome/Edge/Firefox).
- If your browser blocks `fetch()` from `file://`, run a tiny local server:
  - Python: `python -m http.server 8000`
  - Then open: http://localhost:8000

## What it does
- Parses your **Transcript/Degree Audit PDF** (local-only) using pdf.js
- Extracts course codes with regex (editable in `app.js`)
- Lets you define requirements & prerequisites
- Generates a term-by-term plan that respects prerequisites

## Notes
- If your PDF is scanned (image-only), pdf.js text extraction may return little text.
  In that case, manually enter courses into the lists.
- This is not official advising—verify prerequisites, term offerings, and equivalencies.
