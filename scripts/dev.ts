/** @module Development command
 * One development entry point for the populated app and its existing lifecycle/modes.
 */
import { workspaceMain } from './workspace';

const args = process.argv.slice(2);
const help = `Usage: bun run dev [--port <port>]
  Default       Start services, populate examples and keep the viewer running
  --server      Start the server without populating
  --preview     Open the separate examples viewer
  --setup       Install or repair the pinned dependencies
  --status      Print this checkout's live URLs and population state
  --stop [server|preview]  Stop owned services, retaining their data
`;
const modes: Record<string, string> = { '--server': 'run', '--preview': 'preview', '--setup': 'setup', '--status': 'status', '--stop': 'stop' };
if (args.includes('--help') || args.includes('-h')) console.log(help);
else {
  const mode = modes[args[0] ?? ''];
  process.exitCode = await workspaceMain([mode ?? 'populate', ...(mode ? args.slice(1) : args)]);
}
