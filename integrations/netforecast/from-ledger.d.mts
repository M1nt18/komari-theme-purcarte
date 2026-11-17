import type { ForecastOverview } from '../../src/features/netforecast/types';
export function adaptForecastPayload(payload: unknown): ForecastOverview;
export function forecastExpiresAt(payload: ForecastOverview): number;
