import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, desktopCapturer, net, protocol, session, shell } from 'electron'
import { SessionStore } from './session-store'
import { SecretsStore } from './secrets'
import { SettingsStore } from './settings-store'
import { registerIpc } from './ipc'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true
    }
  }
])

app.setName('Kotoba Cards')

const rendererUrlArg = process.argv.find((arg) => arg.startsWith('--kotoba-renderer-url='))
if (rendererUrlArg) {
  const rendererUrl = rendererUrlArg.slice('--kotoba-renderer-url='.length)
  if (rendererUrl) process.env.ELECTRON_RENDERER_URL = rendererUrl
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 840,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: '#f6f3ec',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 22 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow?.webContents.getURL()
    if (current && url !== current) event.preventDefault()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function configureMediaPermissions(): void {
  const ses = session.defaultSession

  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media' || permission === 'display-capture')
  })

  ses.setPermissionCheckHandler((_webContents, permission) => {
    return permission === 'media' || permission === 'display-capture'
  })

  ses.setDisplayMediaRequestHandler(
    async (request, callback) => {
      try {
        if (!request.audioRequested) {
          callback(null)
          return
        }
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 0, height: 0 }
        })
        const screen = sources[0]
        if (!screen) {
          callback(null)
          return
        }
        callback({ video: screen, audio: 'loopback' })
      } catch {
        callback(null)
      }
    },
    { useSystemPicker: false }
  )
}

app.whenReady().then(async () => {
  const userData = app.getPath('userData')
  const sessions = new SessionStore(join(userData, 'sessions'))
  const secrets = new SecretsStore(userData)
  const settings = new SettingsStore(userData, secrets)

  await sessions.init()

  protocol.handle('media', async (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'session') {
        return new Response('Not found', { status: 404 })
      }
      const id = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
      if (!id) return new Response('Not found', { status: 404 })
      const mediaPath = sessions.getMediaPath(id)
      return await net.fetch(pathToFileURL(mediaPath).toString(), {
        headers: request.headers
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })

  registerIpc({ sessions, settings })
  configureMediaPermissions()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
