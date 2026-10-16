# macOS desktop host

The native AppKit host displays the shared React interface in a transparent, floating `NSPanel`. The companion canvas stays 180 × 135 points; its window starts at 180 × 240 points and grows vertically when the task tooltip needs more space. It joins all Spaces and fullscreen desktops. The menu bar button opens Codex, toggles the panel, refreshes the local status, or quits.

Drag the companion to reposition it. The task tooltip opens above a companion near the bottom of the screen and below one near the top, choosing the side with more available space when both fit. The host uses the companion's actual display and its usable bounds, including the Dock and menu bar. Tooltip direction changes preserve the companion's screen position, including during a drag and across displays. Only the canvas is constrained to the usable bounds; the transparent window area may extend beyond them. Position persistence stores the canvas anchor independently of tooltip direction and upgrades previous saved window positions without moving the visible companion.

The `CompanionWebView` accepts the first mouse event while its floating panel is inactive, so the initial press reaches the React interaction handler. The frontend captures the primary pointer on press and remembers whether it ever moves at least 5 screen points from the press location. A drag does not open Codex, including when the pointer returns to its starting position before release. Cancellation and lost pointer capture end the gesture. These describe the implementation; the bridge self-tests below do not verify a physical first click or drag end to end.

Right-click the companion to show a native context menu with **关闭摆件** (Close companion). Choosing it terminates the host and its telemetry helper. The shared frontend suppresses the default WebKit menu only in desktop mode and sends the click location through the `contextMenu` bridge action.

Tooltip visibility uses the actual native screen pointer. Entering the visible rounded card shows it immediately; leaving that card hides it, including when another application is active. The transparent canvas margins, rounded corners outside the card, and tooltip itself do not keep it open. Mouse-only local/global event monitors update the state on movement, with a 30 Hz fallback for missed WebKit exit events. This requires no keyboard monitoring, Accessibility permission, or changes to global settings. The frontend's desktop visibility rule uses the native boolean rather than WebKit's potentially stale `:hover` or focus state.

```sh
npm run build
node scripts/build-desktop.mjs
open "outputs/Codex Recharge.app"
```

The application is built for the current Mac's architecture and requires macOS 13 or later, Xcode Command Line Tools for compilation, and an existing Node.js installation at runtime. It discovers Node from the environment, `/opt/homebrew/bin/node`, `/usr/local/bin/node`, or a manually bundled `Contents/Resources/runtime/node`. The build does not install packages or change global settings.

The builder bundles the same `src/main.tsx` React entry into a classic IIFE for the native WebKit view. This keeps normal file-origin security enabled while avoiding ES-module requests from a `file://` page. The browser preview keeps its normal Vite module build.

The native host maintains one telemetry CLI process with `--watch --interval 30000 --task-interval 1000`. Independent loops refresh task counts approximately every second and quota every 30 seconds, publishing a combined JSON snapshot after each read. A pending quota request does not block task updates. The host restarts the process after a failure; the menu's refresh command also restarts it. Any telemetry cache stays in the user's temporary directory. The host only accepts the actions documented below and opens the installed application with bundle identifier `com.openai.codex` (falling back to `codex://`).

## Frontend bridge

`window.codexDesktop === true` identifies the native host. Send commands through:

```js
window.webkit.messageHandlers.codex.postMessage({action: 'openCodex'});
window.webkit.messageHandlers.codex.postMessage({action: 'getStatus'});
window.webkit.messageHandlers.codex.postMessage({action: 'getLayout'});
window.webkit.messageHandlers.codex.postMessage({action: 'getHover'});
// Visible card bounds, measured relative to the companion canvas's top-left.
window.webkit.messageHandlers.codex.postMessage({
  action: 'setHoverRegion', x: 15, y: 28.75, width: 150, height: 82.5, radius: 31.75,
});
// Report actual tooltip height after content changes; native clamps this to 40–400 points.
window.webkit.messageHandlers.codex.postMessage({action: 'setTooltipHeight', height: 112});
// Start this on pointerdown; the native host tracks the pointer until mouseup.
window.webkit.messageHandlers.codex.postMessage({action: 'drag', phase: 'start'});
```

Listen for `window.addEventListener('codex-status', event => ...)`. `event.detail` holds the telemetry result. The last result is also available through `window.__codexInitialStatus`.

The host injects `window.__codexTooltipPlacement` (`above` or `below`) and `window.__codexDesktopHeight` before the frontend loads. Listen for `codex-layout`, whose `event.detail` contains `{placement, panelHeight}`, and request the current layout with `getLayout` on mount. The frontend applies `.desktop[data-placement]` and matches the reported panel height. Native updates arrive after load, during a drag, after a display configuration change, and when the measured tooltip height changes.

`window.__codexNativeHovered` holds the latest native hover boolean. Listen for `codex-hover`, whose detail is `{hovered: boolean}`; the host publishes changes and responds to `getHover` with the current pointer state. The React desktop root applies `.desktop[data-hovered]` from this value. `setHoverRegion` accepts finite numeric coordinates, intersects its rectangle with the 180 × 135 canvas, and clamps its radius to half the shortest edge. The native hit test converts this top-left rectangle through the canvas anchor into screen coordinates, independently of tooltip placement. A hidden panel always publishes false. Changing application focus alone does not hide the tooltip while the pointer is actually inside the card.

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

To regress native hover hit testing and its actual WebKit/React visibility bridge on every attached display, run:

```sh
"outputs/Codex Recharge.app/Contents/MacOS/CodexRecharge" \
  --self-test --require-live-status --placement-test --hover-test
```

`--hover-test` injects diagnostic native screen coordinates into the production hit test without moving or synthesizing the operating-system pointer. For both tooltip directions, it checks the card center and edges, all four outside edges, a rounded corner, a canvas margin, and the tooltip reserve. Each check verifies native state, the React `data-hovered` attribute, and actual tooltip opacity. It also focuses the companion to ensure keyboard focus cannot retain the tooltip after leaving. These are bridge and geometry tests; verifying real mouse movement without a click requires a separate manual or browser-control check against the running desktop window.

The bundle is ad hoc signed for local use. Copying it to another Mac may require a locally built version or normal macOS approval for unsigned distribution; no developer signing certificate or notarization is included.

For an interactive single-click check, launch with `--interaction-test --interaction-log work/interaction-click.json` and click the companion once. This opt-in diagnostic writes only booleans and counters: one click should produce one bridge request, one successful workspace open, and `codexFrontmost: true` after 0.4 seconds. It does not save test position changes. `firstMouseWhileInactive` records whether the inactive first-mouse path was actually exercised; automation that activates a window before clicking cannot establish that check. Relaunch without these flags for normal use.
