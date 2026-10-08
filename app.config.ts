import type { ExpoConfig } from 'expo/config';

// v2 ships as an UPDATE to the v1 store listings: keep these bundle IDs and the EAS project.
// That is also what lets v2 read v1's on-device data (see src/data/v1Import.ts).
const IOS_BUNDLE_ID = 'com.skyface.myscorecard.ios';
const ANDROID_PACKAGE = 'com.skyface.myscorecard.golf';

// Reversed iOS OAuth client ID from Google Cloud, e.g. com.googleusercontent.apps.123-abc
// One microphone description for every plugin that touches NSMicrophoneUsageDescription.
// (expo-image-picker with microphonePermission: false deletes the key and blocks RECORD_AUDIO on
// Android, which crashed voice entry on iOS.)
const MICROPHONE_USAGE = 'Say your score (for example "hole 7 bogey, two putts") instead of typing it.';

const googleIosUrlScheme = process.env.GOOGLE_IOS_URL_SCHEME ?? 'com.googleusercontent.apps.REPLACE_ME';

const config: ExpoConfig = {
  name: 'My Score Card',
  slug: 'myscorecard-golf',
  version: '2.0.0', // build numbers are managed remotely by EAS (eas.json appVersionSource)
  scheme: 'myscorecard',
  orientation: 'default', // screens lock themselves: portrait everywhere, landscape on the score card
  icon: './assets/images/icon.png',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: IOS_BUNDLE_ID,
    appleTeamId: 'T42D4PX35G', // SKYFACE, LLC (paid team that publishes the app; personal teams can't sign Sign in with Apple)
    supportsTablet: false,
    usesAppleSignIn: true,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: ANDROID_PACKAGE,
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    // Location is foreground-only by design; make sure no library adds background access.
    blockedPermissions: ['android.permission.ACCESS_BACKGROUND_LOCATION'],
    predictiveBackGestureEnabled: false,
  },
  web: {
    output: 'single', // SPA: every route is behind sign-in, nothing to pre-render
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    ['expo-splash-screen', { backgroundColor: '#1B6B3A', image: './assets/images/splash-icon.png', imageWidth: 76 }],
    'expo-sqlite',
    'expo-localization',
    'expo-sharing',
    'expo-apple-authentication',
    ['@react-native-google-signin/google-signin', { iosUrlScheme: googleIosUrlScheme }],
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'My Score Card uses your location only on this device to recognize the golf course you are at. It is never sent or stored.',
        isIosBackgroundLocationEnabled: false,
        isAndroidBackgroundLocationEnabled: false,
        isAndroidForegroundServiceEnabled: false,
      },
    ],
    [
      'expo-image-picker',
      {
        cameraPermission: 'Take a photo of a paper scorecard to fill in your round automatically.',
        photosPermission: 'Choose a photo of a paper scorecard to fill in your round automatically.',
        microphonePermission: MICROPHONE_USAGE,
      },
    ],
    [
      'expo-speech-recognition',
      {
        microphonePermission: MICROPHONE_USAGE,
        speechRecognitionPermission: 'Speech recognition turns what you say into hole scores.',
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    eas: { projectId: '9c2affc5-f4bb-4cbf-88d7-82a330146dce' },
  },
};

export default config;
