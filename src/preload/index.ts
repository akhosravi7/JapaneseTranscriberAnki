import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IpcApiError, type AppErrorShape } from '@shared/errors'
import { IPC, type DesktopApi, type IpcResult } from '@shared/ipc'

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>
  if (!result.ok) throw new IpcApiError(result.error as AppErrorShape)
  return result.data
}

const api: DesktopApi = {
  importAudio: () => invoke(IPC.importAudio),
  importAudioPath: (filePath) => invoke(IPC.importAudioPath, filePath),
  pathForFile: (file) => webUtils.getPathForFile(file),
  transcribe: (sessionId) => invoke(IPC.transcribe, sessionId),
  generateReading: (text) => invoke(IPC.generateReading, text),
  translate: (request) => invoke(IPC.translate, request),
  proofreadJapanese: (request) => invoke(IPC.proofreadJapanese, request),
  checkDuplicates: (request) => invoke(IPC.checkDuplicates, request),
  addToAnki: (request) => invoke(IPC.addToAnki, request),
  getSettings: () => invoke(IPC.getSettings),
  saveSettings: (patch) => invoke(IPC.saveSettings, patch),
  testAnki: (settings) => invoke(IPC.testAnki, settings),
  getAnkiCatalog: (settings) => invoke(IPC.getAnkiCatalog, settings),
  getModelFields: (noteType, settings) => invoke(IPC.getModelFields, noteType, settings),
  testTranslation: () => invoke(IPC.testTranslation)
}

contextBridge.exposeInMainWorld('api', api)
