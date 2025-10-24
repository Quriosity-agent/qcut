/**
 * Inspect what databases are actually being created during tests
 * Run this in the browser console during test execution to see database names
 */

async function inspectDatabases() {
  console.log('🔍 Inspecting IndexedDB databases...\n');

  const databases = await indexedDB.databases();

  console.log(`📊 Total databases found: ${databases.length}\n`);

  // Group databases by name pattern
  const grouped = {};

  databases.forEach(db => {
    if (!db.name) return;

    // Extract pattern (e.g., "qcut-project-123" -> "qcut-project-*")
    const pattern = db.name.replace(/\d+/g, '*');

    if (!grouped[pattern]) {
      grouped[pattern] = [];
    }
    grouped[pattern].push(db.name);
  });

  // Show summary
  console.log('📋 Database groups:\n');
  Object.entries(grouped).forEach(([pattern, names]) => {
    console.log(`  ${pattern}: ${names.length} databases`);
    if (names.length <= 10) {
      // Show all if few
      names.forEach(name => console.log(`    - ${name}`));
    } else {
      // Show first 5 and last 5
      console.log(`    First 5:`);
      names.slice(0, 5).forEach(name => console.log(`    - ${name}`));
      console.log(`    ... (${names.length - 10} more) ...`);
      console.log(`    Last 5:`);
      names.slice(-5).forEach(name => console.log(`    - ${name}`));
    }
    console.log('');
  });

  // Show individual database details (first 20)
  console.log('\n📝 First 20 database details:\n');
  databases.slice(0, 20).forEach((db, index) => {
    console.log(`${index + 1}. ${db.name} (v${db.version || 'unknown'})`);
  });

  if (databases.length > 20) {
    console.log(`\n... and ${databases.length - 20} more databases`);
  }

  return {
    total: databases.length,
    grouped,
    databases
  };
}

// Run immediately
inspectDatabases().then(result => {
  console.log('\n✅ Inspection complete');
  console.log(`Total: ${result.total} databases`);
});
