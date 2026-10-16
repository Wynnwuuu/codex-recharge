#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import {cp, mkdir, readFile, rename, rm, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
if (args.includes('--help')) {
  console.log('Usage: node scripts/build-desktop.mjs [--output /path/to/Codex Recharge.app]');
  console.log('Build the frontend with npm run build first. Requires macOS and Xcode Command Line Tools.');
  process.exit(0);
}
if (process.platform !== 'darwin') throw new Error('The desktop companion requires macOS.');
if (outputIndex !== -1 && !args[outputIndex + 1]) throw new Error('--output requires a destination.');
const destination = outputIndex === -1
  ? path.join(root, 'outputs', 'Codex Recharge.app')
  : path.resolve(args[outputIndex + 1]);
if (!destination.endsWith('.app') || destination === '/' || destination === root) {
  throw new Error('The output path must be a dedicated .app bundle.');
}
for (const required of ['dist/index.html', 'telemetry/cli.mjs', 'desktop/main.swift']) {
  try { await stat(path.join(root, required)); }
  catch { throw new Error(`Missing ${required}. Build the frontend before building the desktop app.`); }
}
const appName = 'Codex Recharge';
const executableName = 'CodexRecharge';
const stagingRoot = path.join(root, 'work', 'desktop-build');
const bundle = path.join(stagingRoot, 'Codex Recharge.app');
const contents = path.join(bundle, 'Contents');
const resources = path.join(contents, 'Resources');
const cache = path.join(root, 'work', 'swift-cache');
await mkdir(cache, {recursive: true});
// Compile in work first, so a failed build keeps the previous working output intact.
await rm(stagingRoot, {recursive: true, force: true});
await mkdir(path.join(contents, 'MacOS'), {recursive: true});
await mkdir(resources, {recursive: true});
// WKWebView intentionally keeps normal file-origin security. Bundle the exact same
// React entry as one classic IIFE so it needs no file:// ES-module fetches.
const {build} = await import('vite');
const webRoot = path.join(resources, 'web');
await build({
  configFile: false,
  root,
  base: './',
  define: {'process.env.NODE_ENV': JSON.stringify('production')},
  build: {
    outDir: webRoot,
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: path.join(root, 'src', 'main.tsx'),
      name: 'CodexRechargeView',
      formats: ['iife'],
      fileName: () => 'companion.js',
      cssFileName: 'companion',
    },
    rolldownOptions: {output: {inlineDynamicImports: true}},
  },
});
await writeFile(path.join(webRoot, 'index.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Codex Recharge</title><link rel="stylesheet" href="./companion.css"></head><body><div id="root"></div><script src="./companion.js"></script></body></html>');
await cp(path.join(root, 'telemetry'), path.join(resources, 'telemetry'), {
  recursive: true,
  filter: (source) => !source.includes(`${path.sep}node_modules${path.sep}`) && !source.endsWith('.test.mjs'),
});
let version = '1.0.0';
try { version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version ?? version; } catch {}
const escapeXML = (value) => String(value).replace(/[<>&"']/g, (ch) => ({'<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;', "'":'&apos;'}[ch]));
await writeFile(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>${appName}</string>
<key>CFBundleDisplayName</key><string>${appName}</string>
<key>CFBundleIdentifier</key><string>cc.motionface.codex-recharge</string>
<key>CFBundleExecutable</key><string>${executableName}</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${escapeXML(version)}</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>LSUIElement</key><true/>
<key>NSHighResolutionCapable</key><true/>
<key>NSPrincipalClass</key><string>NSApplication</string>
</dict></plist>
`);
execFileSync('/usr/bin/xcrun', ['swiftc', '-swift-version', '5', '-O',
  '-module-cache-path', cache,
  '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx13.0`,
  '-framework', 'AppKit', '-framework', 'WebKit',
  path.join(root, 'desktop', 'main.swift'),
  '-o', path.join(contents, 'MacOS', executableName)], {stdio: 'inherit', cwd: root});
execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', bundle], {stdio: 'inherit'});
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], {stdio: 'inherit'});
try {
  await stat(destination);
  const previousInfo = await readFile(path.join(destination, 'Contents', 'Info.plist'), 'utf8').catch(() => '');
  if (!previousInfo.includes('<string>cc.motionface.codex-recharge</string>')) {
    throw new Error('Refusing to replace an existing application that is not a Codex Recharge build.');
  }
  await rm(destination, {recursive: true, force: true});
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await mkdir(path.dirname(destination), {recursive: true});
await rename(bundle, destination);
await rm(stagingRoot, {recursive: true, force: true});
console.log(`Built ${destination}`);
console.log('The app uses the existing local Node.js runtime; nothing was installed globally.');
