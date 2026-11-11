import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { prepareSnapshot } from './snapshot.mjs';

export { prepareSnapshot };

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 2) {
    console.error('Usage: node scripts/prepare.mjs');
    process.exitCode = 1;
  } else {
    prepareSnapshot().then(snapshot => {
      console.log(`Prepared ${snapshot.records.length} records`);
    }).catch(error => {
      console.error(`Prepare failed: ${error.message}`);
      process.exitCode = 1;
    });
  }
}
