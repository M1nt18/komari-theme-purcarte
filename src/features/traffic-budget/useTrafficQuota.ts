import { useSyncExternalStore } from 'react';
import { trafficStore } from '../../../integrations/traffic-ledger/traffic-store.mjs';

export function useTrafficQuota(uuid: string) {
  useSyncExternalStore(trafficStore.subscribe, trafficStore.getSnapshot);
  return trafficStore.get(uuid);
}
