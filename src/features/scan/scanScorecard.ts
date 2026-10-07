import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import type { ScanResult } from '@/domain/scanResult';
import { getSupabase } from '@/lib/supabase';

/** ~1600px on the long side keeps handwriting legible while keeping upload size and token cost low. */
const MAX_EDGE = 1600;

export type ScanError = 'cancelled' | 'permission' | 'quota_exceeded' | 'failed';

export interface PickedImage {
  uri: string;
  width: number;
  height: number;
}

export async function pickScorecardImage(source: 'camera' | 'library'): Promise<PickedImage | ScanError> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return 'permission';
  }
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
  const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  const asset = res.assets?.[0];
  if (res.canceled || !asset) return 'cancelled';
  return { uri: asset.uri, width: asset.width, height: asset.height };
}

async function toJpegBase64({ uri, width, height }: PickedImage): Promise<string> {
  const ctx = ImageManipulator.manipulate(uri);
  if (Math.max(width, height) > MAX_EDGE) {
    ctx.resize(width >= height ? { width: MAX_EDGE } : { height: MAX_EDGE });
  }
  const image = await ctx.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true });
  if (!saved.base64) throw new Error('image encoding failed');
  return saved.base64;
}

export async function scanScorecard(
  image: PickedImage,
): Promise<{ result: ScanResult; remaining: number } | { error: ScanError }> {
  const imageBase64 = await toJpegBase64(image);
  const { data, error } = await getSupabase().functions.invoke('scan-scorecard', {
    body: { imageBase64, mediaType: 'image/jpeg' },
  });
  if (error) {
    const status = (error as { context?: { status?: number } }).context?.status;
    return { error: status === 429 ? 'quota_exceeded' : 'failed' };
  }
  return data as { result: ScanResult; remaining: number };
}
