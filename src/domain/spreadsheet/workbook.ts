// xlsx / csv file encoding on top of the pure row conversion in ./roundsSheet.ts.
// SheetJS is installed from cdn.sheetjs.com (the npm registry copy is outdated).

import * as XLSX from 'xlsx';

import { sheetHeader, type SheetRow } from './roundsSheet';

export type SheetFormat = 'xlsx' | 'csv';

export interface EncodedFile {
  base64: string;
  mimeType: string;
  ext: SheetFormat;
}

const MIME: Record<SheetFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
};

export function rowsToFile(rows: SheetRow[], format: SheetFormat): EncodedFile {
  const ws = XLSX.utils.json_to_sheet(rows, { header: sheetHeader() });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Rounds');
  const base64 = XLSX.write(wb, { type: 'base64', bookType: format });
  return { base64, mimeType: MIME[format], ext: format };
}

/** Reads the first sheet of an xlsx/xls/csv file (base64) into header-keyed rows. */
export function fileToRows(base64: string): SheetRow[] {
  const wb = XLSX.read(base64, { type: 'base64', cellDates: true });
  const first = wb.SheetNames[0];
  if (!first) return [];
  return XLSX.utils.sheet_to_json<SheetRow>(wb.Sheets[first], { defval: null, raw: true });
}

/** Empty template with just the header row, offered as a download before the first import. */
export function templateFile(): EncodedFile {
  return rowsToFile([], 'xlsx');
}
