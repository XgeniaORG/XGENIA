# XGENIA Proprietary Components

Certain components of the XGENIA platform are **not** covered by the GPL-3.0
license and are distributed separately under proprietary terms.

## Proprietary Modules

The following modules are Copyright (C) 2024-2026 XGENIA. All Rights Reserved:

- **XGENIA Pro Nodes** — Slot game engine, machine learning, and retention
  analysis nodes. See `private/xgenia-pro-nodes/LICENSE` for full terms.

- **XGENIA AI Service** — Cloud-hosted AI orchestration service.

- **XGENIA Agent Nodes** — Agentic AI node definitions for the visual editor.

## Separation

These proprietary modules are loaded at runtime via the External Module Loader
system and are architecturally separated from the GPL-3.0 editor core. They do
not form a derivative work of the GPL-3.0 editor; they communicate through
well-defined plugin interfaces.

## Licensing Enquiries

For licensing enquiries regarding proprietary components, contact:
**licensing@xgenia.ai**
