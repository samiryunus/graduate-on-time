# Transfer Planner (Minimal Offline)

## Run locally (required)
Browsers restrict local file access, so run a tiny local server:

- Python:
  - `python -m http.server 8000`
  - Open: http://localhost:8000

## Production-grade offline PDF parsing
This ZIP includes an offline integration point for PDF.js.

If course extraction fails, install the official pdf.js files:
- Follow: `vendor/pdfjs/INSTALL_PDFJS.txt`

## What it does
- Extracts course codes from transcript PDFs (when pdf.js is installed)
- Lets you edit completed courses + CC→university equivalencies
- Tracks remaining requirements
- Generates a prerequisite-aware term plan
- Exports your plan as JSON
