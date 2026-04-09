# Original Noodl Editor — Attribution Notice

XGENIA is a modified version of the **Noodl Editor**, originally created by
**Future Platforms AB** (Stockholm, Sweden).

This notice is provided in compliance with the GNU General Public License v3.0,
Section 5(a), which requires prominent notices stating that the work has been
modified, and giving a relevant date.

## Original Copyright

```
Noodl Editor
Copyright (C) 2024 Future Platforms AB
Licensed under the GNU General Public License v3.0
```

Source repository (archived): https://github.com/noodlapp/noodl

## Modifications

The Noodl Editor source code was forked and substantially modified by XGENIA.
These modifications began in **January 2024** and have continued through the
present day. The modified work is distributed as "XGENIA" under the same
GNU General Public License v3.0.

Key modifications include (but are not limited to):
- Rebranding from "Noodl" to "XGENIA"
- Addition of AI-assisted development features (ChatPanel, Agentic tooling)
- Addition of the Pro Nodes plugin system (proprietary, separately licensed)
- Addition of MCP (Model Context Protocol) integration
- Addition of slot game development tooling
- Modernisation of the UI and design system
- Migration to React 19 and Electron 31
- Addition of Supabase-based cloud services
- Numerous bug fixes and performance improvements

## Original Dual-License Structure

The original Noodl project used a dual-license model which XGENIA preserves:

| Component | Original License | XGENIA Equivalent |
|-----------|-----------------|-------------------|
| Noodl Editor | GPL-3.0 | GPL-3.0 (this project's root license) |
| noodl-runtime | MIT | `packages/xgenia-runtime/LICENSE` |
| noodl-viewer-cloud | MIT | `packages/xgenia-viewer-cloud/LICENSE` |
| noodl-viewer-react | MIT | `packages/xgenia-viewer-react/LICENSE` |

The MIT-licensed runtime and viewer components ensure that applications **built
with** XGENIA are not subject to the GPL-3.0 copyleft requirements. Only the
editor itself is GPL-3.0 licensed.

## Additional Noodl-Origin Code

The `s3` dependency (`git+https://github.com/noodlapp/node-s3-client.git`) is a
Noodl-maintained fork of the `node-s3-client` package, originally licensed under
the MIT License.
