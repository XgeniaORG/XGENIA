# XGENIA

> [!WARNING]
> **NOTICE REGARDING PREVIOUS VERSIONS**
> Builds prior to v1.1 (including the v1.0 prototype) are deprecated due to build misconfigurations and licensing conflicts. They are strictly unsupported. This repository (v1.1+) is the only official source for the project.

XGENIA is a low-code platform where designers and developers build custom applications and experiences. Designed as a visual programming environment, it aims to expedite your development process. It promotes the swift and efficient creation of applications, requiring minimal coding knowledge.

## Documentation
Documentation for how to use XGENIA can be found here
[XGENIA Documentation](https://docsapp.xgenia.com/)

## Download releases
Pre-built binaries can be [downloaded from Github]((https://github.com/XgeniaORG/XGENIA/Releases))

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


