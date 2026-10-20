Prebuilt tree-sitter grammars (WebAssembly), copied from the npm package `tree-sitter-wasms` 0.1.13 (public domain, see LICENSE) for the nine languages Bazinga uses.

Why a copy and not the dependency: that package lists itself as its own dependency, and electron-builder's module scan loops on such a cycle until it runs out of memory (`npm run dist:win` crashed with "heap out of memory"). A copy also saves 35 MB of grammars nobody uses.

To update: install `tree-sitter-wasms` somewhere else (`npm i --prefix /tmp/x tree-sitter-wasms`), copy the .wasm files for these languages from its `out/` folder, and update the version above. Grammar and `web-tree-sitter` versions must stay compatible (see the smoke test and `test/treesitter.test.js`).
