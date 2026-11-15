# M² diagrams

Made by TJS Code. Source files are Mermaid (.mmd); ready-to-open images are in rendered/ (SVG and PNG).
Paste any .mmd into https://mermaid.live to edit it.

| File | Diagram |
|---|---|
| 01-dfd-level0 | Data flow diagram, context level |
| 02-dfd-level1 | Data flow diagram, level 1 (6 processes, 4 data stores) |
| 03-er-data-model | Relational / entity model |
| 04-class-diagram | Main classes and modules |
| 05a-sequence-clip-mode | Reading a recorded clip |
| 05b-sequence-talk-turn | One spoken turn |
| 06-use-case | Use cases |
| 07-component-diagram | Components |
| 08-state-send-gate | Send gate states |
| 09-deployment | Deployment |

## Honest notes
- Drawn from the real code (v0.9.0). Later changes (up to v0.9.5) are not drawn: the clip reader retries a dropped Presage connection up to 4 times, falls back to the system Node when the SDK cannot open a file inside Electron, and the app checks that a camera shows a picture before recording. It is a design record, not a test result.
- M² has no database. The entity model (03) is the logical data held in memory during a session, plus a few settings in browser storage. Video is not kept: a clip lives in a temporary file that is deleted after reading.
- In the data flow diagrams, the Presage arrows show only the key check and model downloads, which is what the logs showed. I have not verified exactly what Presage's cloud receives, so do not claim anything stronger in the write-up.
- Mermaid has no UML use-case type, so 06 is a flowchart styled as a use-case diagram.
