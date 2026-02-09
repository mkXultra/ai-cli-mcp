# [2.6.0](https://github.com/mkXultra/claude-code-mcp/compare/v2.5.0...v2.6.0) (2026-02-09)


### Features

* update model support (gpt-5.3-codex, sonnet[1m], opusplan) and refactor README ([eb6574d](https://github.com/mkXultra/claude-code-mcp/commit/eb6574d3760269d4be96cd934bc03d94ccb3801f))

# [2.5.0](https://github.com/mkXultra/claude-code-mcp/compare/v2.4.0...v2.5.0) (2026-01-24)


### Features

* enhance output parsers for Codex and Claude with tool usage extraction ([b6410a1](https://github.com/mkXultra/claude-code-mcp/commit/b6410a104666eca592735acea093b877c0f03f64))
* track command execution in Codex output and include .gemini config ([91f7f06](https://github.com/mkXultra/claude-code-mcp/commit/91f7f067a1d453fd8e3a5a95bb90f21b7df0af8a))
* update Claude CLI args to stream-json and add verbose option to get_result ([b7f9abc](https://github.com/mkXultra/claude-code-mcp/commit/b7f9abc11c56ad0c8c95e90a614d1d869d8a3bfa))

# [2.4.0](https://github.com/mkXultra/claude-code-mcp/compare/v2.3.3...v2.4.0) (2026-01-24)


### Features

* add model aliases and auto-reasoning for Codex ([16bbd7c](https://github.com/mkXultra/claude-code-mcp/commit/16bbd7cef934cbe2c652e7e48c8dd289f1a64eda))
* add support for gemini-3-flash-preview ([b51a2d1](https://github.com/mkXultra/claude-code-mcp/commit/b51a2d1789455f3366dfc8f6397cf7ffc39f930d))

## [2.3.3](https://github.com/mkXultra/claude-code-mcp/compare/v2.3.2...v2.3.3) (2026-01-20)


### Bug Fixes

* trigger release with correct version ([a0af8cf](https://github.com/mkXultra/claude-code-mcp/commit/a0af8cf25c8d3a1fd3ca7ef26d22f85981cc6f2f))

# 1.0.0 (2026-01-20)


### Bug Fixes

* add fetch-tags to checkout for semantic-release ([33b8650](https://github.com/mkXultra/claude-code-mcp/commit/33b8650bbeb77169c083256f82534ded14f6ecd2))
* Apply npm pkg fix for bin path ([e47140d](https://github.com/mkXultra/claude-code-mcp/commit/e47140d6beebacc60ca1cf55903608f9f207ff94))
* Remove commented-out debug logs from server.ts ([1ef44bb](https://github.com/mkXultra/claude-code-mcp/commit/1ef44bb280fea68dc874fb0d978fea682ddbb681))
* retry release after tag cleanup ([825838b](https://github.com/mkXultra/claude-code-mcp/commit/825838b05b7e6a10ae01d7bc7bb9179a8d6095bc))
* rm not use param ([ad9670c](https://github.com/mkXultra/claude-code-mcp/commit/ad9670cfe04507e40abab2427702b680b00353db))
* trigger release for semantic-release setup ([5e117ee](https://github.com/mkXultra/claude-code-mcp/commit/5e117ee31583ccef2e49c820c815c19716abe392))
* update tests to match current implementation ([2aa7758](https://github.com/mkXultra/claude-code-mcp/commit/2aa775813678d0a9da7150411fd9a1429ff7736f))
* use VITEST env check for test detection and add createTestClient helper ([84fa153](https://github.com/mkXultra/claude-code-mcp/commit/84fa1535aa2c50acf9d5a9650bf881df7ff8d470))


### Features

* Add CHANGELOG and finalize server ([c50a6bb](https://github.com/mkXultra/claude-code-mcp/commit/c50a6bbb5d7dd8d849b1877e19e97a5aedd63493))
* add CWD to code prompt and bump version to 1.1.0 ([b62c9c2](https://github.com/mkXultra/claude-code-mcp/commit/b62c9c2c802f84d0d4eb80e970d08ef25a1a9c40))
* add Gemini CLI support to MCP server ([a9942bc](https://github.com/mkXultra/claude-code-mcp/commit/a9942bc3b0410f5cb45e99108d1b13c252cc5655))
* Add GitHub Actions CI workflow for build checks ([#2](https://github.com/mkXultra/claude-code-mcp/issues/2)) ([613c0cb](https://github.com/mkXultra/claude-code-mcp/commit/613c0cb855b408d83c661a2317db328548dc72e8))
* add process cleanup tool and simplify list output ([cc03323](https://github.com/mkXultra/claude-code-mcp/commit/cc03323df9a24be3c4dcbb6fa1f41d2056b942e4))
* add semantic-release with npm trusted publishing ([ffdf7c8](https://github.com/mkXultra/claude-code-mcp/commit/ffdf7c876060c96cfaf58a74573bda462552fd83))
* add wait tool ,support gemini 3.9 and continue conversation gemini ([5d249ca](https://github.com/mkXultra/claude-code-mcp/commit/5d249ca7c36a6ea2eea26fd15b4796b2721d19f3))
* Codex セッション再開機能とMCP設定ファイルの追加 ([d02b329](https://github.com/mkXultra/claude-code-mcp/commit/d02b329a69df0fcfef65e16609cbb78dc582f1ff))
* Finalize server with dynamic path finding and JSON output ([6c3c410](https://github.com/mkXultra/claude-code-mcp/commit/6c3c4106f4c5f6fdc5cc8e25bb3b0ea142d7e015))
* Integrate CWD parsing from prompt, fix lint errors ([5113edb](https://github.com/mkXultra/claude-code-mcp/commit/5113edba01a905637075a34fe771d0df66aef6e1))
* Organize screenshots, enhance CI, and clean up Git tracking ([7bbc42d](https://github.com/mkXultra/claude-code-mcp/commit/7bbc42d8df204ff6cb1a704ab812d97ff55a2bda))
* Refine server, JSON parsing, docs, and metadata ([4ab9a7f](https://github.com/mkXultra/claude-code-mcp/commit/4ab9a7f8ee0d84d730e3f0faba6fed302be23736))
* Resolve npm link, ESM import, and MCP config issues ([7b0cc83](https://github.com/mkXultra/claude-code-mcp/commit/7b0cc8395eddf25f53835a79d156efee6363bc2a))
* **server:** Prepend system instruction to Claude prompts for broader file access context ([08b9f2d](https://github.com/mkXultra/claude-code-mcp/commit/08b9f2d0cfb0294758cb05cdfc63ec9e5a414b53))
* **server:** Release v1.6.0 - Updates timeout, changelog, error handling, and description ([4382617](https://github.com/mkXultra/claude-code-mcp/commit/4382617bf90924e7df66c807240f928fa3b45507))
* **server:** Release v1.6.0 - Updates timeout, changelog, error handling, and description ([855be94](https://github.com/mkXultra/claude-code-mcp/commit/855be9478cdd2772ff03ea26b2541561422e8599))
* support codex for gpt5 ([e3111d8](https://github.com/mkXultra/claude-code-mcp/commit/e3111d822c33fd58e6c18adbf8ecd4e31919cf9f))
* Unify tools into agentic 'code' tool (v1.4.0) ([87c6704](https://github.com/mkXultra/claude-code-mcp/commit/87c6704ea0bed49140e271d56a50cf268dc510e2))
* update 'code' tool description in server.ts for clarity and power ([dfd2327](https://github.com/mkXultra/claude-code-mcp/commit/dfd2327abff2123fc9b3cccb8d5f6e2cdfc01d1d))

# 1.0.0 (2026-01-20)


### Bug Fixes

* Apply npm pkg fix for bin path ([e47140d](https://github.com/mkXultra/claude-code-mcp/commit/e47140d6beebacc60ca1cf55903608f9f207ff94))
* Remove commented-out debug logs from server.ts ([1ef44bb](https://github.com/mkXultra/claude-code-mcp/commit/1ef44bb280fea68dc874fb0d978fea682ddbb681))
* retry release after tag cleanup ([825838b](https://github.com/mkXultra/claude-code-mcp/commit/825838b05b7e6a10ae01d7bc7bb9179a8d6095bc))
* rm not use param ([ad9670c](https://github.com/mkXultra/claude-code-mcp/commit/ad9670cfe04507e40abab2427702b680b00353db))
* trigger release for semantic-release setup ([5e117ee](https://github.com/mkXultra/claude-code-mcp/commit/5e117ee31583ccef2e49c820c815c19716abe392))
* update tests to match current implementation ([2aa7758](https://github.com/mkXultra/claude-code-mcp/commit/2aa775813678d0a9da7150411fd9a1429ff7736f))
* use VITEST env check for test detection and add createTestClient helper ([84fa153](https://github.com/mkXultra/claude-code-mcp/commit/84fa1535aa2c50acf9d5a9650bf881df7ff8d470))


### Features

* Add CHANGELOG and finalize server ([c50a6bb](https://github.com/mkXultra/claude-code-mcp/commit/c50a6bbb5d7dd8d849b1877e19e97a5aedd63493))
* add CWD to code prompt and bump version to 1.1.0 ([b62c9c2](https://github.com/mkXultra/claude-code-mcp/commit/b62c9c2c802f84d0d4eb80e970d08ef25a1a9c40))
* add Gemini CLI support to MCP server ([a9942bc](https://github.com/mkXultra/claude-code-mcp/commit/a9942bc3b0410f5cb45e99108d1b13c252cc5655))
* Add GitHub Actions CI workflow for build checks ([#2](https://github.com/mkXultra/claude-code-mcp/issues/2)) ([613c0cb](https://github.com/mkXultra/claude-code-mcp/commit/613c0cb855b408d83c661a2317db328548dc72e8))
* add process cleanup tool and simplify list output ([cc03323](https://github.com/mkXultra/claude-code-mcp/commit/cc03323df9a24be3c4dcbb6fa1f41d2056b942e4))
* add semantic-release with npm trusted publishing ([ffdf7c8](https://github.com/mkXultra/claude-code-mcp/commit/ffdf7c876060c96cfaf58a74573bda462552fd83))
* add wait tool ,support gemini 3.9 and continue conversation gemini ([5d249ca](https://github.com/mkXultra/claude-code-mcp/commit/5d249ca7c36a6ea2eea26fd15b4796b2721d19f3))
* Codex セッション再開機能とMCP設定ファイルの追加 ([d02b329](https://github.com/mkXultra/claude-code-mcp/commit/d02b329a69df0fcfef65e16609cbb78dc582f1ff))
* Finalize server with dynamic path finding and JSON output ([6c3c410](https://github.com/mkXultra/claude-code-mcp/commit/6c3c4106f4c5f6fdc5cc8e25bb3b0ea142d7e015))
* Integrate CWD parsing from prompt, fix lint errors ([5113edb](https://github.com/mkXultra/claude-code-mcp/commit/5113edba01a905637075a34fe771d0df66aef6e1))
* Organize screenshots, enhance CI, and clean up Git tracking ([7bbc42d](https://github.com/mkXultra/claude-code-mcp/commit/7bbc42d8df204ff6cb1a704ab812d97ff55a2bda))
* Refine server, JSON parsing, docs, and metadata ([4ab9a7f](https://github.com/mkXultra/claude-code-mcp/commit/4ab9a7f8ee0d84d730e3f0faba6fed302be23736))
* Resolve npm link, ESM import, and MCP config issues ([7b0cc83](https://github.com/mkXultra/claude-code-mcp/commit/7b0cc8395eddf25f53835a79d156efee6363bc2a))
* **server:** Prepend system instruction to Claude prompts for broader file access context ([08b9f2d](https://github.com/mkXultra/claude-code-mcp/commit/08b9f2d0cfb0294758cb05cdfc63ec9e5a414b53))
* **server:** Release v1.6.0 - Updates timeout, changelog, error handling, and description ([4382617](https://github.com/mkXultra/claude-code-mcp/commit/4382617bf90924e7df66c807240f928fa3b45507))
* **server:** Release v1.6.0 - Updates timeout, changelog, error handling, and description ([855be94](https://github.com/mkXultra/claude-code-mcp/commit/855be9478cdd2772ff03ea26b2541561422e8599))
* support codex for gpt5 ([e3111d8](https://github.com/mkXultra/claude-code-mcp/commit/e3111d822c33fd58e6c18adbf8ecd4e31919cf9f))
* Unify tools into agentic 'code' tool (v1.4.0) ([87c6704](https://github.com/mkXultra/claude-code-mcp/commit/87c6704ea0bed49140e271d56a50cf268dc510e2))
* update 'code' tool description in server.ts for clarity and power ([dfd2327](https://github.com/mkXultra/claude-code-mcp/commit/dfd2327abff2123fc9b3cccb8d5f6e2cdfc01d1d))

# 1.0.0 (2026-01-20)


### Bug Fixes

* Apply npm pkg fix for bin path ([e47140d](https://github.com/mkXultra/claude-code-mcp/commit/e47140d6beebacc60ca1cf55903608f9f207ff94))
* Remove commented-out debug logs from server.ts ([1ef44bb](https://github.com/mkXultra/claude-code-mcp/commit/1ef44bb280fea68dc874fb0d978fea682ddbb681))
* rm not use param ([ad9670c](https://github.com/mkXultra/claude-code-mcp/commit/ad9670cfe04507e40abab2427702b680b00353db))
* trigger release for semantic-release setup ([5e117ee](https://github.com/mkXultra/claude-code-mcp/commit/5e117ee31583ccef2e49c820c815c19716abe392))
* update tests to match current implementation ([2aa7758](https://github.com/mkXultra/claude-code-mcp/commit/2aa775813678d0a9da7150411fd9a1429ff7736f))
* use VITEST env check for test detection and add createTestClient helper ([84fa153](https://github.com/mkXultra/claude-code-mcp/commit/84fa1535aa2c50acf9d5a9650bf881df7ff8d470))


### Features

* Add CHANGELOG and finalize server ([c50a6bb](https://github.com/mkXultra/claude-code-mcp/commit/c50a6bbb5d7dd8d849b1877e19e97a5aedd63493))
* add CWD to code prompt and bump version to 1.1.0 ([b62c9c2](https://github.com/mkXultra/claude-code-mcp/commit/b62c9c2c802f84d0d4eb80e970d08ef25a1a9c40))
* add Gemini CLI support to MCP server ([a9942bc](https://github.com/mkXultra/claude-code-mcp/commit/a9942bc3b0410f5cb45e99108d1b13c252cc5655))
* Add GitHub Actions CI workflow for build checks ([#2](https://github.com/mkXultra/claude-code-mcp/issues/2)) ([613c0cb](https://github.com/mkXultra/claude-code-mcp/commit/613c0cb855b408d83c661a2317db328548dc72e8))
* add process cleanup tool and simplify list output ([cc03323](https://github.com/mkXultra/claude-code-mcp/commit/cc03323df9a24be3c4dcbb6fa1f41d2056b942e4))
* add semantic-release with npm trusted publishing ([ffdf7c8](https://github.com/mkXultra/claude-code-mcp/commit/ffdf7c876060c96cfaf58a74573bda462552fd83))
* add wait tool ,support gemini 3.9 and continue conversation gemini ([5d249ca](https://github.com/mkXultra/claude-code-mcp/commit/5d249ca7c36a6ea2eea26fd15b4796b2721d19f3))
* Codex セッション再開機能とMCP設定ファイルの追加 ([d02b329](https://github.com/mkXultra/claude-code-mcp/commit/d02b329a69df0fcfef65e16609cbb78dc582f1ff))
* Finalize server with dynamic path finding and JSON output ([6c3c410](https://github.com/mkXultra/claude-code-mcp/commit/6c3c4106f4c5f6fdc5cc8e25bb3b0ea142d7e015))
* Integrate CWD parsing from prompt, fix lint errors ([5113edb](https://github.com/mkXultra/claude-code-mcp/commit/5113edba01a905637075a34fe771d0df66aef6e1))
* Organize screenshots, enhance CI, and clean up Git tracking ([7bbc42d](https://github.com/mkXultra/claude-code-mcp/commit/7bbc42d8df204ff6cb1a704ab812d97ff55a2bda))
* Refine server, JSON parsing, docs, and metadata ([4ab9a7f](https://github.com/mkXultra/claude-code-mcp/commit/4ab9a7f8ee0d84d730e3f0faba6fed302be23736))
* Resolve npm link, ESM import, and MCP config issues ([7b0cc83](https://github.com/mkXultra/claude-code-mcp/commit/7b0cc8395eddf25f53835a79d156efee6363bc2a))
* **server:** Prepend system instruction to Claude prompts for broader file access context ([08b9f2d](https://github.com/mkXultra/claude-code-mcp/commit/08b9f2d0cfb0294758cb05cdfc63ec9e5a414b53))
* **server:** Release v1.6.0 - Updates timeout, changelog, error handling, and description ([4382617](https://github.com/mkXultra/claude-code-mcp/commit/4382617bf90924e7df66c807240f928fa3b45507))
* **server:** Release v1.6.0 - Updates timeout, changelog, error handling, and description ([855be94](https://github.com/mkXultra/claude-code-mcp/commit/855be9478cdd2772ff03ea26b2541561422e8599))
* support codex for gpt5 ([e3111d8](https://github.com/mkXultra/claude-code-mcp/commit/e3111d822c33fd58e6c18adbf8ecd4e31919cf9f))
* Unify tools into agentic 'code' tool (v1.4.0) ([87c6704](https://github.com/mkXultra/claude-code-mcp/commit/87c6704ea0bed49140e271d56a50cf268dc510e2))
* update 'code' tool description in server.ts for clarity and power ([dfd2327](https://github.com/mkXultra/claude-code-mcp/commit/dfd2327abff2123fc9b3cccb8d5f6e2cdfc01d1d))

# 1.0.0 (2026-01-20)


### Bug Fixes

* Apply npm pkg fix for bin path ([e47140d](https://github.com/mkXultra/claude-code-mcp/commit/e47140d6beebacc60ca1cf55903608f9f207ff94))
* Remove commented-out debug logs from server.ts ([1ef44bb](https://github.com/mkXultra/claude-code-mcp/commit/1ef44bb280fea68dc874fb0d978fea682ddbb681))
* rm not use param ([ad9670c](https://github.com/mkXultra/claude-code-mcp/commit/ad9670cfe04507e40abab2427702b680b00353db))
* update tests to match current implementation ([2aa7758](https://github.com/mkXultra/claude-code-mcp/commit/2aa775813678d0a9da7150411fd9a1429ff7736f))
* use VITEST env check for test detection and add createTestClient helper ([84fa153](https://github.com/mkXultra/claude-code-mcp/commit/84fa1535aa2c50acf9d5a9650bf881df7ff8d470))


### Features

* Add CHANGELOG and finalize server ([c50a6bb](https://github.com/mkXultra/claude-code-mcp/commit/c50a6bbb5d7dd8d849b1877e19e97a5aedd63493))
* add CWD to code prompt and bump version to 1.1.0 ([b62c9c2](https://github.com/mkXultra/claude-code-mcp/commit/b62c9c2c802f84d0d4eb80e970d08ef25a1a9c40))
* add Gemini CLI support to MCP server ([a9942bc](https://github.com/mkXultra/claude-code-mcp/commit/a9942bc3b0410f5cb45e99108d1b13c252cc5655))
* Add GitHub Actions CI workflow for build checks ([#2](https://github.com/mkXultra/claude-code-mcp/issues/2)) ([613c0cb](https://github.com/mkXultra/claude-code-mcp/commit/613c0cb855b408d83c661a2317db328548dc72e8))
* add process cleanup tool and simplify list output ([cc03323](https://github.com/mkXultra/claude-code-mcp/commit/cc03323df9a24be3c4dcbb6fa1f41d2056b942e4))
* add semantic-release with npm trusted publishing ([ffdf7c8](https://github.com/mkXultra/claude-code-mcp/commit/ffdf7c876060c96cfaf58a74573bda462552fd83))
* add wait tool ,support gemini 3.9 and continue conversation gemini ([5d249ca](https://github.com/mkXultra/claude-code-mcp/commit/5d249ca7c36a6ea2eea26fd15b4796b2721d19f3))
* Codex セッション再開機能とMCP設定ファイルの追加 ([d02b329](https://github.com/mkXultra/claude-code-mcp/commit/d02b329a69df0fcfef65e16609cbb78dc582f1ff))
* Finalize server with dynamic path finding and JSON output ([6c3c410](https://github.com/mkXultra/claude-code-mcp/commit/6c3c4106f4c5f6fdc5cc8e25bb3b0ea142d7e015))
* Integrate CWD parsing from prompt, fix lint errors ([5113edb](https://github.com/mkXultra/claude-code-mcp/commit/5113edba01a905637075a34fe771d0df66aef6e1))
* Organize screenshots, enhance CI, and clean up Git tracking ([7bbc42d](https://github.com/mkXultra/claude-code-mcp/commit/7bbc42d8df204ff6cb1a704ab812d97ff55a2bda))
* Refine server, JSON parsing, docs, and metadata ([4ab9a7f](https://github.com/mkXultra/claude-code-mcp/commit/4ab9a7f8ee0d84d730e3f0faba6fed302be23736))
* Resolve npm link, ESM import, and MCP config issues ([7b0cc83](https://github.com/mkXultra/claude-code-mcp/commit/7b0cc8395eddf25f53835a79d156efee6363bc2a))
* **server:** Prepend system instruction to Claude prompts for broader file access context ([08b9f2d](https://github.com/mkXultra/claude-code-mcp/commit/08b9f2d0cfb0294758cb05cdfc63ec9e5a414b53))
* **server:** Release v1.6.0 - Updates timeout, changelog, error handling, and description ([4382617](https://github.com/mkXultra/claude-code-mcp/commit/4382617bf90924e7df66c807240f928fa3b45507))
* **server:** Release v1.6.0 - Updates timeout, changelog, error handling, and description ([855be94](https://github.com/mkXultra/claude-code-mcp/commit/855be9478cdd2772ff03ea26b2541561422e8599))
* support codex for gpt5 ([e3111d8](https://github.com/mkXultra/claude-code-mcp/commit/e3111d822c33fd58e6c18adbf8ecd4e31919cf9f))
* Unify tools into agentic 'code' tool (v1.4.0) ([87c6704](https://github.com/mkXultra/claude-code-mcp/commit/87c6704ea0bed49140e271d56a50cf268dc510e2))
* update 'code' tool description in server.ts for clarity and power ([dfd2327](https://github.com/mkXultra/claude-code-mcp/commit/dfd2327abff2123fc9b3cccb8d5f6e2cdfc01d1d))

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.10.12] - 2025-05-17

- Fixed MCP server startup issue by ensuring process runs regardless of module detection
- Updated server version constant to match package version
- Simplified entry point logic to prevent early exit

## [1.10.11] - 2025-05-17

- Restored package structure to v1.9.4 configuration after bundling issues
- Removed bundling approach and dependencies (esbuild)
- Fixed build by returning to simple TypeScript compilation with tsc
- Kept ESLint in devDependencies where it belongs
- Package now works correctly as MCP server again

## [1.10.10] - 2025-05-17

- Restored shipping TypeScript source files alongside compiled JavaScript
- Returns to the pre-bundling approach of versions 1.5.0-1.9.x
- Includes src/server.ts, tsconfig.json, and start scripts in package
- Provides flexibility for users to run or modify the TypeScript version

## [1.10.9] - 2025-05-17

- Switched from bundling approach to TypeScript compilation like working MCP servers
- Aligns with successful macos-automator-mcp package structure
- Simpler build process with tsc instead of esbuild bundling

## [1.10.8] - 2025-05-17

- Fixed critical dependency issue by moving @eslint/js to devDependencies
- This resolves the MCP server crash on initialization
- Cleaner production bundle without unnecessary development dependencies

## [1.10.7] - 2025-05-17

- Fixed bundling configuration to properly include all native modules
- Resolved MCP initialization errors in bundled version

## [1.10.6] - 2025-05-17

- Runs now from compiled dist, bundled. Faster startup & smaller package size.
- Tool version and startup time print on first use

## [1.10.0] - 2025-05-17

- Support for `CLAUDE_CLI_NAME` environment variable to override the Claude CLI binary name
- Support for absolute paths in `CLAUDE_CLI_NAME` (e.g., `/tmp/claude-test`)
- Comprehensive unit and e2e tests for the server functionality
- Test infrastructure with mocked Claude CLI for reliable testing
- `CLAUDE_CLI_NAME` now supports both simple names and absolute paths
- Relative paths in `CLAUDE_CLI_NAME` now throw an error (security improvement)
- Removed test mock directory lookup when absolute path is provided

## [1.9.5] - 2025-05-15

### Changed  
- Clarify that workingDir must be absolute.

## [1.9.4] - 2025-05-15

### Added
- Enhanced `claude_code` tool description in `src/server.ts` to reflect multi-modal capabilities (image analysis), file content analysis, and provide more comprehensive prompt tips.

### Changed
- Resized example images in `README.md` for better display via HTML width attributes.

## [1.9.3] - 2025-05-15

### Changed
- Better work directory management.

## [1.9.1] - 2025-05-14

### Changed
- Increased the maximum execution timeout for the Claude Code tool from 5 minutes to 30 minutes.

## [1.9.0] - 2025-05-14

### Changed
- Modified the input for the `claude_code` tool. The `workFolder` is now an optional explicit JSON parameter instead of being parsed from the `prompt` string. This improves clarity and simplifies prompt construction.

## [1.8.0] - 2025-05-14

### Changed
- Improved startup stability by explicitly using `/bin/bash` for Claude CLI script execution and ensuring correct command-line arguments are used.

## [1.7.0] - 2025-05-14

### Changed
- Renamed the primary MCP tool from `code` to `claude_code` for better clarity and consistency in UI (`src/server.ts`).
- Updated `README.md` to reflect the new tool name.

## [1.6.1] - 2025-05-14

### Fixed
- Amended previous commit on `feature/v1.6.0-updates` to include `dist/server.js` which was built but not staged.
- Resolved merge conflicts by rebasing `release/v1.6.1` onto `main` before merge.

*(Note: Version 1.6.1 was primarily a maintenance release for PR #6 hygiene after rebasing).*

## [1.6.0] - 2025-05-14

### Added
- Integrated logic in `src/server.ts` to parse "Your work folder is..." directive from prompts to set the Current Working Directory (CWD) for the underlying `claude-code-cli`.
- Default CWD for `claude-code-cli` is set to the user's home directory if no specific "Your work folder is..." directive is provided in the prompt.
- Enhanced error messages for `claude-code-cli` execution failures, including attempts to append `stderr` and `stdout` from the failed process to the error message.

### Fixed
- Resolved various linting errors in `src/server.ts` related to:
    - Correct access of request parameters (e.g., `args.params.name` for tool name, `args.params.arguments.prompt` for prompt).
    - Correct usage of `ErrorCode` enum members from `@modelcontextprotocol/sdk` (e.g., `ErrorCode.MethodNotFound`, `ErrorCode.InvalidParams`, `ErrorCode.InternalError` for timeouts and general failures).
- Ensured `npm run build` completes successfully after CWD logic integration and lint fixes.
- Ensured the `--dangerously-skip-permissions` flag is passed correctly as one of the first arguments to `claude-code-cli`.

### Changed
- Set default execution timeout for `claude-code-cli` to 5 minutes (300,000 ms).

---
*Older versions might not have detailed changelog entries.*
