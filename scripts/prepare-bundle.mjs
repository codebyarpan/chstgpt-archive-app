// Copies what the packaged app needs from outside this folder into vendor/:
//   vendor/kb   the Python backend (source of truth: ~/chatgpt-archive/kb)
//   vendor/bin  the uv binary that runs it (downloads Python + libraries on first launch)
import { cpSync, rmSync, mkdirSync, existsSync, chmodSync, readdirSync, realpathSync } from 'fs'
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
console.log('vendor ready:', readdirSync(join(vendor, 'kb')).join(', '), '+ uv', execFileSync(join(vendor, 'bin', 'uv'), ['--version']).toString().trim())
