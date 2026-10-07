// Web file I/O: browser download and <input type="file">. Same exports as files.ts.
import type { EncodedFile } from '@/domain/spreadsheet/workbook';

export async function saveFile(file: EncodedFile, baseName: string): Promise<void> {
  const bytes = Uint8Array.from(atob(file.base64), (ch) => ch.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${baseName}.${file.ext}`;
  a.click();
  URL.revokeObjectURL(url);
}

export function pickSpreadsheet(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? null); // strip "data:...;base64,"
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(f);
    };
    input.click();
  });
}
