# JTP Take-Off

Proof of concept for an in-house, AI-assisted take-off tool for painting, waterproofing,
flooring, sealants and wallcovering. It is a Windows desktop app that opens drawing PDFs
directly from job folders and does all its work on the estimator's computer. Nothing is uploaded.

## What works today

**Manual take-off**

- Open a drawing PDF, move between sheets, zoom and pan.
- Set each sheet's scale from a list of standard scales, by measuring a known dimension, or from an area written on the drawing.
- Take-off items grouped by trade, measured as area (SF), length (LF) or count (EA).
  A length item can carry a wall height, so paint and wallcovering report wall area.
- Draw highlights, then adjust them: drag corners, add or remove corners, move or delete, undo and redo.
- Quantities update live and export to Excel (a summary sheet and a per-highlight detail sheet).
- The take-off saves itself as `<drawing>.pdf.takeoff.json` next to the PDF, so it travels with the job folder.

**Automation**

- **Auto-fill:** click inside a room and the app follows the room's walls to outline it. No AI service is involved.
- **AI take-off:** describe what to take off in plain words. An AI model reads the sheet, decides which rooms
  are in scope and which take-off items apply to each, and the app traces each room from the drawing's own
  linework. The results arrive as dashed highlights for the estimator to check and adjust.
- The AI service is a setting: Claude, OpenAI, or a local model served by anything that speaks the OpenAI
  protocol (Ollama, LM Studio, vLLM). With a hosted service, a picture of the sheet and its text are sent
  to that service; the PDF stays on the computer. With a local model nothing leaves the network.

### How the AI take-off works

The model is not asked to draw. Vision models are good at reading a plan (which spaces are rooms, what
they are called, what the estimator's instruction covers) and poor at placing exact coordinates. So the
model returns, for each room, its name, a point inside it, a rough box around it and the items that apply.
`src/detect` then finds the precise outline by filling outward from that point across the rendered sheet
until it meets linework, and tracing the edge. Rooms that are open to their neighbours are squared off at
the model's box and flagged for checking.

### Known limits

- Rooms have to be enclosed by lines for Auto-fill and the agent to find them cleanly. Open-plan spaces
  are approximated; hatched floors and scanned drawings will fill poorly.
- An outline includes door swings and ignores furniture, casework and columns inside the room.
- The agent reads one sheet at a time and does not yet read finish schedules or deduct openings from wall area.
- API keys are stored in the app's local settings in plain form, not yet in Windows Credential Manager.
- The installer is not code-signed. There is no multi-user sign-in.

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
npm run build && npm run e2e   # end-to-end tests on the sample plan (need Playwright's Chromium)
npm run tauri build  # build the installer
```

## How it is put together

| Path | What it holds |
| --- | --- |
| `src/model` | Data model, measuring maths, scales, and the app state with undo and redo |
| `src/components` | The drawing viewer, side panels and dialogs |
| `src/io` | PDF loading, saving and loading take-offs, Excel export |
| `src/detect` | Finding a room's outline from the rendered sheet, and reading the sheet's text |
| `src/ai` | The take-off agent, its prompt and reply format, and the Claude and OpenAI-compatible connections |
| `src-tauri` | The desktop shell (Tauri). It only adds direct file access |
| `public/sample-plan.pdf` | A 40' x 30' sample plan at 1/8" = 1'-0" used for testing |

Highlights are stored in PDF page coordinates with a `source` of `manual` or `agent`, so the AI agent
writes the same highlights a person draws and a person can adjust them.
