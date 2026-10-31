import { useEffect, useState } from 'react'
import type { CardSegment, ProofreadResult } from '@shared/types'
import { formatSeconds } from '@shared/urls'
import { CheckIcon, RefreshIcon, SparklesIcon, WarningIcon } from '../components/Icons'

interface Props {
  segment: CardSegment
  showNotes: boolean
  generating: boolean
  adding: boolean
  previousText?: string
  nextText?: string
  onUpdate: (id: string, patch: Partial<CardSegment>) => void
  onGenerate: (segment: CardSegment) => void
  onAdd: (segment: CardSegment) => void
}

export default function SentenceEditor({
  segment,
  showNotes,
  generating,
  adding,
  previousText,
  nextText,
  onUpdate,
  onGenerate,
  onAdd
}: Props): React.JSX.Element {
  const [proofreading, setProofreading] = useState(false)
  const [suggestion, setSuggestion] = useState<ProofreadResult | null>(null)
  const [proofreadNotice, setProofreadNotice] = useState<string | null>(null)
  const [proofreadError, setProofreadError] = useState<string | null>(null)

  useEffect(() => {
    setSuggestion(null)
    setProofreadNotice(null)
    setProofreadError(null)
  }, [segment.id])

  const runProofread = async (): Promise<void> => {
    setProofreading(true)
    setSuggestion(null)
    setProofreadNotice(null)
    setProofreadError(null)
    try {
      const result = await window.api.proofreadJapanese({
        text: segment.japanese,
        context: { previous: previousText, next: nextText }
      })
      if (result.corrected.trim() === segment.japanese.trim()) {
        setProofreadNotice('No obvious transcription errors found.')
      } else {
        setSuggestion(result)
      }
    } catch (error) {
      setProofreadError(error instanceof Error ? error.message : String(error))
    } finally {
      setProofreading(false)
    }
  }

  const edited = segment.japanese !== segment.japaneseOriginal
  const readingStale =
    Boolean(segment.reading.trim()) &&
    segment.readingSource !== undefined &&
    segment.readingSource.trim() !== segment.japanese.trim()
  const translationStale =
    Boolean(segment.translation.trim()) &&
    segment.translationSource !== undefined &&
    segment.translationSource.trim() !== segment.japanese.trim()
  const current = !readingStale && !translationStale
  const complete = Boolean(segment.japanese.trim() && segment.reading.trim() && segment.translation.trim()) && current
  const addTitle = !segment.japanese.trim()
    ? 'Add a Japanese sentence first'
    : !segment.reading.trim() || !segment.translation.trim()
      ? 'Add a reading and translation first'
      : !current
        ? 'Regenerate the reading and translation for the corrected sentence'
        : 'Add this card to Anki'

  return (
    <div className="sentence-editor">
      <div className="editor-heading">
        <div>
          <p className="eyebrow">Review sentence</p>
          <h2>
            {formatSeconds(segment.startSec)} – {formatSeconds(segment.endSec)}
            <span className={`mini-status ${segment.status}`}>{segment.status}</span>
          </h2>
        </div>
        <div className="editor-actions">
          <button
            className="button secondary"
            onClick={() => onGenerate(segment)}
            disabled={generating || !segment.japanese.trim()}
          >
            <SparklesIcon width={16} height={16} />
            {generating ? 'Generating…' : 'Generate'}
          </button>
          <button
            className="button primary"
            onClick={() => onAdd(segment)}
            disabled={adding || generating || !complete || segment.status === 'added'}
            title={addTitle}
          >
            {segment.status === 'added' ? (
              <>
                <CheckIcon width={16} height={16} /> Added to Anki
              </>
            ) : adding ? (
              'Adding…'
            ) : (
              'Add to Anki'
            )}
          </button>
        </div>
      </div>

      {segment.error ? (
        <div className="inline-alert error">
          <WarningIcon width={17} height={17} />
          <span>{segment.error}</span>
          <button className="link-button" onClick={() => onGenerate(segment)}>
            <RefreshIcon width={14} height={14} /> Retry
          </button>
        </div>
      ) : null}

      <div className="editor-layout">
        <div className="editor-fields">
          <div className="field">
            <span className="field-label">
              Japanese
              {edited ? <em className="edited-flag">edited</em> : null}
              <button
                type="button"
                className="link-button proofread-button"
                onClick={() => void runProofread()}
                disabled={proofreading || generating || !segment.japanese.trim()}
              >
                <SparklesIcon width={13} height={13} />
                {proofreading ? 'Checking…' : 'Proofread'}
              </button>
            </span>
            <textarea
              value={segment.japanese}
              rows={3}
              spellCheck={false}
              className="japanese-input"
              onChange={(event) => {
                setSuggestion(null)
                setProofreadNotice(null)
                onUpdate(segment.id, { japanese: event.target.value })
              }}
            />
          </div>

          {proofreadError ? (
            <div className="inline-alert error compact-alert">
              <WarningIcon width={16} height={16} />
              <span>{proofreadError}</span>
            </div>
          ) : null}

          {proofreadNotice ? (
            <div className="inline-alert ok compact-alert">
              <CheckIcon width={16} height={16} />
              <span>{proofreadNotice}</span>
            </div>
          ) : null}

          {suggestion ? (
            <div className="suggestion-card">
              <div className="suggestion-heading">
                <div>
                  <span className="field-label">Suggested transcription correction</span>
                  <p lang="ja" className="suggestion-text">
                    {suggestion.corrected}
                  </p>
                </div>
                <span className="suggestion-badge">AI review</span>
              </div>
              {suggestion.changes.length > 0 ? (
                <ul className="suggestion-changes">
                  {suggestion.changes.map((change, index) => (
                    <li key={`${change.before}-${index}`}>
                      <span lang="ja">{change.before}</span>
                      <span className="change-arrow">→</span>
                      <span lang="ja">{change.after}</span>
                      {change.reason ? <em>{change.reason}</em> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="suggestion-actions">
                <p>The original transcription will not be changed unless you apply this.</p>
                <div>
                  <button className="button ghost small" onClick={() => setSuggestion(null)}>
                    Ignore
                  </button>
                  <button
                    className="button primary small"
                    onClick={() => {
                      onUpdate(segment.id, { japanese: suggestion.corrected })
                      setSuggestion(null)
                    }}
                  >
                    Apply correction
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {edited ? (
            <div className="original-note">
              <div>
                <span className="field-label">Original transcription</span>
                <p lang="ja">{segment.japaneseOriginal}</p>
              </div>
              <button
                className="link-button"
                onClick={() => onUpdate(segment.id, { japanese: segment.japaneseOriginal })}
              >
                Restore
              </button>
            </div>
          ) : null}

          <label className="field">
            <span className="field-label">
              Hiragana reading
              {readingStale ? <em className="stale-flag">out of date</em> : null}
            </span>
            <textarea
              value={segment.reading}
              rows={2}
              spellCheck={false}
              lang="ja"
              placeholder="Generate or type the hiragana reading"
              onChange={(event) =>
                onUpdate(segment.id, {
                  reading: event.target.value,
                  readingSource: segment.japanese
                })
              }
            />
          </label>

          <label className="field">
            <span className="field-label">
              English translation
              {translationStale ? <em className="stale-flag">out of date</em> : null}
            </span>
            <textarea
              value={segment.translation}
              rows={3}
              placeholder="Generate or type a natural English translation"
              onChange={(event) =>
                onUpdate(segment.id, {
                  translation: event.target.value,
                  translationSource: segment.japanese
                })
              }
            />
          </label>

          {showNotes ? (
            <label className="field">
              <span className="field-label">Vocabulary &amp; grammar notes</span>
              <textarea
                value={segment.notes}
                rows={3}
                placeholder="Optional explanations, collocations, or grammar notes"
                onChange={(event) => onUpdate(segment.id, { notes: event.target.value })}
              />
            </label>
          ) : null}
        </div>
      </div>
    </div>
  )
}
