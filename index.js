// -----------------------------------------------------------------------------
// Entry point: SDK wiring only. Every handler is registered BEFORE connect(),
// and delegates to the CorrentlyApp (src/app.js).
//
// Environment variables provided by the Gladys supervisor, read by the SDK:
// GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { ACTION_TEST, CorrentlyApp } from './src/app.js';

const gladys = new GladysIntegration();
const app = new CorrentlyApp({ gladys });

// --- Discovery: the device of the configured postcode -------------------------
gladys.onScanRequest(() => app.publishDevices());

// --- Configuration screen button ----------------------------------------------
gladys.onAction(ACTION_TEST, () => app.testConnection());

// --- Configuration changed by the user ----------------------------------------
gladys.onConfigUpdated((config) => {
  logger.info('Configuration updated: restarting');
  return app.start(config);
});

// --- Connection lifecycle ------------------------------------------------------
// Messages sent while disconnected are lost: re-read the config every time
// (retried without end when Gladys cannot answer).
gladys.on('connected', () => {
  app.connected().catch((err) => logger.error('Start failed', err));
});

gladys.on('disconnected', () => {
  app.stop().catch((err) => logger.error('Stop failed', err));
});

gladys.handleShutdown(() => app.stop());

logger.info('Starting the Corrently GrünstromIndex integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
