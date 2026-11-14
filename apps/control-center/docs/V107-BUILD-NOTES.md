# V107 build repair notes · 2026-11-14

These are build/test corrections, not changes to the operator interaction model. See `BCC-DESIGN-V107-HANDOVER.md` for design decisions and hardware acceptance limits.

## Native content acceptance
The test still recognized the former permission-dialog wording, so its dialog stub cancelled the real, renamed grant prompt. The test now approves only the exact reviewed grant message, checks Cancel as the default, verifies exactly one prompt, and verifies that granting permissions makes no OBS writes. Unknown prompts fail explicitly. Production permission handling is unchanged.

## Hosted macOS runner
GitHub retired macOS 14 runners on 2026-11-02. The workflow now pins supported `macos-15`, retaining all source/native validation and mounted-DMG gates.
Source: https://github.com/actions/runner-images/issues/13518

## Universal native dependencies
`@julusian/freetype2`, a dependency of the ATEM library, ships both Darwin CPU prebuilds in every installation. They are identical between the two application staging trees because each path already identifies its CPU. Attempting to lipo-merge these same-CPU files fails.

The electron-builder 26 `mac.x64ArchFiles` exception is scoped only to the two known `freetype2-darwin-{arm64,x64}/node-napi-v7.node` paths. Despite its historical name, this option preserves matching identical Mach-O resources without merging them. No broad `**/*.node` merge exemption, dependency removal, ASAR disabling, or single-architecture fallback is used. Regression tests verify positive and negative glob matches. The mounted-DMG test also checks the actual packaged FreeType binaries with `lipo` for arm64 and x86_64 before launching the app.
Source: https://www.electron.build/v26/docs/architecture/

The next packaging run exposed an upstream ASAR merge limitation: automatic unpacking of the native package creates an expanded file-list glob longer than minimatch accepts. ASAR stays enabled, but `smartUnpack` is false and explicit `asarUnpack` rules extract only native `.node` and `.dylib` files. JavaScript, headers and source remain in the archive. This is distinct from the narrow same-CPU merge exception above; normal architecture merging and integrity checks remain enabled. Regression tests prevent accidentally unpacking all sources again.
Source: https://www.electron.build/v26/docs/contents/

## Mounted application navigation
The packaged-app test now opens YouTube management through the visible V107 tools-menu action rather than the removed legacy `nav-youtube` button. It checks visibility before clicking and continues to exercise both accounts and the eight-date, sixteen-event local preview without creating any broadcasts.

## Release gate
A downloadable artifact is published only after typechecking, regression tests, real Electron desk/content acceptance on Linux and macOS, universal packaging, disk-image verification, architecture checks, and launching/exercising the app from the mounted DMG succeed. Tests use isolated profiles and synthetic devices; they do not create real YouTube broadcasts or command production equipment. A passing build does not constitute Apple Developer ID signing/notarization or real-equipment acceptance.
