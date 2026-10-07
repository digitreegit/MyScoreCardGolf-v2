// Native file I/O for spreadsheets: write to cache + share sheet; pick with the document picker.
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import type { EncodedFile } from '@/domain/spreadsheet/workbook';

export async function saveFile(file: EncodedFile, baseName: string): Promise<void> {
  const out = new File(Paths.cache, `${baseName}.${file.ext}`);
  if (out.exists) out.delete();
  out.write(file.base64, { encoding: 'base64' });
  await Sharing.shareAsync(out.uri, { mimeType: file.mimeType, dialogTitle: baseName });
}

/** Returns the picked file as base64, or null if cancelled. */
export async function pickSpreadsheet(): Promise<string | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
      'text/comma-separated-values',
    ],
    copyToCacheDirectory: true,
  });
  const asset = res.assets?.[0];
  if (res.canceled || !asset) return null;
  return new File(asset.uri).base64();
}
