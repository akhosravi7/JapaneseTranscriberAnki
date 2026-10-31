import { useCallback, useEffect, useRef, useState } from 'react'
import type { ImportedAudio, RecordingSource } from '@shared/types'
import { formatSeconds } from '@shared/urls'
import { CloseIcon, MicrophoneIcon, ScreenIcon, StopIcon, WarningIcon } from './Icons'

interface Props {
  source: RecordingSource
  onClose: () => void
  onSaved: (audio: ImportedAudio) => void
}

type Status = 'starting' | 'recording' | 'saving' | 'error'

const SOURCE_COPY: Record<
  RecordingSource,
  { title: string; description: string; hint: string }
> = {
  microphone: {
    title: 'Record microphone',
    description: 'Speak, or play audio near this Mac.',
    hint: 'macOS may ask for microphone access the first time.'
  },
  system: {
    title: 'Capture screen audio',
    description: 'Record audio playing in apps, videos, or browser tabs.',
    hint: 'macOS only shows the system-audio prompt when Kotoba Cards is the app requesting it. If recording fails, quit and reopen the app from Finder. In development, use npm run dev:system-audio instead of npm run dev.'
  }
}

function recordingMimeType(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
  return candidates.find((type) => MediaRecorder.isTypeSupported(type))
}

function trackEnded(track: MediaStreamTrack): boolean {
  return track.readyState === 'ended'
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export default function RecordDialog({ source, onClose, onSaved }: Props): React.JSX.Element {
  const [status, setStatus] = useState<Status>('starting')
  const [error, setError] = useState<string | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [level, setLevel] = useState(0)
  const [needsPermission, setNeedsPermission] = useState(false)
  const [copiedPath, setCopiedPath] = useState(false)

  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const startedAtRef = useRef(0)
  const saveIntentRef = useRef(false)
  const runRef = useRef(0)

  const cleanup = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop()
      } catch {
        // Recording is already stopping.
      }
    }
    recorderRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    analyserRef.current = null
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => undefined)
      audioContextRef.current = null
    }
  }, [])

  const startRecording = useCallback(async (runId: number) => {
    const stale = (): boolean => runRef.current !== runId
    try {
      setNeedsPermission(false)
      let stream: MediaStream

      if (source === 'microphone') {
        const granted = await window.api.requestMicrophoneAccess()
        if (!granted) {
          throw new Error(
            'Microphone access was denied. Allow Kotoba Cards in System Settings → Privacy & Security → Microphone, then try again.'
          )
        }
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          },
          video: false
        })
      } else {
        const status = await window.api.getScreenAudioStatus()
        if (stale()) return
        if (!status.available) {
          setNeedsPermission(true)
          throw new Error(
            `${status.error ?? 'Screen capture is not available.'} Quit Kotoba Cards and reopen it from Finder so macOS asks the app—not Terminal—for system-audio access. In development, run npm run dev:system-audio.`
          )
        }
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      }

      if (stale()) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      if (source === 'system') {
        const audio = stream.getAudioTracks()[0]
        if (!audio) {
          stream.getTracks().forEach((track) => track.stop())
          setNeedsPermission(true)
          throw new Error(
            'macOS did not grant system audio. Quit Kotoba Cards and reopen it from Finder so macOS asks the app—not Terminal—for access, then allow the “System Audio Recording” prompt. In development, run npm run dev:system-audio.'
          )
        }
        const endedOnArrival = trackEnded(audio)
        for (const video of stream.getVideoTracks()) {
          video.stop()
          stream.removeTrack(video)
        }
        if (endedOnArrival || trackEnded(audio)) {
          stream.getTracks().forEach((track) => track.stop())
          setNeedsPermission(true)
          throw new Error(
            'macOS provided a silent system-audio track. Quit Kotoba Cards and reopen it from Finder (not Terminal), then allow the “System Audio Recording” prompt. In development, run npm run dev:system-audio.'
          )
        }
      }

      streamRef.current = stream
      const recordStream = stream

      const audioContext = new AudioContext()
      audioContextRef.current = audioContext
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 1024
      audioContext.createMediaStreamSource(recordStream).connect(analyser)
      analyserRef.current = analyser
      const samples = new Uint8Array(analyser.fftSize)
      const drawLevel = (): void => {
        if (stale()) return
        analyser.getByteTimeDomainData(samples)
        let peak = 0
        for (let index = 0; index < samples.length; index += 1) {
          const value = Math.abs(samples[index] - 128) / 128
          if (value > peak) peak = value
        }
        setLevel(peak)
        rafRef.current = requestAnimationFrame(drawLevel)
      }
      rafRef.current = requestAnimationFrame(drawLevel)

      const mimeType = recordingMimeType()
      const recorder = new MediaRecorder(
        recordStream,
        mimeType ? { mimeType, audioBitsPerSecond: 128000 } : undefined
      )
      recorderRef.current = recorder
      chunksRef.current = []

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }

      recorder.onerror = () => {
        if (stale()) return
        setStatus('error')
        setError('The recording stopped unexpectedly. Try again.')
        cleanup()
      }

      recorder.onstop = () => {
        cleanup()
        if (!saveIntentRef.current) return

        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || mimeType || 'audio/webm'
        })
        chunksRef.current = []
        if (blob.size === 0) {
          if (!stale()) {
            setStatus('error')
            setError('The recording was empty. Try recording again.')
          }
          return
        }

        if (!stale()) setStatus('saving')
        void blob
          .arrayBuffer()
          .then((buffer) =>
            window.api.saveRecording({
              data: new Uint8Array(buffer),
              mimeType: blob.type,
              source
            })
          )
          .then((imported) => {
            if (!stale()) onSaved(imported)
          })
          .catch((saveError: unknown) => {
            if (stale()) return
            setStatus('error')
            setError(errorMessage(saveError))
          })
      }

      recorder.start(1000)
      startedAtRef.current = Date.now()
      setStatus('recording')
      timerRef.current = window.setInterval(() => {
        if (!stale()) setElapsedMs(Date.now() - startedAtRef.current)
      }, 200)
    } catch (startError) {
      cleanup()
      if (stale()) return
      if (source === 'system') setNeedsPermission(true)
      setStatus('error')
      setError(errorMessage(startError))
    }
  }, [cleanup, onSaved, source])

  useEffect(() => {
    const runId = ++runRef.current
    void startRecording(runId)
    return () => {
      runRef.current += 1
      saveIntentRef.current = false
      cleanup()
    }
  }, [cleanup, startRecording])

  const stopRecording = (): void => {
    saveIntentRef.current = true
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    } else {
      cleanup()
    }
  }

  const cancel = (): void => {
    saveIntentRef.current = false
    cleanup()
    onClose()
  }

  const copy = SOURCE_COPY[source]
  const busy = status === 'starting' || status === 'saving'

  return (
    <div className="modal-backdrop" onMouseDown={status === 'recording' ? undefined : cancel}>
      <div
        className="record-modal"
        role="dialog"
        aria-modal="true"
        aria-label={copy.title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">{source === 'system' ? 'Screen capture' : 'Microphone'}</p>
            <h2>{status === 'saving' ? 'Saving recording…' : copy.title}</h2>
          </div>
          <button className="icon-button soft" onClick={cancel} aria-label="Close" disabled={status === 'saving'}>
            <CloseIcon width={17} height={17} />
          </button>
        </div>

        <div className="record-body">
          {status === 'error' ? (
            <div className="inline-alert error compact-alert">
              <WarningIcon width={17} height={17} />
              <span>{error}</span>
            </div>
          ) : (
            <>
              <div className={`record-orb ${status}`}>
                {source === 'system' ? (
                  <ScreenIcon width={28} height={28} />
                ) : (
                  <MicrophoneIcon width={28} height={28} />
                )}
              </div>
              <p className="record-timer">{formatSeconds(elapsedMs / 1000)}</p>
              <div className="record-levels" aria-hidden="true">
                {[0.55, 0.9, 0.7, 1, 0.62, 0.82, 0.48].map((weight, index) => (
                  <span
                    key={index}
                    style={{ height: `${8 + level * weight * 46}px`, opacity: status === 'recording' ? 1 : 0.45 }}
                  />
                ))}
              </div>
              <p className="record-copy">{status === 'starting' ? 'Waiting for permission…' : copy.description}</p>
              {source === 'system' && status !== 'starting' ? (
                <p className="record-hint">{copy.hint}</p>
              ) : null}
            </>
          )}
        </div>

        <div className="modal-actions record-actions">
          <button className="button ghost" onClick={cancel} disabled={status === 'saving'}>
            {status === 'error' ? 'Close' : 'Cancel'}
          </button>
          {status === 'error' && source === 'system' && needsPermission ? (
            <>
              <button
                className="button secondary"
                onClick={() => void window.api.openScreenAudioSettings()}
              >
                Open System Settings
              </button>
              <button
                className="button ghost"
                onClick={() => {
                  void window.api.copyAppBundlePath().then(() => {
                    setCopiedPath(true)
                    setTimeout(() => setCopiedPath(false), 2500)
                  })
                }}
              >
                {copiedPath ? 'App path copied' : 'Copy App Path'}
              </button>
            </>
          ) : null}
          {status === 'error' ? (
            <button
              className="button primary"
              onClick={() => {
                setError(null)
                setElapsedMs(0)
                setLevel(0)
                setNeedsPermission(false)
                setCopiedPath(false)
                setStatus('starting')
                void startRecording(++runRef.current)
              }}
            >
              Try again
            </button>
          ) : (
            <button
              className="button primary"
              onClick={stopRecording}
              disabled={busy}
            >
              {status === 'saving' ? (
                'Saving…'
              ) : (
                <>
                  <StopIcon width={15} height={15} />
                  Stop &amp; transcribe
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
