# Third-Party Open Source Notices

This file lists the significant open-source software dependencies used by
XGENIA, grouped by license type. These packages are consumed via npm and are
not modified or redistributed in source form except where noted.

For the complete, machine-readable dependency tree, run `npm ls` from the
project root.

---

## MIT License

The following packages are licensed under the MIT License.
Full text: https://opensource.org/licenses/MIT

| Package | Copyright |
|---------|-----------|
| Electron | Copyright (c) Electron contributors, Copyright (c) GitHub Inc. |
| React | Copyright (c) Meta Platforms, Inc. and affiliates |
| React DOM | Copyright (c) Meta Platforms, Inc. and affiliates |
| Webpack | Copyright JS Foundation and other contributors |
| Monaco Editor | Copyright (c) Microsoft Corporation |
| Express | Copyright (c) TJ Holowaychuk, Douglas Christopher Wilson, and contributors |
| Fabric.js | Copyright (c) Fabric.js contributors |
| Konva | Copyright (c) Anton Lavrenov |
| React-Konva | Copyright (c) Anton Lavrenov |
| jQuery | Copyright (c) OpenJS Foundation and other contributors |
| Passport | Copyright (c) Jared Hanson |
| Supabase JS | Copyright (c) Supabase Inc. |
| Anthropic SDK | Copyright (c) Anthropic PBC |
| Zustand | Copyright (c) Paul Henschel |
| Zod | Copyright (c) Colin McDonnell |
| Underscore.js | Copyright (c) Jeremy Ashkenas, Julian Gonggrijp, and DocumentCloud |
| TailwindCSS | Copyright (c) Tailwind Labs, Inc. |
| PostCSS | Copyright (c) Andrey Sitnik |
| Sass | Copyright (c) Google LLC |
| Vite | Copyright (c) Evan You |
| Storybook | Copyright (c) Storybook contributors |
| Lerna | Copyright (c) Lerna contributors |
| Archiver | Copyright (c) Chris Talkington |
| JSZip | Copyright (c) Stuart Knightley, David Duponchel, Franz Buchinger, António Afonso |
| Electron Builder | Copyright (c) Loopline Systems |
| Electron Updater | Copyright (c) Loopline Systems |
| Electron Store | Copyright (c) Sindre Sorhus |
| Electron Log | Copyright (c) Alexey Prokhorov |
| Dugite | Copyright (c) GitHub Inc. |
| Desktop Trampoline | Copyright (c) GitHub Inc. |
| Bcryptjs | Copyright (c) Daniel Wirtz |
| UUID | Copyright (c) Robert Kieffer and other contributors |
| TypeScript | Copyright (c) Microsoft Corporation |
| Classnames | Copyright (c) Jed Watson |
| CLSX | Copyright (c) Luke Edwards |
| React Hot Toast | Copyright (c) Timo Lins |
| React Markdown | Copyright (c) Espen Hovlandsdal |
| Remarkable | Copyright (c) Jon Schlinkert, Vitaly Puzrin |
| Class Variance Authority | Copyright (c) Joe Bell |
| Tailwind Merge | Copyright (c) Dany Castillo |
| IDB | Copyright (c) Jake Archibald |
| IDB Keyval | Copyright (c) Jake Archibald |
| Algolia Search | Copyright (c) Algolia |
| ws | Copyright (c) Einar Otto Stangvik |
| Undici | Copyright (c) Node.js contributors |
| Fast XML Parser | Copyright (c) Amit Kumar Gupta |
| html-to-image | Copyright (c) Bubkoo |
| MD5 | Copyright (c) Paul Vorbach |
| MkDirP | Copyright (c) James Halliday |
| Split2 | Copyright (c) Matteo Collina |
| TSLib | Copyright (c) Microsoft Corporation |
| About-Window | Copyright (c) nicedoc |
| Bowser | Copyright (c) Dustin Diaz |
| Body-Parser | Copyright (c) Douglas Christopher Wilson, Jonathan Ong |
| Cookie-Session | Copyright (c) Jonathan Ong, Douglas Christopher Wilson |
| Connect-Flash | Copyright (c) Jared Hanson |
| Prop-Types | Copyright (c) Meta Platforms, Inc. and affiliates |
| OTPAuth | Copyright (c) Héctor Molinero Fernández |
| Mixpanel Browser | Copyright (c) Mixpanel Inc. |
| React RND | Copyright (c) bokuweb |
| React InstantSearch | Copyright (c) Algolia |
| iro.js | Copyright (c) James Daniel |
| @microlink/react-json-view | Copyright (c) Microlink |
| @microsoft/fetch-event-source | Copyright (c) Microsoft Corporation |
| @tanstack/react-query | Copyright (c) Tanner Linsley |
| @modelcontextprotocol/sdk | Copyright (c) Anthropic PBC |
| @fal-ai/client | Copyright (c) fal.ai Inc. |
| @google/genai | Copyright (c) Google LLC |

---

## Apache License 2.0

The following packages are licensed under the Apache License 2.0.
Full text: https://www.apache.org/licenses/LICENSE-2.0

| Package | Copyright |
|---------|-----------|
| OpenAI SDK | Copyright (c) OpenAI |
| @aws-sdk/client-s3 | Copyright (c) Amazon.com, Inc. |

---

## BSD 3-Clause License

The following packages are licensed under the BSD 3-Clause License.
Full text: https://opensource.org/licenses/BSD-3-Clause

| Package | Copyright |
|---------|-----------|
| highlight.js | Copyright (c) Ivan Sagalaev |
| diff3 | Copyright (c) Bryan Housel |

---

## ISC License

The following packages are licensed under the ISC License.
Full text: https://opensource.org/licenses/ISC

| Package | Copyright |
|---------|-----------|
| Lucide React | Copyright (c) Lucide contributors |
| Rimraf | Copyright (c) Isaac Z. Schlueter |

---

## Chromium Embedded (Electron)

Electron bundles Chromium and Node.js:
- **Chromium**: Copyright (c) The Chromium Authors. Licensed under BSD-3-Clause.
- **Node.js**: Copyright Node.js contributors. Licensed under MIT.
- **V8**: Copyright (c) The V8 Project Authors. Licensed under BSD-3-Clause.

---

## Hugeicons

XGENIA uses [Hugeicons](https://hugeicons.com/) icon library:
- **@hugeicons/core-free-icons**: Free tier icons, subject to Hugeicons Free License.
- **@hugeicons/react**: React bindings for Hugeicons.

See https://hugeicons.com/license for full terms.

---

## Note on Transitive Dependencies

This file lists the direct, significant dependencies of the XGENIA project.
Each of these packages may have their own transitive dependencies with their
own licenses. These transitive licenses can be inspected by running:

```bash
npx license-checker --production --summary
```

All dependencies have been audited and are compatible with GPL-3.0 distribution.
