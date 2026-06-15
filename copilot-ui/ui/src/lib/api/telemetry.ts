import type { HarnessTelemetryResponse } from '../types';
import { apiRequest } from './core';

export function getHarnessTelemetry(
  params?: { limit?: number },
  baseUrl?: string,
): Promise<HarnessTelemetryResponse> {
  const searchParams = new URLSearchParams();
  if (params?.limit) searchParams.set('limit', String(params.limit));
  const qs = searchParams.toString();
  return apiRequest<HarnessTelemetryResponse>(
    `/api/telemetry/harnesses${qs ? `?${qs}` : ''}`,
    { baseUrl },
  );
}
