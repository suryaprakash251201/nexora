import { registerRootComponent } from 'expo';

import App from './App';
import { setupPlaybackService } from './src/services/playbackService';

// Registers the headless playback service BEFORE the root component: this is
// what keeps the media notification (notification center / lock screen /
// control center) alive and responsive while the app is in the background.
// No-op when the react-native-track-player native module is absent
// (Expo Go / web) — see src/lib/trackPlayerModule.ts.
setupPlaybackService();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
