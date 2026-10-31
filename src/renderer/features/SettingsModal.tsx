import { useState } from 'react'
import type { AnkiCatalog, AppSettings, SettingsPatch } from '@shared/types'
import { isIpcApiError } from '@shared/errors'
import { CheckIcon, CloseIcon, RefreshIcon, SparklesIcon, WarningIcon } from '../components/Icons'

interface Props {
  settings: AppSettings
  onClose: () => void
  onSaved: (settings: AppSettings) => void
}

type BusyAction = 'save' | 'anki' | 'catalog' | 'fields' | 'translation' | null

interface Status {
  tone: 'ok' | 'error' | 'info'
  message: string
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function detailOf(error: unknown): string {
  return isIpcApiError(error) && error.detail ? ` ${error.detail}` : ''
}

function guessField(fields: string[], candidates: string[], current: string): string {
  const lowered = fields.map((field) => ({ field, lower: field.toLowerCase() }))
  for (const candidate of candidates) {
    const exact = lowered.find((entry) => entry.lower === candidate)
    if (exact) return exact.field
  }
  for (const candidate of candidates) {
    const partial = lowered.find((entry) => entry.lower.includes(candidate))
    if (partial) return partial.field
  }
  return current
}

export default function SettingsModal({ settings, onClose, onSaved }: Props): React.JSX.Element {
  const [transcription, setTranscription] = useState({
    endpoint: settings.transcription.endpoint,
    model: settings.transcription.model,
    language: settings.transcription.language
  })
  const [translation, setTranslation] = useState({
    endpoint: settings.translation.endpoint,
    model: settings.translation.model,
    temperature: settings.translation.temperature,
    customInstructions: settings.translation.customInstructions
  })
  const [anki, setAnki] = useState<AppSettings['anki']>(() => JSON.parse(JSON.stringify(settings.anki)))
  const [paddingMs, setPaddingMs] = useState(settings.audio.paddingMs)
  const [transcriptionKey, setTranscriptionKey] = useState('')
  const [translationKey, setTranslationKey] = useState('')
  const [clearTranscriptionKey, setClearTranscriptionKey] = useState(false)
  const [clearTranslationKey, setClearTranslationKey] = useState(false)
  const [busy, setBusy] = useState<BusyAction>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [catalog, setCatalog] = useState<AnkiCatalog | null>(null)
  const [modelFields, setModelFields] = useState<string[]>([])

  const setField = (field: keyof AppSettings['anki']['fields'], value: string): void => {
    setAnki((previous) => ({ ...previous, fields: { ...previous.fields, [field]: value } }))
  }

  const save = async (): Promise<void> => {
    setStatus(null)
    if (!transcription.endpoint.trim() || !transcription.model.trim()) {
      setStatus({ tone: 'error', message: 'Transcription endpoint and model are required.' })
      return
    }
    if (!translation.endpoint.trim() || !translation.model.trim()) {
      setStatus({ tone: 'error', message: 'Translation endpoint and model are required.' })
      return
    }
    if (!anki.endpoint.trim() || !anki.deck.trim() || !anki.noteType.trim()) {
      setStatus({ tone: 'error', message: 'Anki endpoint, deck, and note type are required.' })
      return
    }
    const requiredFields = [
      ['sentence', 'Sentence'],
      ['audio', 'Audio'],
      ['reading', 'Reading'],
      ['translation', 'Translation']
    ] as const
    for (const [key, label] of requiredFields) {
      if (!anki.fields[key].trim()) {
        setStatus({ tone: 'error', message: `The ${label} field mapping is required.` })
        return
      }
    }

    const patch: SettingsPatch = {
      transcription: {
        endpoint: transcription.endpoint,
        model: transcription.model,
        language: transcription.language,
        ...(clearTranscriptionKey
          ? { apiKey: null }
          : transcriptionKey.trim()
            ? { apiKey: transcriptionKey }
            : {})
      },
      translation: {
        endpoint: translation.endpoint,
        model: translation.model,
        temperature: translation.temperature,
        customInstructions: translation.customInstructions,
        ...(clearTranslationKey
          ? { apiKey: null }
          : translationKey.trim()
            ? { apiKey: translationKey }
            : {})
      },
      anki: {
        endpoint: anki.endpoint,
        deck: anki.deck,
        noteType: anki.noteType,
        fields: anki.fields
      },
      audio: { paddingMs }
    }

    setBusy('save')
    try {
      const updated = await window.api.saveSettings(patch)
      onSaved(updated)
    } catch (error) {
      setStatus({ tone: 'error', message: `${messageOf(error)}${detailOf(error)}` })
    } finally {
      setBusy(null)
    }
  }

  const testAnki = async (): Promise<void> => {
    setStatus(null)
    setBusy('anki')
    try {
      const result = await window.api.testAnki(anki)
      if (result.connected) {
        setStatus({ tone: 'ok', message: `Connected to AnkiConnect (version ${result.version ?? 'unknown'}).` })
      } else {
        setStatus({ tone: 'error', message: result.error ?? 'Could not connect to AnkiConnect.' })
      }
    } catch (error) {
      setStatus({ tone: 'error', message: `${messageOf(error)}${detailOf(error)}` })
    } finally {
      setBusy(null)
    }
  }

  const loadCatalog = async (): Promise<void> => {
    setStatus(null)
    setBusy('catalog')
    try {
      const result = await window.api.getAnkiCatalog(anki)
      setCatalog(result)
      setStatus({ tone: 'ok', message: `Loaded ${result.decks.length} decks and ${result.models.length} note types.` })
    } catch (error) {
      setStatus({ tone: 'error', message: `${messageOf(error)}${detailOf(error)}` })
    } finally {
      setBusy(null)
    }
  }

  const loadFields = async (): Promise<void> => {
    setStatus(null)
    setBusy('fields')
    try {
      const fields = await window.api.getModelFields(anki.noteType, anki)
      setModelFields(fields)
      setAnki((previous) => ({
        ...previous,
        fields: {
          sentence: guessField(fields, ['sentence', 'japanese', 'expression', 'front'], previous.fields.sentence),
          audio: guessField(fields, ['audio', 'sound', 'voice'], previous.fields.audio),
          reading: guessField(fields, ['reading', 'hiragana', 'furigana', 'kana'], previous.fields.reading),
          translation: guessField(
            fields,
            ['translation', 'english', 'meaning', 'back'],
            previous.fields.translation
          ),
          notes: guessField(
            fields,
            ['notes', 'note', 'explanation', 'vocabulary', 'grammar'],
            previous.fields.notes
          )
        }
      }))
      setStatus({
        tone: 'ok',
        message: fields.length > 0 ? `Found ${fields.length} fields on "${anki.noteType}".` : 'No fields found.'
      })
    } catch (error) {
      setStatus({ tone: 'error', message: `${messageOf(error)}${detailOf(error)}` })
    } finally {
      setBusy(null)
    }
  }

  const testTranslation = async (): Promise<void> => {
    setStatus(null)
    setBusy('translation')
    try {
      const result = await window.api.testTranslation()
      setStatus({ tone: 'ok', message: `Translation test: ${result.sample}` })
    } catch (error) {
      setStatus({ tone: 'error', message: `${messageOf(error)}${detailOf(error)}` })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header settings-header">
          <div>
            <p className="eyebrow">Configuration</p>
            <h2>Settings</h2>
          </div>
          <button className="icon-button soft" onClick={onClose} aria-label="Close settings">
            <CloseIcon width={18} height={18} />
          </button>
        </div>

        <div className="settings-scroll">
          <section className="settings-section">
            <div className="section-title">
              <span className="section-number">01</span>
              <div>
                <h3>Transcription</h3>
                <p>OpenAI-compatible audio transcription endpoint.</p>
              </div>
            </div>
            <div className="settings-grid">
              <label className="field span-2">
                <span className="field-label">Endpoint</span>
                <input
                  value={transcription.endpoint}
                  onChange={(event) =>
                    setTranscription((previous) => ({ ...previous, endpoint: event.target.value }))
                  }
                  placeholder="https://host/v1/audio/transcriptions"
                />
              </label>
              <label className="field">
                <span className="field-label">Model</span>
                <input
                  value={transcription.model}
                  onChange={(event) =>
                    setTranscription((previous) => ({ ...previous, model: event.target.value }))
                  }
                />
              </label>
              <label className="field">
                <span className="field-label">Language</span>
                <input
                  value={transcription.language}
                  onChange={(event) =>
                    setTranscription((previous) => ({ ...previous, language: event.target.value }))
                  }
                />
              </label>
              <label className="field span-2">
                <span className="field-label">
                  API key
                  <em className="field-hint">
                    {clearTranscriptionKey
                      ? 'will be cleared on save'
                      : settings.transcription.apiKeySet
                        ? 'saved securely · leave blank to keep'
                        : 'optional'}
                  </em>
                </span>
                <input
                  type="password"
                  value={transcriptionKey}
                  onChange={(event) => {
                    setTranscriptionKey(event.target.value)
                    setClearTranscriptionKey(false)
                  }}
                  placeholder={settings.transcription.apiKeySet ? '••••••••••••' : 'Optional bearer token'}
                  autoComplete="off"
                />
              </label>
            </div>
            {settings.transcription.apiKeySet ? (
              <button
                className="link-button danger-link"
                onClick={() => {
                  setClearTranscriptionKey((value) => !value)
                  setTranscriptionKey('')
                }}
              >
                {clearTranscriptionKey ? 'Keep existing key' : 'Clear saved key'}
              </button>
            ) : null}
          </section>

          <section className="settings-section">
            <div className="section-title">
              <span className="section-number">02</span>
              <div>
                <h3>Translation</h3>
                <p>Any OpenAI-compatible chat completions endpoint.</p>
              </div>
            </div>
            <div className="settings-grid">
              <label className="field span-2">
                <span className="field-label">Endpoint</span>
                <input
                  value={translation.endpoint}
                  onChange={(event) =>
                    setTranslation((previous) => ({ ...previous, endpoint: event.target.value }))
                  }
                  placeholder="https://api.openai.com/v1"
                />
              </label>
              <label className="field">
                <span className="field-label">Model</span>
                <input
                  value={translation.model}
                  onChange={(event) =>
                    setTranslation((previous) => ({ ...previous, model: event.target.value }))
                  }
                  placeholder="gpt-4o-mini"
                />
              </label>
              <label className="field">
                <span className="field-label">
                  API key
                  <em className="field-hint">
                    {clearTranslationKey
                      ? 'will be cleared on save'
                      : settings.translation.apiKeySet
                        ? 'saved securely'
                        : 'optional'}
                  </em>
                </span>
                <input
                  type="password"
                  value={translationKey}
                  onChange={(event) => {
                    setTranslationKey(event.target.value)
                    setClearTranslationKey(false)
                  }}
                  placeholder={settings.translation.apiKeySet ? '••••••••••••' : 'API key'}
                  autoComplete="off"
                />
              </label>
              <label className="field">
                <span className="field-label">
                  Temperature
                  <em className="field-hint">lower is more consistent</em>
                </span>
                <input
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={translation.temperature}
                  onChange={(event) =>
                    setTranslation((previous) => ({
                      ...previous,
                      temperature: Number(event.target.value)
                    }))
                  }
                />
              </label>
              <label className="field span-2">
                <span className="field-label">
                  Custom translation instructions
                  <em className="field-hint">optional</em>
                </span>
                <textarea
                  rows={2}
                  value={translation.customInstructions}
                  placeholder="Example: Use natural conversational American English. Keep honorifics. Avoid literal translations of set phrases."
                  onChange={(event) =>
                    setTranslation((previous) => ({
                      ...previous,
                      customInstructions: event.target.value
                    }))
                  }
                />
              </label>
            </div>
            <div className="section-actions">
              {settings.translation.apiKeySet ? (
                <button
                  className="link-button danger-link"
                  onClick={() => {
                    setClearTranslationKey((value) => !value)
                    setTranslationKey('')
                  }}
                >
                  {clearTranslationKey ? 'Keep existing key' : 'Clear saved key'}
                </button>
              ) : (
                <span />
              )}
              <button className="button secondary small" onClick={testTranslation} disabled={busy !== null}>
                <SparklesIcon width={15} height={15} />
                {busy === 'translation' ? 'Testing…' : 'Test saved translation'}
              </button>
            </div>
          </section>

          <section className="settings-section">
            <div className="section-title">
              <span className="section-number">03</span>
              <div>
                <h3>AnkiConnect</h3>
                <p>
                  Requires the AnkiConnect add-on (code <code>2055492159</code>) while Anki is open.
                </p>
              </div>
            </div>
            <div className="settings-grid">
              <label className="field span-2">
                <span className="field-label">AnkiConnect endpoint</span>
                <input value={anki.endpoint} onChange={(event) => setAnki({ ...anki, endpoint: event.target.value })} />
              </label>
              <label className="field">
                <span className="field-label">Deck</span>
                <input
                  list="anki-decks"
                  value={anki.deck}
                  onChange={(event) => setAnki({ ...anki, deck: event.target.value })}
                />
                <datalist id="anki-decks">
                  {catalog?.decks.map((deck) => <option key={deck} value={deck} />)}
                </datalist>
              </label>
              <label className="field">
                <span className="field-label">Note type</span>
                <input
                  list="anki-models"
                  value={anki.noteType}
                  onChange={(event) => setAnki({ ...anki, noteType: event.target.value })}
                />
                <datalist id="anki-models">
                  {catalog?.models.map((model) => <option key={model} value={model} />)}
                </datalist>
              </label>
            </div>

            <div className="field-mapping">
              <div className="mapping-heading">
                <span className="field-label">Field mapping</span>
                <button className="link-button" onClick={loadFields} disabled={busy !== null}>
                  <RefreshIcon width={13} height={13} />
                  {busy === 'fields' ? 'Loading…' : 'Load fields from Anki'}
                </button>
              </div>
              <div className="mapping-grid">
                {(
                  [
                    ['sentence', 'Japanese'],
                    ['audio', 'Audio'],
                    ['reading', 'Reading'],
                    ['translation', 'Translation'],
                    ['notes', 'Notes (optional)']
                  ] as const
                ).map(([key, label]) => (
                  <label className="field" key={key}>
                    <span className="field-label">{label}</span>
                    <input
                      list="anki-fields"
                      value={anki.fields[key]}
                      onChange={(event) => setField(key, event.target.value)}
                    />
                  </label>
                ))}
              </div>
              <datalist id="anki-fields">
                {modelFields.map((field) => <option key={field} value={field} />)}
              </datalist>
            </div>

            <div className="section-actions">
              <button className="button secondary small" onClick={testAnki} disabled={busy !== null}>
                {busy === 'anki' ? 'Checking…' : 'Test connection'}
              </button>
              <button className="button ghost small" onClick={loadCatalog} disabled={busy !== null}>
                {busy === 'catalog' ? 'Loading…' : 'Load decks & note types'}
              </button>
            </div>
          </section>

          <section className="settings-section">
            <div className="section-title">
              <span className="section-number">04</span>
              <div>
                <h3>Audio clips</h3>
                <p>Audio padding around each sentence when saving to Anki.</p>
              </div>
            </div>
            <label className="field padding-field">
              <span className="field-label">
                Padding
                <em className="field-hint">{paddingMs} ms</em>
              </span>
              <input
                type="range"
                min={0}
                max={1000}
                step={25}
                value={paddingMs}
                onChange={(event) => setPaddingMs(Number(event.target.value))}
              />
            </label>
          </section>

          {status ? (
            <div className={`inline-alert ${status.tone === 'ok' ? 'ok' : status.tone === 'error' ? 'error' : 'info'}`}>
              {status.tone === 'ok' ? <CheckIcon width={17} height={17} /> : <WarningIcon width={17} height={17} />}
              <span>{status.message}</span>
            </div>
          ) : null}
        </div>

        <div className="modal-actions settings-footer">
          <button className="button ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" onClick={save} disabled={busy !== null}>
            {busy === 'save' ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </div>
    </div>
  )
}
