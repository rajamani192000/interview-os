import { defineConfig } from 'vitest/config';
// Pure-logic unit tests (no Angular / browser needed): SRS, plan, reminders, importer, JD mapping, weak areas, analytics, rules of the memory backend.
export default defineConfig({ test: { include: ['tests/unit/**/*.spec.ts'], environment: 'node' } });
