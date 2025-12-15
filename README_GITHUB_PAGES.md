# Transfer Planner (GitHub Pages)

This is a static site designed to work on **GitHub Pages**.

## Deploy on GitHub Pages
1. Create a repo (e.g., `transfer-planner`)
2. Upload **everything in this folder** to the repo root
3. In GitHub: Settings → Pages
   - Source: `Deploy from a branch`
   - Branch: `main` / `(root)`
4. Your site will be live at:
   `https://<username>.github.io/<repo>/`

## Notes
- PDF parsing uses **pdf.js via CDN**, so it works out-of-the-box on GitHub Pages.
- If a school transcript PDF is scanned (image-only), extraction may be empty — manually add courses.
- Everything runs client-side; no files are uploaded anywhere.

## Theme
Primary: #FCBF49
Secondary: #EAE2B7
