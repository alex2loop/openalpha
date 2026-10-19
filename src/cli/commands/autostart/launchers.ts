import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { START_TIMEOUT_MS } from '@/cli/commands/daemon/background'
import { BRAND } from '@/core/brand'
import { OperatorConfigError } from '@/core/config/resolve'
import { PRIVATE_FILE_MODE } from '@/core/security/private-files'
import { MS_PER_SECOND, sleep } from '@/core/utils/time'

const LAUNCHER_TIMEOUT_MS = 30 * MS_PER_SECOND
const BOOTSTRAP_RETRY_MS = 500
const LABEL = `${BRAND.name}-autostart`
const WINDOWS_RUN_KEY = String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
const XML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
}
const XML_SPECIAL_RE = /[&<>]/g
const SYSTEMD_ESCAPE_RE = /[\\"]/g
const SYSTEMD_SPECIFIER_RE = /[%$]/g

/** Starts `start --background` at login. Each platform keeps its own entry, named for the brand with
 *  an `-autostart` suffix, so it never overwrites the hand-written service the operations guide
 *  documents for an API server. */
interface Launcher {
  isInstalled(): Promise<boolean>
  install(argv: readonly string[]): Promise<void>
  uninstall(): Promise<void>
}

export function resolveLauncher(platform: NodeJS.Platform): Launcher | undefined {
  switch (platform) {
    case 'darwin':
      return macLauncher()
    case 'linux':
      return linuxLauncher()
    case 'win32':
      return windowsLauncher()
    default:
      return undefined
  }
}

function macLauncher(): Launcher {
  const plist = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`)
  const domain = `gui/${process.getuid?.() ?? 0}`

  return {
    isInstalled: () => exists(plist),
    async install(argv): Promise<void> {
      await writePrivate(plist, buildPlist(argv))
      await runTool(['launchctl', 'bootout', `${domain}/${LABEL}`]).catch(() => undefined)
      // Right after a bootout the bootstrap can fail with an I/O error; one retry settles it.
      await runTool(['launchctl', 'bootstrap', domain, plist]).catch(async () => {
        await sleep(BOOTSTRAP_RETRY_MS)
        await runTool(['launchctl', 'bootstrap', domain, plist])
      })
    },
    async uninstall(): Promise<void> {
      await runTool(['launchctl', 'bootout', `${domain}/${LABEL}`]).catch(() => undefined)
      await rm(plist, { force: true })
    },
  }
}

function buildPlist(argv: readonly string[]): string {
  const items = argv.map((arg) => `    <string>${escapeXml(arg)}</string>`).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${items}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>AbandonProcessGroup</key>
  <true/>
</dict>
</plist>
`
}

function escapeXml(value: string): string {
  return value.replace(XML_SPECIAL_RE, (char) => XML_ESCAPES[char] ?? char)
}

// A oneshot unit with RemainAfterExit: the daemon carries the background mark and restarts itself on
// `upgrade`, so there is no main pid for systemd to watch. Under `forking`, systemd would see the old
// pid exit and stop the unit, killing the new daemon in the same cgroup.
function linuxLauncher(): Launcher {
  const unit = join(homedir(), '.config', 'systemd', 'user', `${LABEL}.service`)
  const service = `${LABEL}.service`

  return {
    isInstalled: () => exists(unit),
    async install(argv): Promise<void> {
      await writePrivate(unit, buildUnit(argv))
      await runTool(['systemctl', '--user', 'daemon-reload'])
      await runTool(['systemctl', '--user', 'enable', service])
    },
    async uninstall(): Promise<void> {
      await runTool(['systemctl', '--user', 'disable', service]).catch(() => undefined)
      await rm(unit, { force: true })
      await runTool(['systemctl', '--user', 'daemon-reload']).catch(() => undefined)
    },
  }
}

function buildUnit(argv: readonly string[]): string {
  const timeoutSeconds = (START_TIMEOUT_MS + LAUNCHER_TIMEOUT_MS) / MS_PER_SECOND

  return `[Unit]
Description=${BRAND.display} start at login

[Service]
Type=oneshot
RemainAfterExit=yes
TimeoutStartSec=${timeoutSeconds}
ExecStart=${argv.map(quoteSystemdArg).join(' ')}

[Install]
WantedBy=default.target
`
}

function quoteSystemdArg(arg: string): string {
  const escaped = arg.replace(SYSTEMD_ESCAPE_RE, '\\$&').replace(SYSTEMD_SPECIFIER_RE, '$&$&')

  return `"${escaped}"`
}

// A Run-key value rather than a logon task: creating a logon trigger needs an elevated prompt for
// most users. The command goes to `reg` as separate spawn arguments, so no shell quoting applies.
function windowsLauncher(): Launcher {
  return {
    isInstalled: async () =>
      await runTool(['reg', 'query', WINDOWS_RUN_KEY, '/v', LABEL]).then(
        () => true,
        () => false
      ),
    async install(argv): Promise<void> {
      const [exe = '', ...args] = argv
      const quoted = [exe, ...args].map((arg) => `'${arg.replaceAll("'", "''")}'`)
      const command = `powershell -NoProfile -WindowStyle Hidden -Command "& ${quoted.join(' ')}"`

      await runTool([
        'reg',
        'add',
        WINDOWS_RUN_KEY,
        '/v',
        LABEL,
        '/t',
        'REG_SZ',
        '/d',
        command,
        '/f',
      ])
    },
    async uninstall(): Promise<void> {
      await runTool(['reg', 'delete', WINDOWS_RUN_KEY, '/v', LABEL, '/f'])
    },
  }
}

async function exists(path: string): Promise<boolean> {
  return await Bun.file(path).exists()
}

async function writePrivate(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, { mode: PRIVATE_FILE_MODE })
}

/** Every external call has one bound; a non-zero exit is the operator's to read. */
async function runTool(argv: readonly string[]): Promise<void> {
  const child = Bun.spawn([...argv], {
    stdout: 'ignore',
    stderr: 'pipe',
    signal: AbortSignal.timeout(LAUNCHER_TIMEOUT_MS),
  })
  const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited])

  if (code !== 0) {
    const detail = stderr.trim() || `${argv[0] ?? 'command'} exited with ${code}`

    throw new OperatorConfigError(`autostart tool failed: ${detail}`, {
      key: 'cli.autostartFailed',
      params: { detail },
    })
  }
}
