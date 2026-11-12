await import('./migration-v193.mjs');
const {testBulkSQL}=await import('./migration-v110.mjs');await testBulkSQL();
