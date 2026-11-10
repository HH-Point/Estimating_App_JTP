# JTP Take-Off

Proof of concept for an in-house, AI-assisted take-off tool for painting, waterproofing,
flooring, sealants and wallcovering. It is a Windows desktop app that opens drawing PDFs
directly from job folders and does all its work on the estimator's computer. Nothing is uploaded.

## What works today (step 1: the manual take-off workspace)

- Open a drawing PDF, move between sheets, zoom and pan.
- Set each sheet's scale from a list of standard scales, or by measuring a known dimension.
- Take-off items grouped by trade, measured as area (SF), length (LF) or count (EA).
  A length item can carry a wall height, so paint and wallcovering report wall area.
- Draw highlights, then adjust them: drag corners, add or remove corners, move or delete, undo and redo.
- Quantities update live and export to Excel (a summary sheet and a per-highlight detail sheet).
- The take-off saves itself as `<drawing>.pdf.takeoff.json` next to the PDF, so it travels with the job folder.

Not built yet: the AI agents (steps 2 and 3 of the plan), cut-outs inside areas, and multi-user sign-in.

## Install on Windows

Every build on GitHub produces an installer. Open the repository's **Actions** tab, pick the latest
**Build** run, and download **JTP-Take-Off-windows-installer**. The installer is not code-signed yet,
so Windows SmartScreen will ask for confirmation (More info, then Run anyway).

## Develop

Needs Node 22 and, for the desktop shell, Rust.

```
npm install
npm run dev          # the interface in a browser at http://localhost:1420
npm run tauri dev    # the desktop app
npm test             # unit tests for the measuring maths
npm run build && npm run e2e   # end-to-end test on the sample plan (needs Playwright's Chromium)
npm run tauri build  # build the installer
```

## How it is put together

| Path | What it holds |
| --- | --- |
| `src/model` | Data model, measuring maths, scales, and the app state with undo and redo |
| `src/components` | The drawing viewer, side panels and dialogs |
| `src/io` | PDF loading, saving and loading take-offs, Excel export |
| `src-tauri` | The desktop shell (Tauri). It only adds direct file access |
| `public/sample-plan.pdf` | A 40' x 30' sample plan at 1/8" = 1'-0" used for testing |

Highlights are stored in PDF page coordinates with a `source` of `manual` or `agent`, so the AI
agents planned for later steps write the same highlights a person draws and a person can adjust them.
