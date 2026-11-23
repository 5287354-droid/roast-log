import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from './mini-schema.mjs';
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'schema');
export const wsSchema = JSON.parse(fs.readFileSync(path.join(dir, 'ws-messages.schema.json'), 'utf8'));
export const roastSchema = JSON.parse(fs.readFileSync(path.join(dir, 'roast-v2.schema.json'), 'utf8'));
export const validateWs = m => validate(wsSchema, m);
export const validateRoast = r => validate(roastSchema, r);
