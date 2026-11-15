// Bundled into renderer/presage.bundle.js by scripts/build-renderer.cjs. Exposes the Presage renderer SDK to the page.
const sdk = require('@smartspectra/node-sdk/renderer');
const { decodeMetrics } = require('@smartspectra/node-sdk/messages');
window.PresageRenderer = {
  SmartSpectraSDK: sdk.SmartSpectraSDK,
  breathingMetrics: sdk.breathingMetrics,
  cardioMetrics: sdk.cardioMetrics,
  faceMetrics: sdk.faceMetrics,
  decodeMetrics,
  ProcessingStatus: sdk.ProcessingStatus,
  ValidationCode: sdk.ValidationCode,
};
