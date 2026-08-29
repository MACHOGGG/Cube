import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The native shell around the same web build the site serves.
 *
 * Capacitor does not change the web app at all: `webDir` points at the very
 * bundle `npm run build` already produces for Vercel, and the iOS project
 * just loads those files from inside the app instead of over the network.
 * Nothing here is imported by src/, so the browser build is byte-for-byte
 * what it was before — the two targets stay in step by construction.
 *
 * To refresh the app after a code change:  npm run ios:sync
 *
 * `appId` is the App Store bundle identifier. It can be changed later in
 * Xcode (App target → Signing & Capabilities → Bundle Identifier), but it
 * must be globally unique before the app is ever submitted.
 */
const config: CapacitorConfig = {
  appId: 'com.slides.game',
  appName: 'Slides',
  webDir: 'dist',
  // Matches --bg in style.css, so the gap before the first paint is the
  // app's own paper colour rather than a white flash.
  backgroundColor: '#FAF9F5',
};

export default config;
