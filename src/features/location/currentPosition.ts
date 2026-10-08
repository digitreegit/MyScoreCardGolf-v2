// One-shot foreground position, used only to recognize which course the player is at.
// The position is matched against the bundled course list on the device and then dropped:
// never pass it to Supabase, analytics, crash reporting, logs, or any request (CLAUDE.md "Location privacy").

import * as Location from 'expo-location';

import type { LatLng } from '@/domain/geo';

/** null when permission is denied; throws when there's no fix (indoors, airplane mode). */
export async function getCurrentPositionOnce(): Promise<LatLng | null> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== Location.PermissionStatus.GRANTED) return null;
  // A recent fix is good enough to tell courses apart and answers instantly on the first tee.
  const last = await Location.getLastKnownPositionAsync({ maxAge: 2 * 60_000, requiredAccuracy: 500 });
  const loc = last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
  return { lat: loc.coords.latitude, lng: loc.coords.longitude };
}
