const { TestEnvironment } = require('jest-environment-node');

// Jest skips afterAll hooks when every test is skipped. Drain initialization at
// run_finish, before Jest tears down the runtime needed by PGlite's WASM imports.
class DatabaseEnvironment extends TestEnvironment {
  async handleTestEvent(event) {
    if (event.name !== 'run_finish') {
      return;
    }
    const database = this.global[Symbol.for('visomi.memory.database')];

    if (database) {
      await database.waitReady;
    }
  }

  async teardown() {
    const database = this.global[Symbol.for('visomi.memory.database')];

    try {
      if (database) {
        await database.waitReady;
        // Suite hooks have finished. Release an original database left open by
        // mocked or skipped suites before the next sandbox allocates its WASM memory.
        if (!database.closed) {
          await database.close();
        }
      }
    } finally {
      await super.teardown();
    }
  }
}

module.exports = DatabaseEnvironment;
