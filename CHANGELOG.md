# Changelog

## [2.4.0](https://github.com/nmime/pikabaka/compare/v2.3.0...v2.4.0) (2026-06-16)


### Features

* **companion:** add trusted phone web companion ([6e75fac](https://github.com/nmime/pikabaka/commit/6e75fac1f88f352f2eea088d4da88e1db081bdf7))
* **settings:** add full config backup and restore ([f239e11](https://github.com/nmime/pikabaka/commit/f239e11ae22cb4f88256e78f48ff38c79dfa25fa))


### Bug Fixes

* attach screenshots, pasted images, model labels, and stream status ([3338869](https://github.com/nmime/pikabaka/commit/3338869aa3ba3bce73a19d900235b378462f9e49))
* compact transcript pane resizing ([5daad22](https://github.com/nmime/pikabaka/commit/5daad22328c4e01ba530a74ee94ac698cf54c2b2))
* dedupe chat controls across UI states ([ba707ea](https://github.com/nmime/pikabaka/commit/ba707ea520ce6a92af434870c0d16bd1b8f19cc4))
* dedupe overlay controls and improve small chat layout ([a164a2a](https://github.com/nmime/pikabaka/commit/a164a2a0e92e4053632cb027a35b4f3f1ae77bcb))
* harden live transcript audio permissions ([823c705](https://github.com/nmime/pikabaka/commit/823c705c61e5b2a98ff9dba8e44f94641e2eb44b))
* keep system audio live without mic grant ([4a012d6](https://github.com/nmime/pikabaka/commit/4a012d6a74f72524c53aaaf59e15cc77792e95ac))
* launch overlay at compact modal size ([fd7090b](https://github.com/nmime/pikabaka/commit/fd7090b984f7af7e6333cc1a546cf283d1182053))
* **mac:** stabilize screen permission identity, screenshots, and chat modal ([3594117](https://github.com/nmime/pikabaka/commit/35941171c58dd8deab3d55ea5436550f7c643448))
* make overlay panes responsive columns ([4c1e593](https://github.com/nmime/pikabaka/commit/4c1e59328ce65f840555249a0e0dbef0acf159ad))
* open overlay at usable expanded size ([a1aec8b](https://github.com/nmime/pikabaka/commit/a1aec8b1e91f4f8ac26949002a7063d4825ff7a2))
* polish chat screenshot layout and STT errors ([0cff19d](https://github.com/nmime/pikabaka/commit/0cff19d11cfff1d28b1bf3bc032f8c353913e9ca))
* restore chat pause stop drag controls ([4dc2f2e](https://github.com/nmime/pikabaka/commit/4dc2f2e492850792a87005f0d8ea26c20e2ee403))
* restore Deepgram live transcript auto mode ([aab40ef](https://github.com/nmime/pikabaka/commit/aab40efac51b1def104a258326c70d90bfb56485))
* **settings:** dedupe config location display ([dc31822](https://github.com/nmime/pikabaka/commit/dc318222dbb353968a875e0b776ed214cd800336))
* **settings:** dedupe config location display ([ed8635c](https://github.com/nmime/pikabaka/commit/ed8635c1b462551ec51abc9013ff1c0ca781dd8c))
* **settings:** preserve language defaults and streaming ([36584c7](https://github.com/nmime/pikabaka/commit/36584c74100cee4cd69d272a3fc7d5e3d84b101a))
* **settings:** render phone companion panel ([36b7006](https://github.com/nmime/pikabaka/commit/36b700660fc8ecc03d4a1525f9881a51704c9c8c))
* shrink overlay launch and settle cropper capture ([dfedc8c](https://github.com/nmime/pikabaka/commit/dfedc8cb417c8d9a0b4345e7b1ed6529a1bee201))
* stabilize overlay chat UI and macOS permissions ([32feda6](https://github.com/nmime/pikabaka/commit/32feda695da37ff542c5ffe8b8c4c488bb9b4264))

## [2.3.0](https://github.com/nmime/pikabaka/compare/v2.2.0...v2.3.0) (2026-06-14)

### Features

* **companion:** add local phone companion MVP ([#2](https://github.com/nmime/pikabaka/pull/2)) ([c2c536f](https://github.com/nmime/pikabaka/commit/c2c536fd6419aab9541f18f3e9ef5e0ed311e91d))

### Bug Fixes

* preserve language defaults and OpenAI-compatible streaming fixes ([dd843f7](https://github.com/nmime/pikabaka/commit/dd843f7a967fed9deb740be589c75f15e61aeff3))

## [2.2.0](https://github.com/royisme/pikabaka/compare/v2.1.0...v2.2.0) (2026-05-06)


### Features

* **settings:** add Auto (multi-language) STT option, gate Azure/IBM ([#6](https://github.com/royisme/pikabaka/issues/6)) ([#12](https://github.com/royisme/pikabaka/issues/12)) ([5369ec3](https://github.com/royisme/pikabaka/commit/5369ec311b4a94907994ca548627f29d81e42c24))
* **stt:** Deepgram multi-language auto-detect ([#2](https://github.com/royisme/pikabaka/issues/2)) ([#9](https://github.com/royisme/pikabaka/issues/9)) ([aef38c5](https://github.com/royisme/pikabaka/commit/aef38c57a71bdff14cb9c5f969e46f7e57f0bd5c))
* **stt:** Google alternativeLanguageCodes for auto ([#3](https://github.com/royisme/pikabaka/issues/3)) ([#8](https://github.com/royisme/pikabaka/issues/8)) ([745a65c](https://github.com/royisme/pikabaka/commit/745a65c44653e5e9f9b8bfba7323ed2df4ec39bd))
* **stt:** OpenAI/Groq Whisper auto-detect language ([#4](https://github.com/royisme/pikabaka/issues/4)) ([#11](https://github.com/royisme/pikabaka/issues/11)) ([b9ed1ab](https://github.com/royisme/pikabaka/commit/b9ed1abb6cc2200bfb8f78d6c91817a626b1d3c3))
* **stt:** Soniox emit detectedLanguage ([#5](https://github.com/royisme/pikabaka/issues/5)) ([#10](https://github.com/royisme/pikabaka/issues/10)) ([02fa893](https://github.com/royisme/pikabaka/commit/02fa8930eee2e5d16d5297e8fbd4896fa3574b4a))
* **transcript:** per-segment language badge + translation copy update ([#7](https://github.com/royisme/pikabaka/issues/7)) ([#13](https://github.com/royisme/pikabaka/issues/13)) ([43bd978](https://github.com/royisme/pikabaka/commit/43bd9787abd3cb1d33d4496535666c1c6e7dcf05))
* **translation:** target-language-only translation + detectedLanguage plumbing ([6cf0037](https://github.com/royisme/pikabaka/commit/6cf0037df9119f626cf0135fa78aea7ac675a5dd))


### Bug Fixes

* **ci:** use pnpm in build-smoke workflow ([#14](https://github.com/royisme/pikabaka/issues/14)) ([bacaae9](https://github.com/royisme/pikabaka/commit/bacaae9e8e59b5600f0d253c853b38a9bdb753c0))


### Build & Release

* add scripts/release.js for one-shot release publishing ([3318e4b](https://github.com/royisme/pikabaka/commit/3318e4b5c9031e2fb105029e760d22fdc7bb0f96))


### Refactoring

* add launcher history components ([88f301a](https://github.com/royisme/pikabaka/commit/88f301ab680832f1e56e74cd772264ed9adf483f))
* modernize launcher and meeting UI ([a43effc](https://github.com/royisme/pikabaka/commit/a43effc2989161fcefc7579f3ef00f6f9a46c2a7))
