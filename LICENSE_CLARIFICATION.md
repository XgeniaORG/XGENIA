# LICENSE CLARIFICATION

## Regarding Proprietary Files in Previous Versions

Builds prior to v1.1 (including the v1.0 prototype) contained files that were
inadvertently included from proprietary XGENIA modules. These files — including
Pro Node definitions, AI service configurations, and slot-engine mathematics
modules — were compiled into the repository in error and **do not carry a
GPL-3.0 license**.

Specifically:
- Files under `private/xgenia-pro-nodes/` are proprietary (see
  `private/xgenia-pro-nodes/LICENSE`)
- Files under `private/xgenia-ai/` are proprietary
- Files under `private/xgenia-agent-nodes/` are proprietary
- Files under `MarkPrivate/` are private development files

These files are expressly excluded from the GPL-3.0 license that covers the
XGENIA Editor core.

## Current License Structure

Starting from v1.1, the license structure is as follows:

| Component | License | Location |
|-----------|---------|----------|
| XGENIA Editor (core) | GPL-3.0 | `LICENSES/GPL-3.0.txt` |
| Runtime (xgenia-runtime) | MIT | `packages/xgenia-runtime/LICENSE` |
| Cloud Viewer (xgenia-viewer-cloud) | MIT | `packages/xgenia-viewer-cloud/LICENSE` |
| React Viewer (xgenia-viewer-react) | MIT | `packages/xgenia-viewer-react/LICENSE` |
| Pro Nodes | Proprietary | `private/xgenia-pro-nodes/LICENSE` |
| Agent Nodes | Proprietary | Not distributed |
| AI Service | Proprietary | Not distributed |

For upstream attribution (Noodl / Future Platforms AB), see
`LICENSES/NOODL-ORIGINAL.md`.

For third-party open source notices, see `LICENSES/THIRD-PARTY-NOTICES.md`.

## Applications Built with XGENIA

Applications built **with** XGENIA use the MIT-licensed runtime and viewer
components. This means your deployed applications are **not** subject to the
GPL-3.0 copyleft requirements. You are free to distribute your XGENIA-built
applications under any license you choose.
