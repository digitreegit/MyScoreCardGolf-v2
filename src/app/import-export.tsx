import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import { useRounds } from '@/data/hooks';
import { saveRounds } from '@/data/repository';
import { roundsToRows, rowsToRounds, type ImportError } from '@/domain/spreadsheet/roundsSheet';
import { fileToRows, rowsToFile, templateFile, type SheetFormat } from '@/domain/spreadsheet/workbook';
import { nowIso, todayLocalDate } from '@/domain/types';
import { useAuth } from '@/features/auth/AuthProvider';
import { pickSpreadsheet, saveFile } from '@/features/io/files';
import { newId } from '@/lib/id';
import { Button, Card, Label, Screen } from '@/ui/components';

export default function ImportExportScreen() {
  const { t } = useTranslation();
  const { userId } = useAuth();
  const { data } = useRounds();
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<ImportError[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const guarded = (key: string, fn: () => Promise<void>) => async () => {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      Alert.alert(t('common.error'), (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const exportAs = (format: SheetFormat) =>
    guarded(format, () => saveFile(rowsToFile(roundsToRows(data), format), `myscorecard-${todayLocalDate()}`));

  const importFile = guarded('import', async () => {
    const base64 = await pickSpreadsheet();
    if (!base64) return;
    const { items, errors: rowErrors } = rowsToRounds(fileToRows(base64), { userId, newId, now: nowIso() });
    if (items.length) await saveRounds(items);
    setErrors(rowErrors);
    setMessage(t('io.importDone', { count: items.length }));
  });

  return (
    <Screen>
      <Card>
        <Button title={t('io.exportXlsx')} loading={busy === 'xlsx'} disabled={!data.length} onPress={() => void exportAs('xlsx')()} />
        <Button title={t('io.exportCsv')} variant="secondary" loading={busy === 'csv'} disabled={!data.length} onPress={() => void exportAs('csv')()} />
      </Card>
      <Card>
        <Button title={t('io.import')} loading={busy === 'import'} onPress={() => void importFile()} />
        <Button
          title={t('io.template')}
          variant="secondary"
          onPress={() => void guarded('template', () => saveFile(templateFile(), 'myscorecard-template'))()}
        />
        {message && <Label>{message}</Label>}
        {errors.length > 0 && (
          <>
            <Label muted>{t('io.importErrors', { count: errors.length })}</Label>
            {errors.slice(0, 20).map((e) => (
              <Label muted key={`${e.row}-${e.message}`}>
                Row {e.row}: {e.message}
              </Label>
            ))}
          </>
        )}
      </Card>
    </Screen>
  );
}
