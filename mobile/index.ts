import { registerRootComponent } from 'expo';

import App from './App';
import { setupPlaybackService } from './src/services/playbackService';

// Registers the headless playback service BEFORE the root component: this is
// what keeps the media notification (notification center / lock screen /
// control center) alive and responsive while the app is in the background.
// No-op on web (no native module there) — see src/lib/trackPlayerModule.ts.
setupPlaybackService();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App)
// and wires up the native build environment.
registerRootComponent(App);
