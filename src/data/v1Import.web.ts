// v1 never ran on the web, so there is nothing to import. Same exports as v1Import.ts.
export interface V1ImportResult {
  imported: number;
  language: string | null;
}

export async function importV1DataOnce(_userId: string | null): Promise<V1ImportResult | null> {
  return null;
}
