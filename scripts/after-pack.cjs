// No Apple Developer ID is available, so sign the app ad hoc. An unsigned (or
// broken-signature) app downloaded on another Mac is reported as "damaged";
// ad hoc signed, macOS instead offers "Open Anyway" in Privacy & Security.
const { execFileSync } = require('child_process')
const { join } = require('path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
  console.log('  • ad hoc signed', app)
}
