import 'dotenv/config';
import { InstallGlobalCommands } from './app/commons/utils.ts';
import { commands } from './app/commands/index.ts';

const definitions = commands.map((cmd) => cmd.definition);

try {
    await InstallGlobalCommands(process.env.APP_ID, definitions);

    // Naming them is what distinguishes a successful push from a run that did nothing:
    // this list is exactly what Discord now holds, the PUT being a full replacement.
    const names = definitions.map((d) => d.name).sort();
    console.log(`[Commands] Registered ${names.length}: ${names.join(', ')}`);
} catch (error) {
    console.error('[Commands] Registration failed:', error);
    // Not `process.exit`: it can truncate a pending stderr write when the output is a
    // pipe, swallowing the very message that explains the failure. Setting the code lets
    // the process end on its own — same choice as scripts/analyze-upgrade.ts.
    process.exitCode = 1;
}
