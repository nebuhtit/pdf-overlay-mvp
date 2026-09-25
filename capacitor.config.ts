import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.nebuhtit.pdfoverlay',
  appName: 'PDF Overlay',
  webDir: 'dist',
  ios: {
    backgroundColor: '#07111f',
    contentInset: 'never',
  },
};

export default config;
