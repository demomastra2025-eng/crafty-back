import { configService, Sentry as SentryConfig } from '@config/env.config';

const sentryConfig = configService.get<SentryConfig>('SENTRY');

if (sentryConfig.DSN) {
  void import('@sentry/node')
    .then((Sentry) => {
      Sentry.init({
        dsn: sentryConfig.DSN,
        environment: process.env.NODE_ENV || 'development',
        tracesSampleRate: 1.0,
        profilesSampleRate: 1.0,
      });
    })
    .catch((error) => {
      console.warn('Sentry disabled: failed to load @sentry/node', error);
    });
}
