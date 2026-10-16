# macOS desktop host

The native AppKit host displays the shared React interface in a transparent, floating 180 × 240 point `NSPanel`. It joins all Spaces and fullscreen desktops. The menu bar button opens Codex, toggles the panel, refreshes the local status, or quits. Drag the companion to reposition it; its position is saved by macOS. Saved positions from earlier versions keep the current compact window size.

```sh
npm run build
node scripts/build-desktop.mjs
open "outputs/Codex Recharge.app"
```

The application is built for the current Mac's architecture and requires macOS 13 or later, Xcode Command Line Tools for compilation, and an existing Node.js installation at runtime. It discovers Node from the environment, `/opt/homebrew/bin/node`, `/usr/local/bin/node`, or a manually bundled `Contents/Resources/runtime/node`. The build does not install packages or change global settings.

The builder bundles the same `src/main.tsx` React entry into a classic IIFE for the native WebKit view. This keeps normal file-origin security enabled while avoiding ES-module requests from a `file://` page. The browser preview keeps its normal Vite module build.

The native host maintains one telemetry CLI process, which refreshes every 30 seconds and publishes its JSON to the view. It restarts the process after a failure; the menu's refresh command also restarts it. Any telemetry cache stays in the user's temporary directory. The host only accepts the three actions documented below and opens the installed application with bundle identifier `com.openai.codex` (falling back to `codex://`).

## Frontend bridge

`window.codexDesktop === true` identifies the native host. Send commands through:

```js
window.webkit.messageHandlers.codex.postMessage({action: 'openCodex'});
window.webkit.messageHandlers.codex.postMessage({action: 'getStatus'});
// Start this on pointerdown; the native host tracks the pointer until mouseup.
window.webkit.messageHandlers.codex.postMessage({action: 'drag', phase: 'start'});
```

Listen for `window.addEventListener('codex-status', event => ...)`. `event.detail` holds the telemetry result. The last result is also available through `window.__codexInitialStatus`.

## Native smoke test

After building, the following launches the bundle executable, waits up to 20 seconds for the first status, verifies the WebKit bridge and rendered React view, captures the actual web view, and exits. It does not open Codex:

```sh
"outputs/Codex Recharge.app/Contents/MacOS/CodexRecharge" \
  --self-test --require-live-status --screenshot "outputs/desktop-preview.png"
```

`--require-live-status` additionally requires both usage and task states to be live and verifies their values are bound to the rendered companion's accessible label. Omit that flag to test the UI and bridge when Codex is signed out or offline. Test diagnostics contain only booleans, state labels, and dimensions; the self-test stops telemetry before it exits.

The bundle is ad hoc signed for local use. Copying it to another Mac may require a locally built version or normal macOS approval for unsigned distribution; no developer signing certificate or notarization is included.
