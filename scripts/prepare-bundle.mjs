// Copies what the packaged app needs from outside this folder into vendor/:
//   vendor/kb   the Python backend (source of truth: ~/chatgpt-archive/kb)
//   vendor/bin  the uv binary that runs it (downloads Python + libraries on first launch)
//               and cloudflared (the secure link for "Connect a web app")
import { cpSync, rmSync, mkdirSync, existsSync, chmodSync, readdirSync, realpathSync, readFileSync, writeFileSync } from 'fs'
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
// Pick the candidate that runs on the oldest macOS (Homebrew's build requires the macOS it was
// built on; Cloudflare's official build, from "npm run fetch-cloudflared", needs macOS 15).
// If it needs a newer macOS than the app itself, only that feature asks the user to update:
// the minimum is recorded in vendor/bin/cloudflared.json, which the app reads.
const MIN_MACOS = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).build.mac.minimumSystemVersion
const versionKey = v => v.split('.').map(n => n.padStart(4, '0')).join('.')
const minos = bin => {
  const m = execFileSync('/usr/bin/otool', ['-l', bin]).toString().match(/LC_BUILD_VERSION[\s\S]*?minos (\S+)/)
  return m ? m[1] : '0'
}
const cfCandidates = [process.env.CLOUDFLARED_BINARY, join(root, 'build-cache', 'cloudflared'),
  '/opt/homebrew/bin/cloudflared', '/usr/local/bin/cloudflared']
  .filter(p => p && existsSync(p))
  .map(p => ({ path: realpathSync(p), minMacos: minos(realpathSync(p)) }))
  .sort((a, b) => versionKey(a.minMacos).localeCompare(versionKey(b.minMacos)))
const cf = cfCandidates[0]
if (!cf) throw new Error('cloudflared not found. Run "npm run fetch-cloudflared" (official build), or set CLOUDFLARED_BINARY.')
cpSync(cf.path, join(vendor, 'bin', 'cloudflared'))
chmodSync(join(vendor, 'bin', 'cloudflared'), 0o755)
writeFileSync(join(vendor, 'bin', 'cloudflared.json'), JSON.stringify({ minMacos: cf.minMacos }) + '\n')
if (versionKey(cf.minMacos) > versionKey(MIN_MACOS)) {
  console.warn(`note: "Connect a web app" needs macOS ${cf.minMacos}+ (the app itself runs on ${MIN_MACOS}+), using ${cf.path}`)
}
console.log('vendor ready:', readdirSync(join(vendor, 'kb')).join(', '), '+ uv', execFileSync(join(vendor, 'bin', 'uv'), ['--version']).toString().trim())
