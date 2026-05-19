import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'darts-test-'));
process.env.DATA_DIR = tmpRoot;
process.env.NODE_ENV = 'test';

afterAll(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
});
