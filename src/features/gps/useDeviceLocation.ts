// Foreground-only location for the GPS screen. Positions stay in component state on the device:
// do not pass them to analytics, crash reporting, Supabase, or any network call (CLAUDE.md "Location privacy").

import * as Location from 'expo-location';
import { useEffect, useState } from 'react';

import type { LatLng } from '@/domain/geo';

export type LocationPermission = 'unknown' | 'granted' | 'denied';

export interface DeviceLocation {
  permission: LocationPermission;
  position: LatLng | null;
  accuracyMeters: number | null;
}

/** Watches the position only while `active` (e.g. the screen is focused) to save battery. */
export function useDeviceLocation(active: boolean): DeviceLocation {
  const [state, setState] = useState<DeviceLocation>({ permission: 'unknown', position: null, accuracyMeters: null });

  useEffect(() => {
    if (!active) return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;

    void (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (status !== Location.PermissionStatus.GRANTED) {
        setState((s) => ({ ...s, permission: 'denied' }));
        return;
      }
      setState((s) => ({ ...s, permission: 'granted' }));
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 3, timeInterval: 2000 },
        (loc) =>
          setState({
            permission: 'granted',
            position: { lat: loc.coords.latitude, lng: loc.coords.longitude },
            accuracyMeters: loc.coords.accuracy ?? null,
          }),
      );
      if (cancelled) sub.remove();
    })();

    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [active]);

  return state;
}

/** One-shot position for "find nearby courses". Used on-device only. */
export async function getCurrentPositionOnce(): Promise<LatLng | null> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== Location.PermissionStatus.GRANTED) return null;
  const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { lat: loc.coords.latitude, lng: loc.coords.longitude };
}
