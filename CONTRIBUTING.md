# Contributing

Use Node.js 22.22.3+ or 24.15+ and npm. Clone the repository, then run:

```sh
npm ci
npm run check
```

The checks lint and type-check source, run the test suite, build the package, and inspect a locally packed release. Unit and integration tests use local mocks and need no Clear Ideas account, provider key, AWS credentials, or private npm token.

Open a pull request against `main` with a description of the change and its validation. Add focused tests when changing behavior. Use fabricated data and placeholder widget keys in examples; keep `.env`, credentials, generated tarballs, and local service data out of commits.

Contributions are made under the repository's [MIT license](LICENSE). Report suspected vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

Dependency versions and compatibility decisions are documented in [DEPENDENCIES.md](DEPENDENCIES.md).
