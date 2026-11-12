await import('./migration-v110-all.mjs');
const {testBatchDaysSQL}=await import('./migration-v111.mjs');await testBatchDaysSQL();
