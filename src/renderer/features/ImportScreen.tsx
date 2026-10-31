import { useRef, useState } from 'react'
import type { UiError } from '../App'
import { ArrowRightIcon, SparklesIcon, UploadIcon } from '../components/Icons'

interface Props {
  onImport: (filePath?: string) => void
  error: UiError | null
  onDismissError: () => void
}

export default function ImportScreen({ onImport, error, onDismissError }: Props): React.JSX.Element {
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)

  return (
    <div className="import-screen">
      <section className="hero">
        <p className="eyebrow">
          <SparklesIcon width={15} height={15} />
          Local-first Japanese study workflow
        </p>
        <h1>
          Turn Japanese audio into
          <br />
          <em>cards you will remember.</em>
        </h1>
        <p className="hero-copy">
          Import a recording, review the transcript sentence by sentence, and send clean cards to
          Anki with the original audio attached.
        </p>
      </section>

      <button
        className={`drop-zone ${dragging ? 'dragging' : ''}`}
        onClick={() => onImport()}
        onDragEnter={(event) => {
          event.preventDefault()
          dragDepth.current += 1
          setDragging(true)
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          event.preventDefault()
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (dragDepth.current === 0) setDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          dragDepth.current = 0
          setDragging(false)
          const file = event.dataTransfer.files[0]
          if (!file) return
          const path = window.api.pathForFile(file)
          onImport(path)
        }}
      >
        <span className="drop-zone-icon">
          <UploadIcon width={28} height={28} />
        </span>
        <span className="drop-zone-title">Drop an audio file here</span>
        <span className="drop-zone-sub">or click to choose M4A, MP3, WAV, FLAC, OGG, or WebM</span>
      </button>

      {error ? (
        <div className="error-card inline">
          <div>
            <strong>{error.message}</strong>
            {error.detail ? <pre>{error.detail}</pre> : null}
          </div>
          <button className="button ghost small" onClick={onDismissError}>
            Dismiss
          </button>
        </div>
      ) : null}

      <section className="workflow-strip">
        {[
          ['01', 'Import', 'Your original file is preserved, locally.'],
          ['02', 'Review', 'Edit every sentence. Original text stays intact.'],
          ['03', 'Generate', 'Hiragana and natural English, both editable.'],
          ['04', 'Export', 'Add to Anki with per-sentence audio clips.']
        ].map(([number, title, copy]) => (
          <div className="workflow-step" key={number}>
            <span>{number}</span>
            <h3>{title}</h3>
            <p>{copy}</p>
          </div>
        ))}
      </section>

      <div className="hero-footnote">
        <span>Transcription by kotoba-whisper</span>
        <ArrowRightIcon width={14} height={14} />
        <span>Hiragana by Kuromoji</span>
        <ArrowRightIcon width={14} height={14} />
        <span>Cards by AnkiConnect</span>
      </div>
    </div>
  )
}
