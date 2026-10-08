import { serializePortableBackup, parseVesperBackup } from './vesper-backup.js';
import { prepareImport } from '../migration/import-service.js';

export function createBackupFile(vault, name = 'Vesper_Backup.json') {
  const text = serializePortableBackup(vault);
  parseVesperBackup(text); // A rollback/download must itself be restorable.
  return new File([text], name, { type: 'application/json' });
}

export async function shareBackup(file, navigatorObject = navigator) {
  if (!navigatorObject.canShare?.({ files: [file] }) || !navigatorObject.share)
    throw new Error('File sharing is unavailable in this browser. Use Download JSON instead.');
  try { await navigatorObject.share({ files: [file], title: 'Vesper backup' }); return true; }
  catch (error) { if (error.name === 'AbortError') return false; throw error; }
}

export function downloadBackupFile(file) {
  const url = URL.createObjectURL(file), link = document.createElement('a');
  link.href = url; link.download = file.name; document.body.append(link); link.click(); link.remove();
  // Safari may still be reading the blob while its document/share UI opens.
  setTimeout(() => URL.revokeObjectURL(url), 300000);
}

export async function readBackupFile(file, progress = () => {}) {
  progress('Reading backup…');
  await new Promise(resolve => setTimeout(resolve, 0));
  const text = await file.text();
  progress('Validating backup…');
  await new Promise(resolve => setTimeout(resolve, 0));
  let source;
  try { source = JSON.parse(text); }
  catch { throw new Error('This JSON file is incomplete or damaged. Nothing was changed.'); }
  return prepareImport(source);
}
