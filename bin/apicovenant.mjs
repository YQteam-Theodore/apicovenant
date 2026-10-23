#!/usr/bin/env node
/**
 * apicovenant launcher.
 *
 * The project is written in TypeScript and executed directly by Node's native
 * type stripping, so there is no build step and no runtime dependency.
 */

import { main } from '../src/cli/main.ts';

await main();
