await import('./migration-v111-all.mjs');
const {testDayOrderSQL}=await import('./migration-v112.mjs');await testDayOrderSQL();

const {testChatSQL}=await import('./migration-v20.mjs');await testChatSQL();
