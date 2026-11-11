import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { importSnapshot } from './snapshot.mjs';

export { importSnapshot };

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 4) {
    console.error('Usage: node scripts/import.mjs <csv> <UTC retrieval timestamp>');
    process.exitCode = 1;
  } else {
    importSnapshot(process.argv[2], process.argv[3]).then(metadata => {
      console.log(`Imported ${metadata.sha256}; run node scripts/prepare.mjs`);
    }).catch(error => {
      console.error(`Import failed: ${error.message}`);
      process.exitCode = 1;
    });
  }
}
