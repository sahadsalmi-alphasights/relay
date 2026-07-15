import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The *.api.test.ts integration files share one real Postgres database
    // and reset it via TRUNCATE in beforeEach — running test files in
    // parallel lets one file's reset clobber another's in-flight fixtures
    // (visible as random foreign-key violations). Rules-engine unit tests
    // don't touch the DB at all, so this only costs time on the API suite.
    fileParallelism: false,
  },
});
