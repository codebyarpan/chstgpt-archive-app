// Renders build/install-guide.html to "build/How to install ChatGPT Archive.pdf".
// Run: npm run guide   (uses Electron's own Chromium, offline)
const { app, BrowserWindow } = require('electron')
const { join } = require('path')
const { writeFileSync } = require('fs')

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
  await win.loadFile(join(__dirname, '..', 'build', 'install-guide.html'))
  const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true })
  writeFileSync(join(__dirname, '..', 'build', 'How to install ChatGPT Archive.pdf'), pdf)
  console.log('guide written')
  app.quit()
})
