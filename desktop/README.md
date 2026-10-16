# macOS desktop host

The native AppKit host displays the shared React interface in a transparent, floating `NSPanel`. The companion canvas stays 180 × 135 points; its window starts at 180 × 240 points and grows vertically when the task tooltip needs more space. It joins all Spaces and fullscreen desktops. The menu bar button opens Codex, toggles the panel, refreshes the local status, or quits.

Drag the companion to reposition it. The task tooltip opens above a companion near the bottom of the screen and below one near the top, choosing the side with more available space when both fit. The host uses the companion's actual display and its usable bounds, including the Dock and menu bar. Tooltip direction changes preserve the companion's screen position, including during a drag and across displays. Only the canvas is constrained to the usable bounds; the transparent window area may extend beyond them. Position persistence stores the canvas anchor independently of tooltip direction and upgrades previous saved window positions without moving the visible companion.

```sh
npm run build
node scripts/build-desktop.mjs
open "outputs/Codex Recharge.app"
```

The application is built for the current Mac's architecture and requires macOS 13 or later, Xcode Command Line Tools for compilation, and an existing Node.js installation at runtime. It discovers Node from the environment, `/opt/homebrew/bin/node`, `/usr/local/bin/node`, or a manually bundled `Contents/Resources/runtime/node`. The build does not install packages or change global settings.

The builder bundles the same `src/main.tsx` React entry into a classic IIFE for the native WebKit view. This keeps normal file-origin security enabled while avoiding ES-module requests from a `file://` page. The browser preview keeps its normal Vite module build.

The native host maintains one telemetry CLI process, which refreshes every 30 seconds and publishes its JSON to the view. It restarts the process after a failure; the menu's refresh command also restarts it. Any telemetry cache stays in the user's temporary directory. The host only accepts the actions documented below and opens the installed application with bundle identifier `com.openai.codex` (falling back to `codex://`).

## Frontend bridge

`window.codexDesktop === true` identifies the native host. Send commands through:

```js
window.webkit.messageHandlers.codex.postMessage({action: 'openCodex'});
window.webkit.messageHandlers.codex.postMessage({action: 'getStatus'});
window.webkit.messageHandlers.codex.postMessage({action: 'getLayout'});
// Report actual tooltip height after content changes; native clamps this to 40–400 points.
window.webkit.messageHandlers.codex.postMessage({action: 'setTooltipHeight', height: 112});
// Start this on pointerdown; the native host tracks the pointer until mouseup.
window.webkit.messageHandlers.codex.postMessage({action: 'drag', phase: 'start'});
```

Listen for `window.addEventListener('codex-status', event => ...)`. `event.detail` holds the telemetry result. The last result is also available through `window.__codexInitialStatus`.

The host injects `window.__codexTooltipPlacement` (`above` or `below`) and `window.__codexDesktopHeight` before the frontend loads. Listen for `codex-layout`, whose `event.detail` contains `{placement, panelHeight}`, and request the current layout with `getLayout` on mount. The frontend applies `.desktop[data-placement]` and matches the reported panel height. Native updates arrive after load, during a drag, after a display configuration change, and when the measured tooltip height changes.

The companion canvas is positioned 8 points from the window's top for `below`, or 8 points from its bottom for `above`. The native anchor is the canvas's screen-space bottom-left corner, so changing direction adjusts the window's origin while keeping that corner stationary. The frontend measures the tooltip with `ResizeObserver` and sends `setTooltipHeight`; the window height is `max(240, 135 + 8 + ceil(tooltipHeight) + 8)`.

## Native smoke test

After building, the following launches the bundle executable, waits up to 20 seconds for the first status, verifies the WebKit bridge and rendered React view, captures the actual web view, and exits. It does not open Codex:

```sh
"outputs/Codex Recharge.app/Contents/MacOS/CodexRecharge" \
  --self-test --require-live-status --screenshot "outputs/desktop-preview.png"
```

`--require-live-status` additionally requires both usage and task states to be live and verifies their values are bound to the rendered companion's accessible label. Omit that flag to test the UI and bridge when Codex is signed out or offline. Test diagnostics contain only booleans, state labels, and dimensions; the self-test stops telemetry before it exits.

To exercise native placement on every attached display, including actual DOM bounds and companion position stability across direction changes, run:

```sh
"outputs/Codex Recharge.app/Contents/MacOS/CodexRecharge" \
  --self-test --placement-test --test-placement above --screenshot "outputs/hover-above.png"
"outputs/Codex Recharge.app/Contents/MacOS/CodexRecharge" \
  --self-test --placement-test --test-placement below --screenshot "outputs/hover-below.png"
```

`--placement-test` places the companion near each display's top and bottom in turn, verifies the selected direction, confirms the tooltip remains inside the WebKit viewport, and checks that the companion's global DOM coordinates remain unchanged when the tooltip flips. `--test-placement` selects the final capture near the corresponding screen edge and makes the tooltip visible for the snapshot. Tests do not write saved positions; they restore the original anchor after the placement checks. Diagnostic output for these checks contains only booleans.

The bundle is ad hoc signed for local use. Copying it to another Mac may require a locally built version or normal macOS approval for unsigned distribution; no developer signing certificate or notarization is included.
