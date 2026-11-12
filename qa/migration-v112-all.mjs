await import('./migration-v111-all.mjs');
const {testDayOrderSQL}=await import('./migration-v112.mjs');await testDayOrderSQL();
