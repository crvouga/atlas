/**
 * @module Consumer package-manager commands
 *
 * One source for commands emitted by init, the running server's agent guide, and generated documentation.
 * Execute the installed CLI so a consumer keeps the versions selected by its own manifest and lockfile.
 */

/** Supported consumer package managers, their development install command and installed-binary executor. */
export const PACKAGE_MANAGERS = {
  bun: { label: 'Bun', installDev: 'bun add -d', exec: 'bunx' },
  npm: { label: 'npm', installDev: 'npm install -D', exec: 'npm exec --' },
  pnpm: { label: 'pnpm', installDev: 'pnpm add -D', exec: 'pnpm exec' },
  yarn: { label: 'Yarn', installDev: 'yarn add -D', exec: 'yarn exec' }
} as const;

/**
 * Markdown installation table for consumer and server agent documentation.
 * @example
 * const markdown = packageManagerTable(); // the same commands `atlas init` emits
 */
export function packageManagerTable(): string {
  return ['| Package manager | Install | Run the installed CLI |', '| --- | --- | --- |',
    ...Object.values(PACKAGE_MANAGERS).map(manager => `| ${manager.label} | \`${manager.installDev} @crvouga/atlas\` | \`${manager.exec} atlas\` |`)
  ].join('\n');
}
