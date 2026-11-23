// Copies what the packaged app needs from outside this folder into vendor/:
//   vendor/kb   the Python backend (source of truth: ~/chatgpt-archive/kb)
//   vendor/bin  the uv binary that runs it (downloads Python + libraries on first launch)
//               and cloudflared (the secure link for "Connect a web app")
import { cpSync, rmSync, mkdirSync, existsSync, chmodSync, readdirSync, realpathSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { fileURLToPath } from 'url'
import { execFileSync } from 'child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const vendor = join(root, 'vendor')
const kbSrc = process.env.ARCHIVE_KB_DIR || join(homedir(), 'chatgpt-archive', 'kb')

rmSync(vendor, { recursive: true, force: true })
mkdirSync(join(vendor, 'kb'), { recursive: true })
mkdirSync(join(vendor, 'bin'), { recursive: true })

for (const f of readdirSync(kbSrc).filter(f => f.endsWith('.py'))) cpSync(join(kbSrc, f), join(vendor, 'kb', f))

const uvCandidates = [process.env.UV_BINARY, '/opt/homebrew/bin/uv', '/usr/local/bin/uv', join(homedir(), '.local', 'bin', 'uv')].filter(Boolean)
const uv = uvCandidates.find(p => existsSync(p))
if (!uv) throw new Error('uv not found: install it (brew install uv) or set UV_BINARY')
cpSync(realpathSync(uv), join(vendor, 'bin', 'uv'))
chmodSync(join(vendor, 'bin', 'uv'), 0o755)
// cloudflared opens the public HTTPS link that web apps connect through ("Connect a web app").
// It must run on every macOS the app supports, so check each candidate's minimum version
// (Homebrew's build requires the macOS it was built on).
const MIN_MACOS = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).build.mac.minimumSystemVersion
const versionKey = v => v.split('.').map(n => n.padStart(4, '0')).join('.')
const minos = bin => {
  const m = execFileSync('/usr/bin/otool', ['-l', bin]).toString().match(/LC_BUILD_VERSION[\s\S]*?minos (\S+)/)
  return m ? m[1] : '0'
}
const cfCandidates = [process.env.CLOUDFLARED_BINARY, join(root, 'build-cache', 'cloudflared'),
  '/opt/homebrew/bin/cloudflared', '/usr/local/bin/cloudflared'].filter(p => p && existsSync(p))
const rejected = []
const cf = cfCandidates.find(p => {
  const v = minos(realpathSync(p))
  if (versionKey(v) <= versionKey(MIN_MACOS)) return true
  rejected.push(`${p} needs macOS ${v}`)
  return false
})
if (!cf) {
  throw new Error(`No cloudflared that runs on macOS ${MIN_MACOS} was found${rejected.length ? ` (${rejected.join('; ')})` : ''}.\n` +
    'Run "npm run fetch-cloudflared" to download the official build, or set CLOUDFLARED_BINARY.')
}
cpSync(realpathSync(cf), join(vendor, 'bin', 'cloudflared'))
chmodSync(join(vendor, 'bin', 'cloudflared'), 0o755)
console.log('vendor ready:', readdirSync(join(vendor, 'kb')).join(', '), '+ uv', execFileSync(join(vendor, 'bin', 'uv'), ['--version']).toString().trim())
