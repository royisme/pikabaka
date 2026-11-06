# Changelog

## [3.1.0](https://github.com/royisme/pikabaka/compare/v3.0.0...v3.1.0) (2026-10-31)


### Features

* **audio:** add Gemini Live as a speech service that uses the Gemini API key ([8f4c4df](https://github.com/royisme/pikabaka/commit/8f4c4df5d42aac469d4fbd0c5a4f2b01875169f4))
* **audio:** add Gemini Live as a speech service that uses the Gemini API key ([884d4db](https://github.com/royisme/pikabaka/commit/884d4db0be2972b3be0168184c5f6399f99b26c9))
* **audio:** add Gemini Live to the speech provider list with its key entry and test ([5db70f9](https://github.com/royisme/pikabaka/commit/5db70f9ea1742ddd6e9ac59e655110fc5e2be8c4))
* **audio:** close the Gemini turn when the microphone gate hears the speech stop ([5f33e47](https://github.com/royisme/pikabaka/commit/5f33e47ef05fc4f34969828fb9401312f45b17a3))
* **audio:** log event loop delay and chunk gaps while audio is sent ([acda581](https://github.com/royisme/pikabaka/commit/acda581791f89652bfa9f11f0e39b5b88c9ee916))
* **audio:** log event loop delay and chunk gaps while audio is sent ([3b77763](https://github.com/royisme/pikabaka/commit/3b7776306c4a357a12812094744d9b1c8b3df3ee))
* **audio:** log how much each speech stream delivered and what the echo filter dropped ([b1b7060](https://github.com/royisme/pikabaka/commit/b1b706077313e20ac4b022bbabee8295f39d9657))
* **audio:** log how much each speech stream delivered and what the echo filter dropped ([39b8856](https://github.com/royisme/pikabaka/commit/39b8856d245205c5cfbcf849f5cf6ab589043046))
* **overlay:** show the user's own speech on the live line ([14e5737](https://github.com/royisme/pikabaka/commit/14e57372cefdf31370885d0eba213c05326887f0))
* **overlay:** show the user's own speech on the live line ([46e9e91](https://github.com/royisme/pikabaka/commit/46e9e91b80e7dddedec7ff12c5839da2c2d450e3))


### Bug Fixes

* **audio:** ask ElevenLabs to commit lines by silence and drop its raw audio and message logging ([19e7d52](https://github.com/royisme/pikabaka/commit/19e7d52ef1c487d973a774d5b6402c2f76e34aed))
* **audio:** ask ElevenLabs to commit lines by silence and drop its raw audio and message logging ([da8136c](https://github.com/royisme/pikabaka/commit/da8136c793160bab9e65ad02149a1a440bc2df91))
* **audio:** do not log any part of the ElevenLabs key ([72c089d](https://github.com/royisme/pikabaka/commit/72c089d12cdc1b9455052f5579d8b357bb9ecf96))
* **audio:** list Gemini's own model instead of asking another service ([23eb665](https://github.com/royisme/pikabaka/commit/23eb6656db3bfbe1c54cbb71b437657a515cd122))
* **audio:** measure the audio callbacks that are actually used ([4a410a5](https://github.com/royisme/pikabaka/commit/4a410a5ad5788f0b884aa4dcebb3f0041e6ef6b8))
* **audio:** replace the silence gate with one volume stage so speech is no longer dropped ([c9facdb](https://github.com/royisme/pikabaka/commit/c9facdb6967300fbd294d6c183efbaee96ae9b74))
* **audio:** replace the silence gate with one volume stage so speech is no longer dropped ([2474a60](https://github.com/royisme/pikabaka/commit/2474a602f5e3407189677dce2998f4bdfa39eab8))
* **audio:** send the start of each word from the microphone gate ([0b05570](https://github.com/royisme/pikabaka/commit/0b055709e5287bbbb07d7b184a7cdd5a0dfd7ac3))
* **audio:** send the start of each word from the microphone gate ([293b97e](https://github.com/royisme/pikabaka/commit/293b97e40f938f3422319468d3876cb33dffdcc6))
* **audio:** tell the speech service the microphone's real sample rate ([8b8fc58](https://github.com/royisme/pikabaka/commit/8b8fc58f3aef1be1e285e6c623ba10ee9db1fdbd))
* **audio:** tell the speech service the microphone's real sample rate ([b60c87d](https://github.com/royisme/pikabaka/commit/b60c87d34881aab76b5b45e5d65ea40dbfb7f95d))
* **logging:** do not print any part of a transcript ([3f05c2c](https://github.com/royisme/pikabaka/commit/3f05c2c81128fb167db5b0022baf04c08f401ad8))
* **logging:** do not print any part of a transcript ([7850b0a](https://github.com/royisme/pikabaka/commit/7850b0aecc4bc2a86b73d567f795c1fae614f24b))
* **overlay:** end a stale own-speech live line and keep translation reports off it ([119ef0e](https://github.com/royisme/pikabaka/commit/119ef0ebd4bfa5236e73613f6950b70be11313d5))
* **overlay:** give the question card room for four lines of text ([52a598b](https://github.com/royisme/pikabaka/commit/52a598b07c665a34e56b12de9368096792852b0f))
* **overlay:** give the question card room for four lines of text ([52cda0f](https://github.com/royisme/pikabaka/commit/52cda0fa26be893f027cd5d1f2c9ba35af38ced8))
* **rag:** keep the selected embedding connection when credentials load at startup ([f72cd07](https://github.com/royisme/pikabaka/commit/f72cd0799f495739ed51aad3c0be1e2aa9e4fa49))
* **rag:** keep the selected embedding connection when credentials load at startup ([d8356c8](https://github.com/royisme/pikabaka/commit/d8356c8efa2f69ca83f39aa6c69d28686b867738))
* **settings:** make the main action of each section a filled button with one shared style ([47f771e](https://github.com/royisme/pikabaka/commit/47f771efdabe4b93e9dea4c7e8bbab615d0cc3d4))
* **settings:** make the main action of each section a filled button with one shared style ([af3131c](https://github.com/royisme/pikabaka/commit/af3131c861b6f7878a97083a3d11f8df39377c95))


### Refactoring

* **audio:** connect the captures to the speech service in one place ([4287e11](https://github.com/royisme/pikabaka/commit/4287e113b36dd66d2e431bf0456071f37f633fc6))
* **settings:** split the settings overlay by tab ([a99b3ad](https://github.com/royisme/pikabaka/commit/a99b3adf37e4998d111b2be7ddacea410a1c36d5))
* **settings:** split the settings overlay by tab ([fc6da4b](https://github.com/royisme/pikabaka/commit/fc6da4b299768e5c88b257634a049843244fdd31))
* **transcript:** move the transcript and chat flag state to reducers ([5bea403](https://github.com/royisme/pikabaka/commit/5bea4036d269301b1adf3d85f6d495ea0e1022b7))
* **transcript:** move the transcript and chat flag state to reducers ([01a9615](https://github.com/royisme/pikabaka/commit/01a961585cd466a43892e82fcf7ec472d370fb39))

## [3.0.0](https://github.com/royisme/pikabaka/compare/v2.4.0...v3.0.0) (2026-10-30)


### ⚠ BREAKING CHANGES

* **release:** the interview feature, resume and JD import, the profile and negotiation tools are removed; the stored speaker value "interviewer" becomes "them" (the database is backed up to <db>.before-them first); prompts are now edited as text in Settings.

### Features

* **connections:** carry optional custom headers on custom providers ([41fd4bf](https://github.com/royisme/pikabaka/commit/41fd4bfdd77fc14cc7d300bbf735e61c833ae78b))
* **connections:** carry optional custom headers on custom providers ([a7d5e02](https://github.com/royisme/pikabaka/commit/a7d5e025c43e12ee5464b630824b685cd3569ee7))
* **credentials:** encrypt stored credentials with the operating system's secure storage ([a93db88](https://github.com/royisme/pikabaka/commit/a93db881d5e0e0f9720a28b40913c3b3db1529a9))
* **credentials:** encrypt stored credentials with the operating system's secure storage ([ea3ebb1](https://github.com/royisme/pikabaka/commit/ea3ebb1436fbbb45385bf8cb166f70986af60569))
* **knowledge:** import documents as searchable materials, backend only ([2eecd29](https://github.com/royisme/pikabaka/commit/2eecd299929542ca2272e9377c9182b914f30a5b))
* **knowledge:** import documents as searchable materials, backend only ([46772fb](https://github.com/royisme/pikabaka/commit/46772fba6e03c98b245172bbbe7c491f71e3a905))
* **knowledge:** let the user decide which stored sources answers may use ([356123e](https://github.com/royisme/pikabaka/commit/356123eb97be02915b39c5ba0be95521fbed6b03))
* **knowledge:** let the user decide which stored sources answers may use ([72d82d3](https://github.com/royisme/pikabaka/commit/72d82d3b8105e20dcd20a5f3237569086009c9e6))
* **knowledge:** list, import, remove and re-index documents on the Sources page ([87226e8](https://github.com/royisme/pikabaka/commit/87226e8fca84271d84523738c658fd47e2fb223d))
* **knowledge:** list, import, remove and re-index documents on the Sources page ([2e50c98](https://github.com/royisme/pikabaka/commit/2e50c98678b473f2fafba73f8b360ff7e688bcce))
* **knowledge:** quote matching imported documents in quick answers ([75750ca](https://github.com/royisme/pikabaka/commit/75750ca406aabbdadcfc0a0037f20d5cc6246c4c))
* **knowledge:** quote matching imported documents in quick answers ([3931925](https://github.com/royisme/pikabaka/commit/39319253033cd72be20eedd7ce8b2367aefdddd0))
* **knowledge:** record how each note was indexed and skip a mismatched model ([a5ccb94](https://github.com/royisme/pikabaka/commit/a5ccb94247e1b56adb0128a50d0744eaa14467f1))
* **knowledge:** record how each note was indexed and skip a mismatched model ([c7190c1](https://github.com/royisme/pikabaka/commit/c7190c1e1d8219aecc634125446127edb033f8f7))
* **knowledge:** search notes as data and switch what answers may use ([d4a69cc](https://github.com/royisme/pikabaka/commit/d4a69ccd92e230c7e3dc2066e1c45185786a65a9))
* **knowledge:** search notes as data and switch what answers may use ([1e30d69](https://github.com/royisme/pikabaka/commit/1e30d69ba914980b643cf287c5a0982c293cdc5c))
* **prompt:** edit the role and task prompts in Settings ([3b3b02e](https://github.com/royisme/pikabaka/commit/3b3b02ebb6b7a27cd1a4a845686e721390e729ed))
* **prompt:** edit the role and task prompts in Settings ([ecbec37](https://github.com/royisme/pikabaka/commit/ecbec37f3cab536cfebe0cc44154b6787d328a7a))
* **rag:** keep the summary index current after commit, recovery and edit ([e35f8ba](https://github.com/royisme/pikabaka/commit/e35f8ba7b4bc71d885e98c2ae486920157731645))
* **rag:** keep the summary index current after commit, recovery and edit ([1295d06](https://github.com/royisme/pikabaka/commit/1295d062360a1de70f411ab19bd3ca3c42d76ef7))
* **rag:** refresh the summary index safely ([85a45d8](https://github.com/royisme/pikabaka/commit/85a45d846017ec34660a8c813c33739048c27b7b))
* **rag:** refresh the summary index safely ([fd98cd3](https://github.com/royisme/pikabaka/commit/fd98cd352362beb5a15ed11888d226ba86a16062))
* **rag:** retry failed indexing, re-index everything, and leave no orphan vectors ([edae2fd](https://github.com/royisme/pikabaka/commit/edae2fd9d3ffc14f3b8dd4cbca736e0f550c14fe))
* **rag:** retry failed indexing, re-index everything, and leave no orphan vectors ([13b4c54](https://github.com/royisme/pikabaka/commit/13b4c549ddc260e346996e842adb2b69a3ed88ce))
* **settings:** add a Provider setup tab for connections ([cc5a264](https://github.com/royisme/pikabaka/commit/cc5a264a0564da02a363ac0e19db716a01187ba0))
* **settings:** add a Provider setup tab for connections ([e835bee](https://github.com/royisme/pikabaka/commit/e835bee6c97370a8cfa557649428c1f890e91ccf))
* **settings:** add an Updates card to the About tab ([536a86e](https://github.com/royisme/pikabaka/commit/536a86e7054abeb072edfa3eefe9da7820612b06))
* **settings:** add an Updates card to the About tab ([7022290](https://github.com/royisme/pikabaka/commit/70222903a475cb66e7f73c05ffcc2d9502a62732))
* **settings:** cut the shortcuts to six defaults and fix settings wording ([b213e1b](https://github.com/royisme/pikabaka/commit/b213e1b8b60b04e4cbbaf3ef6499c72da590b756))
* **settings:** cut the shortcuts to six, fix settings wording, reorder audio settings ([5b804c0](https://github.com/royisme/pikabaka/commit/5b804c03ffa5f44e2a6851fe1a9437e0af7df55c))
* **settings:** edit custom headers on a custom provider ([2d0596d](https://github.com/royisme/pikabaka/commit/2d0596d159835ae92eecf59a4373cf9fc20405cd))
* **settings:** edit custom headers on a custom provider ([31d5c69](https://github.com/royisme/pikabaka/commit/31d5c69d145a627459fc8fa41b66ffde7be88d54))
* **settings:** list one row per configured provider ([11f0775](https://github.com/royisme/pikabaka/commit/11f0775ab5f0c7f3f7640856bb7764c00a4325f3))
* **settings:** list one row per configured provider ([986d5e1](https://github.com/royisme/pikabaka/commit/986d5e1c67511fbf625de6ffcda014a967a811a8))
* **settings:** never replace a speech service that is not configured ([90a05ed](https://github.com/royisme/pikabaka/commit/90a05edaf54c94d6ecce8db93fd95fb3694bbcd3))
* **settings:** never replace a speech service that is not configured ([91e3f2b](https://github.com/royisme/pikabaka/commit/91e3f2b3eb23329dc0b060d86130bbba8c7a3799))
* **settings:** reorder the audio settings and drop the fake opacity preview ([0879f9a](https://github.com/royisme/pikabaka/commit/0879f9a0689ecc63158a1c6d5e8e5b6616b0c471))
* **settings:** replace Your Background with a Knowledge tab ([16a85bc](https://github.com/royisme/pikabaka/commit/16a85bc3b5c0ef203cc723db79aeb2af6e9cc8d8))
* **settings:** replace Your Background with a Knowledge tab ([2db26f6](https://github.com/royisme/pikabaka/commit/2db26f6ac1f6eb89297c96e4dc0668c6347aa331))
* **update:** download updates in the background and publish the feed ([3a8ad29](https://github.com/royisme/pikabaka/commit/3a8ad298d53b96b96f964922c5d156190ed7517f))
* **update:** download updates in the background and publish the feed ([452e4a0](https://github.com/royisme/pikabaka/commit/452e4a069cf8c4208b67837428ef49118cb75124))


### Bug Fixes

* **meeting:** start every meeting with an empty overlay and stop answers from crossing meetings ([051b2a7](https://github.com/royisme/pikabaka/commit/051b2a76b4687478d237c961dffa5e93b7c0772d))
* **meeting:** start every meeting with an empty overlay and stop answers from crossing meetings ([ff0c3a5](https://github.com/royisme/pikabaka/commit/ff0c3a5cee35b7bec5ca976ab211da5610c9bff4))
* **rag:** index live meetings under the recorded meeting id ([fd9ae40](https://github.com/royisme/pikabaka/commit/fd9ae400c2c7bb99ca3f826f2f7097f9899b2caa))
* **rag:** index live meetings under the recorded meeting id ([96626fc](https://github.com/royisme/pikabaka/commit/96626fc412285a0ce0231c7c69d817f9f6f18026))
* **rag:** keep embedding vectors consistent and stop the whole-meeting fallback ([b18ea25](https://github.com/royisme/pikabaka/commit/b18ea2530d1cdc86b2e4b53bb77512b1dda79d7d))
* **rag:** keep embedding vectors consistent and stop the whole-meeting fallback ([e06a757](https://github.com/royisme/pikabaka/commit/e06a7572188dc022ceebd86119e4b5f6b8bdb9a8))
* **rag:** make live meeting indexing safe to stop and restart ([30e9f3d](https://github.com/royisme/pikabaka/commit/30e9f3de5fdd21a23860055dadc1a574d083a939))
* **rag:** make live meeting indexing safe to stop and restart ([a9d9baf](https://github.com/royisme/pikabaka/commit/a9d9bafcb309c385312a7eb9c878d1a840bd2144))
* **settings:** make update errors readable and follow the design rules ([0eae301](https://github.com/royisme/pikabaka/commit/0eae3013dc847b3d5a36b2f2fa703fa79ee1dbe6))
* **settings:** stop inventing results and honour what the user typed ([894d131](https://github.com/royisme/pikabaka/commit/894d131c0bb46886bd589d5fd1c6b45fe2c768f1))
* **settings:** stop inventing results and honour what the user typed ([b4a12a3](https://github.com/royisme/pikabaka/commit/b4a12a38a34c01aea5b4f2effdebff20375e5373))


### Build & Release

* **deps:** move the app to React 19, TanStack Query 5, TypeScript 7, Vite 8, Tailwind 4 and Electron 45 ([4d540c7](https://github.com/royisme/pikabaka/commit/4d540c7084fed5eb55acbe702deb27789244a702))
* **deps:** move the app to React 19, TanStack Query 5, TypeScript 7, Vite 8, Tailwind 4 and Electron 45 ([d12ae4f](https://github.com/royisme/pikabaka/commit/d12ae4f89ba005fd72e53057e0edcefde9d00cb5))
* **lint:** fail the lint run when a code smell count rises above its ledger ([3f21698](https://github.com/royisme/pikabaka/commit/3f21698ff97f9e677414b4d73ed310e5e89fc07b))
* **lint:** fail the lint run when a code smell count rises above its ledger ([530b7ae](https://github.com/royisme/pikabaka/commit/530b7aef64f74cdd4875ee1d119108c00f4be694))
* **lint:** lower the any ledger to 470 ([c0ddc39](https://github.com/royisme/pikabaka/commit/c0ddc3971a12c25faaa6c59b627262de1b612bd5))
* stop the module.register deprecation warning in tests ([b73679c](https://github.com/royisme/pikabaka/commit/b73679c0038b7702320033dd5da16c5dc29cb9cd))
* stop the module.register deprecation warning in tests ([de0bc9d](https://github.com/royisme/pikabaka/commit/de0bc9d22ef4950ef53e51147e7f6f10b2ee1665))
* **test:** rebuild tap's plugin set before the tests so the TypeScript plugin stays off ([90aef24](https://github.com/royisme/pikabaka/commit/90aef240a6ee88008f86b63a8e2476125c15217e))
* **test:** turn the tap TypeScript plugin off on the command line ([96a4013](https://github.com/royisme/pikabaka/commit/96a4013fce5a60f1d616fdb5d77f2d1e753d8fd5))


### Refactoring

* **agent:** claim a generation once per answer run instead of at nine sites ([54747ba](https://github.com/royisme/pikabaka/commit/54747ba3be87f7765af9a2dc309a516a5ef3d933))
* **agent:** claim a generation once per answer run instead of at nine sites ([9d508b3](https://github.com/royisme/pikabaka/commit/9d508b3f62cefcddd0a9973396725723b77e3c93))
* **build:** stop renaming the helper processes at build time ([57a4256](https://github.com/royisme/pikabaka/commit/57a42564f7930412466f3297b5be1f0c3605fff4))
* **build:** stop renaming the helper processes at build time ([4804795](https://github.com/royisme/pikabaka/commit/4804795a6f02a1fcba61b93a464e2a138bb34ce4))
* **electron:** type the AppState members the audio and stealth modules reach instead of casting to any ([65429fc](https://github.com/royisme/pikabaka/commit/65429fc7aad519fb2f9b5ded37a72650d857b82e))
* **electron:** type the AppState members the audio and stealth modules reach instead of casting to any ([9c790c1](https://github.com/royisme/pikabaka/commit/9c790c196524462bd07d386368fb856d2a05e8a9))
* **interview:** remove the interview feature, the resume and the profile ([69fe349](https://github.com/royisme/pikabaka/commit/69fe349afeeb650979df3725998f14cad09c2bb5))
* **interview:** remove the interview feature, the resume and the profile ([31493be](https://github.com/royisme/pikabaka/commit/31493be122173e732597ea7164baa74cf04c9f39))
* **prompt:** one neutral role and task text for every provider ([abb7e6e](https://github.com/royisme/pikabaka/commit/abb7e6e1a32042735184e92f7469dd3dec405288))
* **prompt:** one neutral role and task text for every provider ([3fff443](https://github.com/royisme/pikabaka/commit/3fff4435ca977495ebed0129cfb95b596b8adffe))
* **settings:** give translation its own settings component and name shared model rows ([c7b96c7](https://github.com/royisme/pikabaka/commit/c7b96c79992cd8ef11a3cc4f019c662782fa3423))
* **settings:** give translation its own settings component and name shared model rows ([036aa26](https://github.com/royisme/pikabaka/commit/036aa268cb52759c4f2dfb77c726a5d1e0cad1dd))
* **settings:** list speech providers in Provider setup ([39be9b6](https://github.com/royisme/pikabaka/commit/39be9b6dd92ed6fdaf77a032257813d909862a13))
* **settings:** list speech providers in Provider setup ([ff3d8df](https://github.com/royisme/pikabaka/commit/ff3d8df6c87085e7ea22a785f93e2d1aaef7371f))
* **settings:** move answer language and style beside Quick answers ([5f9b81a](https://github.com/royisme/pikabaka/commit/5f9b81af23c031883b224f298ca2a619d4c3eadc))
* **settings:** move answer language and style beside Quick answers ([54aefe2](https://github.com/royisme/pikabaka/commit/54aefe23aedd9d15b8c9c24dd6088dd78aae0509))
* **settings:** remove the unused settings Sidebar ([a69d308](https://github.com/royisme/pikabaka/commit/a69d308993f5bbf9fa7006ff0ce54bae7bdbc341))
* **settings:** set up the proactive-help decision service in Provider setup ([38929a4](https://github.com/royisme/pikabaka/commit/38929a48a04faa6e055a1a3364f34d1c63aa8e80))
* **settings:** set up the proactive-help decision service in Provider setup ([1c71cbb](https://github.com/royisme/pikabaka/commit/1c71cbbb3ee559221af060eb5ca014b6425d4c8e))
* **stealth:** call it Hide from screen share ([658f5a1](https://github.com/royisme/pikabaka/commit/658f5a1fc50ab161d0ab0a6fb060ae0df77fa10b))
* **stealth:** call it Hide from screen share ([92f3434](https://github.com/royisme/pikabaka/commit/92f34347e8654f76726ad23289d8703398156cbc))
* **stealth:** remove the process disguise ([4be7773](https://github.com/royisme/pikabaka/commit/4be777321b91ee69a71816dccd37c798ebb78626))
* **stealth:** remove the process disguise ([8595574](https://github.com/royisme/pikabaka/commit/85955748254772c7e40810d7ac10c6c0da2d3a3a))
* **stealth:** stop hiding the dock icon and the tray ([376b5dc](https://github.com/royisme/pikabaka/commit/376b5dc734020c7bbe96521a4183a3b5f643a447))
* **stealth:** stop hiding the dock icon and the tray ([7bbc8b7](https://github.com/royisme/pikabaka/commit/7bbc8b78719da71b9927b1682f9c985dc11af538))
* **transcript:** rename the other-party speaker to them ([810fc2f](https://github.com/royisme/pikabaka/commit/810fc2f4de0b96aafaee17e8da34ed4e29f53b3a))
* **transcript:** rename the other-party speaker to them ([39225c2](https://github.com/royisme/pikabaka/commit/39225c2ca2b2aaa5a2df146771c0fca1577de39d))


### Chores

* **release:** release 3.0.0 ([90cf46a](https://github.com/royisme/pikabaka/commit/90cf46ad86d3b097b0c7e2292066fd3e0e5d25ed))

## [2.4.0](https://github.com/royisme/pikabaka/compare/v2.3.0...v2.4.0) (2026-10-27)


### Features

* **agent:** chat with the meeting agent from the overlay ([ad1974e](https://github.com/royisme/pikabaka/commit/ad1974ea3fee224b567e68854217097820c002df))
* **agent:** decide when to offer help with a classifier gate ([e187c8e](https://github.com/royisme/pikabaka/commit/e187c8e53fc6b87be5712b672a5d7d12b6580964))
* **agent:** draft a proactive card when the gate says help is wanted ([0cdf91c](https://github.com/royisme/pikabaka/commit/0cdf91c097097270e21735004d163f04e74da1af))
* **agent:** run an agent in the meeting on pi-durable ([74a96bf](https://github.com/royisme/pikabaka/commit/74a96bf534843b1358d37beabd3d3dfbd4370578))
* **agent:** run local commands in the meeting folder with approval on every call ([f5479d1](https://github.com/royisme/pikabaka/commit/f5479d1f1ca8888836df19d48f1dd0141eec3ca2))
* **agent:** say why a run failed, and test the agent model in settings ([faba1a3](https://github.com/royisme/pikabaka/commit/faba1a3e3acfa1c0ec5efa44cfd17f9b94088702))
* **ai:** answers are in the conversation language, with a translation line ([9c00154](https://github.com/royisme/pikabaka/commit/9c0015410a5a51b87768c5d76a7cff0dabf14aae))
* **ai:** choose where a model is reached, with any host, type and model id ([a7e62d6](https://github.com/royisme/pikabaka/commit/a7e62d6ee7ad360a507701a781cb254b38cd8629))
* **ai:** connections with a chosen model per job, live translation and expert answers ([4c6a6de](https://github.com/royisme/pikabaka/commit/4c6a6de2d284f8a4f19f671a3159b82d6ce4b439))
* **ai:** meeting summaries and titles use the summary model ([3b30139](https://github.com/royisme/pikabaka/commit/3b3013961e5f7cd7cd691668019133f510352fe2))
* **ai:** quick answers run on a chosen connection and model ([f0fe8b7](https://github.com/royisme/pikabaka/commit/f0fe8b712695f97b250bd74f1b4f7e53dce17155))
* **ai:** quick answers, summaries and agent model rows, no local provider ([16c13e2](https://github.com/royisme/pikabaka/commit/16c13e2542b21124cb1b88ed1beb1c9bc12e789f))
* **ai:** spoken answers in a chosen manner, built for the question (STAR for stories) ([dea7707](https://github.com/royisme/pikabaka/commit/dea7707c7338fc336d2267da05d491a68d3150b4))
* **ai:** test the quick answers and summaries models in settings ([6d77435](https://github.com/royisme/pikabaka/commit/6d774356eb71e1dde6c4dc09362d5e88b4f0385f))
* **audio:** cancel the speaker echo from the microphone before recognition ([c3352ae](https://github.com/royisme/pikabaka/commit/c3352aed0f9048cc01fb4fffc1dc735cbd63160b))
* **audio:** cancel the speaker echo from the microphone before recognition ([9fa5379](https://github.com/royisme/pikabaka/commit/9fa5379fcb46bf3c3dd336f4d11edaec679755b8)), closes [#39](https://github.com/royisme/pikabaka/issues/39)
* **audio:** mute the microphone from the overlay bar ([fbbed77](https://github.com/royisme/pikabaka/commit/fbbed77f8098ab912ad953544b361d7bb830b792))
* **audio:** test the translation model from the audio settings ([67e940d](https://github.com/royisme/pikabaka/commit/67e940d657643441a016e6d581b97765cefe5042))
* **brand:** replace the app icons with the new Pika icon ([be2af15](https://github.com/royisme/pikabaka/commit/be2af15f8a0a60369e6efcd1f7d40e0d88e5f7e0))
* **design:** derive the colour tokens from the Pika brand ([525c768](https://github.com/royisme/pikabaka/commit/525c768da8e3c0e9a2f2a1e82133aa84abc747e6))
* **knowledge:** answer as an expert when the materials have nothing, not with brackets ([9b9ba79](https://github.com/royisme/pikabaka/commit/9b9ba7945c28bc4fc375814225104022be0c1c35))
* **knowledge:** do not invent facts the user's materials lack; notes about you ([6b88e29](https://github.com/royisme/pikabaka/commit/6b88e29ca97fd38c647825a0025a8afa5f5d87e0))
* **overlay:** approve agent actions in a dock and choose the agent workspace ([4b8ba08](https://github.com/royisme/pikabaka/commit/4b8ba08b19fb5d01eb3bf192e04888c117a02f5f))
* **overlay:** change each speaker's language from the overlay ([d8c62ac](https://github.com/royisme/pikabaka/commit/d8c62acb89272896f4ec4cb9630ff8febdfacf2e))
* **overlay:** empty answer area is one line that says what will happen ([09a9396](https://github.com/royisme/pikabaka/commit/09a93962fdaf2ebd7d87f156e33d153d7e226a22))
* **overlay:** fit the composer into two rows ([ec2014b](https://github.com/royisme/pikabaka/commit/ec2014b26f560bf09e4631cd454ee8f2b29644ca))
* **overlay:** one top bar replaces the pill and both zone headers ([46a9595](https://github.com/royisme/pikabaka/commit/46a95956101352637080235ed7f7b0da5873a922)), closes [#38](https://github.com/royisme/pikabaka/issues/38)
* **overlay:** say the audio status once, and make Fix audio open the audio settings ([da57690](https://github.com/royisme/pikabaka/commit/da57690634e25efbfbdeb6cceeb154bb1a51653f)), closes [#38](https://github.com/royisme/pikabaka/issues/38)
* **overlay:** screenshot and select-area buttons in the quick-action row ([85d48d3](https://github.com/royisme/pikabaka/commit/85d48d353f2c4142fc2857e7d92579872be22fd3))
* **overlay:** show a proactive card and let the user ask more ([bdc1267](https://github.com/royisme/pikabaka/commit/bdc126770b28f335ea8c52efe79398ce309cd1f1))
* **overlay:** show what a what-to-say answer replies to, and lead with the sentence to say ([5f77257](https://github.com/royisme/pikabaka/commit/5f77257b11f2f11011d6c7f00a09a41458b0e29b)), closes [#25](https://github.com/royisme/pikabaka/issues/25)
* **overlay:** stop an answer being generated, and retry the last request ([03b7017](https://github.com/royisme/pikabaka/commit/03b7017ac5cf96b7506664a5f8c7bb0a82175882)), closes [#27](https://github.com/royisme/pikabaka/issues/27)
* **overlay:** the composer is two rows ([be01e8f](https://github.com/royisme/pikabaka/commit/be01e8f8db4cf85e728fc429482d8504ee73fc98))
* **overlay:** the primary action follows what the user needs to do ([f2751df](https://github.com/royisme/pikabaka/commit/f2751dfb99092ec243b23a1d6d1978f53311d532)), closes [#38](https://github.com/royisme/pikabaka/issues/38)
* **rag:** choose the embedding model and rebuild the index ([60590a5](https://github.com/royisme/pikabaka/commit/60590a5de228c6e89e773aea86827b43a31a3ca4))
* **record:** create the meeting at start and save each assembled line ([c75f1b7](https://github.com/royisme/pikabaka/commit/c75f1b79073bfe2c7ca66ff362c3443e1d44693d))
* **record:** write meetings and segments as they happen ([bdfb7d5](https://github.com/royisme/pikabaka/commit/bdfb7d520d146fe2a55a1ae8ac576c53ed17e4f9))
* **settings:** configure proactive help and read its decision log ([222ad0c](https://github.com/royisme/pikabaka/commit/222ad0c734150b4598da00960dfa489e3ccc0b0f))
* **settings:** one Connections list and a model per job ([bec76c9](https://github.com/royisme/pikabaka/commit/bec76c9c6bb154b4e80d08f2d7d93ebc8c2e95c6))
* **settings:** speech and translation settings stay in Audio, with Save and model lists ([16afe23](https://github.com/royisme/pikabaka/commit/16afe23e970a98503f94e2b9bb19b71ee20b4d2c))
* **stt:** keep one recognition language per speaker ([13ea404](https://github.com/royisme/pikabaka/commit/13ea404706fd77839c57f9fde8d9471cc9943389))
* **transcript:** announce finished translations once and make the list keyboard-reachable ([07f7dc9](https://github.com/royisme/pikabaka/commit/07f7dc9bec094e5c122d5ea53a05e53482730206)), closes [#38](https://github.com/royisme/pikabaka/issues/38)
* **transcript:** put translation controls and the status dot in the zone header ([c349dbe](https://github.com/royisme/pikabaka/commit/c349dbed8fa2aee3a5872ce1e3482ebd59c7a6ee)), closes [#38](https://github.com/royisme/pikabaka/issues/38)
* **transcript:** reserve a line for the translation and show its state ([5389e65](https://github.com/royisme/pikabaka/commit/5389e65382dff3634be98254249b7d023c3ea5bc)), closes [#38](https://github.com/royisme/pikabaka/issues/38)
* **transcript:** show the translation first and honour the display mode ([d98a8ec](https://github.com/royisme/pikabaka/commit/d98a8ec8affa286f3beb8eade2ea23928c4858d8)), closes [#36](https://github.com/royisme/pikabaka/issues/36)
* **translation:** add an entity masker for technical terms ([db61e77](https://github.com/royisme/pikabaka/commit/db61e773185024839918a0c4a652ff3eee7546e2)), closes [#32](https://github.com/royisme/pikabaka/issues/32)
* **translation:** add global shortcuts to toggle translation and the original text ([70d5a38](https://github.com/royisme/pikabaka/commit/70d5a38f96fdb1ce6d3783f2075a255ceea4c080)), closes [#38](https://github.com/royisme/pikabaka/issues/38)
* **translation:** say why a translation failed ([4dc6f66](https://github.com/royisme/pikabaka/commit/4dc6f66fb39be49ff927ece89a983aded5fe8955)), closes [#38](https://github.com/royisme/pikabaka/issues/38)
* **translation:** source above translation, and a paragraph pass every minute ([37cb398](https://github.com/royisme/pikabaka/commit/37cb398fa0bd4f1f357b11d3282d30b2783d971c))
* **translation:** start the translation when the speech provider says the utterance ended ([75035c5](https://github.com/royisme/pikabaka/commit/75035c5076edcc51ab7a9595be39ed95021ceb67)), closes [#33](https://github.com/royisme/pikabaka/issues/33)
* **translation:** stream the translation into the row and log how long it takes ([e8b5731](https://github.com/royisme/pikabaka/commit/e8b57319aa637a5237220582dee0e7479eeac829)), closes [#29](https://github.com/royisme/pikabaka/issues/29) [#30](https://github.com/royisme/pikabaka/issues/30)


### Bug Fixes

* **agent:** follow the provider of the chosen model, not one exact model id ([fe51788](https://github.com/royisme/pikabaka/commit/fe51788568e7510d6172c531ae877ec8116d4f92))
* **ai:** show the real error instead of a made-up answer; test the decision model ([2376a09](https://github.com/royisme/pikabaka/commit/2376a099ad9ac99d74059c81f03bc163f68e4195))
* **audio:** stop halving the system audio on macOS ([bcd9f3a](https://github.com/royisme/pikabaka/commit/bcd9f3ae30d006fdb72d0aebdbeee4402a0d7c9d))
* **build:** decline the no-op install script of @google/genai 2.21.0 ([adfe2da](https://github.com/royisme/pikabaka/commit/adfe2da19f4e454391ab1f391125a33d6fee7b74))
* **llm:** load the intent model from the repository in development; drop a per-chunk microphone log ([e1274e1](https://github.com/royisme/pikabaka/commit/e1274e1f951845c0d3250aa6bb953bc76af5e3a5))
* **overlay:** enforce the legibility floor ([33e6ea2](https://github.com/royisme/pikabaka/commit/33e6ea22ad53be0a7ba17952c56a4188b79c15b9))
* **overlay:** fix the bugs an independent review found in the rebuilt logic ([bc732a2](https://github.com/royisme/pikabaka/commit/bc732a26731b174b74ef68c20a0a9f8fcdc78928))
* **overlay:** fix what an independent UI review found against the acceptance bar ([a297dc2](https://github.com/royisme/pikabaka/commit/a297dc29fdd9af332c9234cbd72860c8b3e409b4))
* **overlay:** hairlines use the border token ([a27be64](https://github.com/royisme/pikabaka/commit/a27be64d6b0a5cacddd332d4161785f6aac524cb))
* **overlay:** keep an answer's own layout when it contains code ([7265b4a](https://github.com/royisme/pikabaka/commit/7265b4abdea84efbbbbc30d131c3024b23061a19)), closes [#25](https://github.com/royisme/pikabaka/issues/25)
* **overlay:** keep every step of an agent run in the chat ([f64c2aa](https://github.com/royisme/pikabaka/commit/f64c2aa1acfb984498dea66a7c0c5ecdcdf95ffc))
* **overlay:** keep the start of a streaming answer in view ([a7f6ad2](https://github.com/royisme/pikabaka/commit/a7f6ad24729bcee5278dce5b72855713147658db)), closes [#20](https://github.com/royisme/pikabaka/issues/20)
* **overlay:** one primary action and no dead recording UI ([8421616](https://github.com/royisme/pikabaka/commit/8421616c4af048e03b251393d06e643fe3663334)), closes [#23](https://github.com/royisme/pikabaka/issues/23)
* **overlay:** open tall enough for an answer and make the splitter usable ([ce58f83](https://github.com/royisme/pikabaka/commit/ce58f83faf64bd8af36c3de7cd2321d6568ebe2e)), closes [#22](https://github.com/royisme/pikabaka/issues/22) [#26](https://github.com/royisme/pikabaka/issues/26)
* **overlay:** stop quick actions from posting a fake user message ([71ddc25](https://github.com/royisme/pikabaka/commit/71ddc25eb554a6fafb7aa249a7c590fc62a67d9f)), closes [#21](https://github.com/royisme/pikabaka/issues/21)
* **overlay:** the answer zone never clips its own controls ([93414cd](https://github.com/royisme/pikabaka/commit/93414cd05ab7201439afab41e33540fd83094bed))
* **overlay:** the suggestion card no longer covers the chat; tell the model when the record had nothing ([67c565d](https://github.com/royisme/pikabaka/commit/67c565dc30ed43b39ce842d8b329bf2da362511a))
* **overlay:** the translation area gets its own ground; compact layout from 560px ([afe5bc7](https://github.com/royisme/pikabaka/commit/afe5bc7cc96f5734b9ab95dd7b8d2fd670103c7a))
* **overlay:** the translation area gets its own ground; compact layout from 560px ([664901a](https://github.com/royisme/pikabaka/commit/664901aae3498b69c1d726d9bb89b3cb04b63d68))
* **overlay:** use the action token and make key badges readable on it ([40f3e85](https://github.com/royisme/pikabaka/commit/40f3e85f342688ea679bab39d27049760f8cffec)), closes [#38](https://github.com/royisme/pikabaka/issues/38)
* **overlay:** visible copy, real input placeholder, error styling and a safer Stop ([345f77c](https://github.com/royisme/pikabaka/commit/345f77c8317be4211e40f581adaf5955b2c16ae2)), closes [#27](https://github.com/royisme/pikabaka/issues/27)
* **react:** fire the calendar check and interview prep once ([fcb5679](https://github.com/royisme/pikabaka/commit/fcb5679dd5b6d0d4d147ab4dfb483e984ada425d))
* **record:** complete meetings in place instead of re-saving them ([4985a9b](https://github.com/royisme/pikabaka/commit/4985a9bd8387d28cc7bd4b52fec8b810db9acbf5))
* **record:** keep the session id null when the meeting row fails ([a603056](https://github.com/royisme/pikabaka/commit/a6030569a111af654311170677b068fa7bacf134))
* settings Groq toggle, dead vec0 migrations and the macOS runtime icon ([8477a17](https://github.com/royisme/pikabaka/commit/8477a170817f6c6dbc49c4e62db8271cdea6e1c1))
* **settings:** keep the model list inside the window ([be05602](https://github.com/royisme/pikabaka/commit/be05602ced0ae54b05fd2093e916686968816f6c))
* **stt:** drop microphone lines that repeat the other party's audio ([afad4ea](https://github.com/royisme/pikabaka/commit/afad4ea5409461a661e4badcd9d5191794efbd57))
* **stt:** ignore a replaced Deepgram socket after a restart ([adcd77b](https://github.com/royisme/pikabaka/commit/adcd77b1cabb910ccac1c40dba67a1c0ea4ae2c9))
* **summary:** summarize the whole recorded transcript in parts ([22cb76a](https://github.com/royisme/pikabaka/commit/22cb76a8483fe5ff674a80c303709dba01e7aff4))
* **transcript:** keep the newest line in view without nested scrolling ([8c7244a](https://github.com/royisme/pikabaka/commit/8c7244a659ebd89e5eb36a472a52f0559b127465)), closes [#38](https://github.com/royisme/pikabaka/issues/38)
* **transcript:** never show an old translation as current after a turn is reopened ([5fdc557](https://github.com/royisme/pikabaka/commit/5fdc557aa0938246f4094cac49930d8062bdf790)), closes [#37](https://github.com/royisme/pikabaka/issues/37)
* **translation:** a reopened turn supersedes its old revision at once ([a210314](https://github.com/royisme/pikabaka/commit/a210314c72c896defc04b966c0f34c9b561d9320))
* **translation:** drop the thinking setting for a model that answers 400 ([4351f31](https://github.com/royisme/pikabaka/commit/4351f31b0820f39959139ced8e6ec46f9bb202a5))
* **translation:** rows end at sentence ends, and a turn is not cut while the speaker talks ([137f0d3](https://github.com/royisme/pikabaka/commit/137f0d35e960fe8d2fac43980f888082b2e305d0))
* **translation:** stop Gemini from thinking before it translates ([c9ce306](https://github.com/royisme/pikabaka/commit/c9ce3067dae4e0da2b692ce4146ee6f1d9beb8a3))
* **translation:** try MINIMAL then LOW thinking on Gemini 3 and newer ([042135f](https://github.com/royisme/pikabaka/commit/042135f0e9e69c653715e85b9452da921d8bb120))
* **ui:** give the light theme a full palette so text and surface never mix themes ([e5ce624](https://github.com/royisme/pikabaka/commit/e5ce6246dc128931476b29f7b606e3aac1b17b74))


### Build & Release

* **agent:** add pi-durable, pi-ai, chord and typebox, and use nodenext for the main process ([71716a0](https://github.com/royisme/pikabaka/commit/71716a0f8ed833c2f8481a82542a192828e7b4d2))
* **deps:** upgrade Electron to 44 and better-sqlite3 to 13 ([7e380d4](https://github.com/royisme/pikabaka/commit/7e380d42947a304f39b529f27f030117be954947))


### Refactoring

* **ai:** answers, suggestions, screenshots and RAG use the chosen model ([a308077](https://github.com/royisme/pikabaka/commit/a308077dd7ebf5583e7fc9976952301824304818))
* **ai:** remove fast response mode and cURL providers ([1be3d57](https://github.com/royisme/pikabaka/commit/1be3d57fe3df99fb81432d3c0376c954fc7a6914))
* **ai:** remove the old provider clients and routing ([5961b1d](https://github.com/royisme/pikabaka/commit/5961b1d3aa1b7a2293b506302239de30b767d65d))
* **ai:** remove the Ollama connection type and the default-model plumbing ([7f07eb3](https://github.com/royisme/pikabaka/commit/7f07eb308a4437f65d80ccc0e5e90fe60b91b53a))
* **app:** remove the calendar feature ([9a1241a](https://github.com/royisme/pikabaka/commit/9a1241a611b7081dcd487a174ceb74ada223b3d9))
* **react:** hooks without needless effects ([f454cac](https://github.com/royisme/pikabaka/commit/f454cacca97e93b782c664b5496eccfc860811e7))
* **react:** knowledge and model selector without needless effects ([59914b6](https://github.com/royisme/pikabaka/commit/59914b6308313e9a7bb9f64d6451fae9f8c4fb9f))
* **react:** launcher and overlays without needless effects ([f5c9869](https://github.com/royisme/pikabaka/commit/f5c98692264f36c40b1e918bbe25dd9432a054d7))
* **react:** leaf and overlay components without needless effects ([7f33ac0](https://github.com/royisme/pikabaka/commit/7f33ac0a8e031fa0f856cfe6a06ecca9624c0eb7))
* **react:** meeting chat without needless effects ([21b9a4a](https://github.com/royisme/pikabaka/commit/21b9a4ac84c1b4a19ecdec3735021bba57f571e5))
* **react:** overlay without needless effects ([1d289e4](https://github.com/royisme/pikabaka/commit/1d289e46698d80e78bf13210779bf9f0584c15e4))
* **react:** settings overlay without needless effects ([d263a07](https://github.com/royisme/pikabaka/commit/d263a072c84236df4034d6f7d24ceb9587189ad7))
* **react:** settings without needless effects ([a554342](https://github.com/royisme/pikabaka/commit/a554342800e2dc3018285ad867c448bd92a36849))
* remove the follow-up email feature ([e359185](https://github.com/royisme/pikabaka/commit/e359185acc70921e2b1af83d9c31c990a7fe35c8))
* remove the follow-up email feature ([4d4d925](https://github.com/royisme/pikabaka/commit/4d4d92590134fad3a8e6fb721effc05bbb5f3b2c))
* **settings:** read settings with queries instead of effects ([b239643](https://github.com/royisme/pikabaka/commit/b239643756edd085a70fefbdfb2cecbe6f0a22cf))

## [2.3.0](https://github.com/royisme/pikabaka/compare/v2.2.0...v2.3.0) (2026-07-14)


### Features

* **transcript:** second-pass correction - reopen & merge flushed turns ([#17](https://github.com/royisme/pikabaka/issues/17)) ([7b48e22](https://github.com/royisme/pikabaka/commit/7b48e221bdc6fe7aa4b60cf6b94eea0fb97dbb21))

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
