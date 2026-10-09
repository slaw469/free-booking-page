'use strict';

// npm run seed    add example bookings on the next few open days, flagged as samples
// npm run clear   remove the example bookings (real ones are untouched)

const core = require('../lib/core');

const action = process.argv[2];
core.ensureConfigFile();

if (action === 'clear') {
  const removed = core.clearSampleBookings();
  console.log(removed ? `Removed ${removed} sample booking${removed === 1 ? '' : 's'}.` : 'No sample bookings to remove.');
} else if (action === 'add') {
  const added = core.addSampleBookings();
  console.log(`Added ${added.length} sample booking${added.length === 1 ? '' : 's'}. Remove them with: npm run clear`);
} else {
  console.log('Usage: node scripts/samples.js clear|add');
  process.exit(1);
}
