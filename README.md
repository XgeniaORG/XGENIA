# XGENIA

> [!WARNING]
> **NOTICE REGARDING PREVIOUS VERSIONS**
> Builds prior to v2.0.0 (including the v1.3.0 prototype) are deprecated due to build and packaging issues. They are strictly unsupported. This repository (v2.0.0+) is the only official source for the project.

**[XGENIA](https://xgenia.com/?utm_source=github&utm_medium=readme&utm_campaign=intro)** is an AI game creation engine and low-code visual editor. Describe a game and the XGENIA AI builds it in the editor — slot games, casino and iGaming titles (with certifiable maths and an RGS), HTML5 games, apps and interactive experiences — and every part stays editable as nodes, so designers and developers can take it from there with minimal coding.

- **AI game builder** — from a prompt to a playable game: key art, screen, reels, maths, sound and effects.
- **Slot and casino games** — cascades, free spins, provably fair random numbers (TRNG → ISAAC), RTP testing.
- **Visual programming** — a node editor with a live preview; publish to the web in one click.

Learn more, see games made with XGENIA and get the editor at **[xgenia.com](https://xgenia.com/?utm_source=github&utm_medium=readme&utm_campaign=learn-more)**.

## Documentation
Documentation for how to use XGENIA can be found here
[XGENIA Documentation](https://docsapp.xgenia.com/)

## Download releases
Pre-built binaries can be [downloaded from GitHub](https://github.com/XgeniaORG/XGENIA/releases)

## Building from source test

```bash
# Install all dependencies
$ npm install

# Start the XGENIA Editor and build a production version of the cloud and react runtime (useful when running XGENIA from source but want to deploy to production)
$ npm start

# Start the XGENIA Editor and watch the filesystem for changes to the runtimes. Development versions of the runtimes, not meant for production (mostly due to source maps and file size)
# This is ideal for a quick workflow when doing changes on the runtimes.
$ npm run dev

# Start XGENIA Editor test runner
$ npm run test:editor
```

## Contributing

We welcome contributions! Please read our [Contributing Guide](./CONTRIBUTING.md) before submitting a Pull Request.

- [Contributing Guide](./CONTRIBUTING.md) — how to get started, code style, and PR process
- [Bug Report](https://github.com/XgeniaORG/XGENIA/issues/new?template=bug_report.yml) — report a bug using our issue form
- [Feature Request](https://github.com/XgeniaORG/XGENIA/issues/new?template=feature_request.yml) — suggest a new feature
- [Security Policy](./.github/SECURITY.md) — how to report vulnerabilities responsibly

## License

This repository contains the Open Source (GPL-3.0) core of XGENIA.

Applications built **with** XGENIA use the MIT-licensed runtime — your deployed
apps are **not** subject to GPL-3.0 copyleft.


