import type { CardSegment } from '@shared/types'
import AudioPlayer from '../components/AudioPlayer'

interface Props {
  segment: CardSegment
  mediaUrl: string
  showNotes: boolean
}

export default function CardPreview({ segment, mediaUrl, showNotes }: Props): React.JSX.Element {
  const scaffold = segment.reading ? '' : 'Preview appears here as you generate content.'

  return (
    <div className="card-preview">
      <div className="preview-heading">
        <span>Card preview</span>
        <span className="preview-badge">{segment.status === 'added' ? 'In Anki' : 'Draft'}</span>
      </div>

      <div className="anki-card front">
        <span className="card-side-label">Front</span>
        <p className="card-japanese">{segment.japanese.trim() || 'Japanese sentence'}</p>
        {scaffold ? <p className="card-scaffold">{scaffold}</p> : null}
        <AudioPlayer compact src={mediaUrl} startSec={segment.startSec} endSec={segment.endSec} />
      </div>

      <div className="anki-card back">
        <span className="card-side-label">Back</span>
        <p className={`card-reading ${segment.reading ? '' : 'placeholder'}`}>
          {segment.reading.trim() || 'ひらがな reading'}
        </p>
        <div className="answer-rule" />
        <p className={`card-translation ${segment.translation ? '' : 'placeholder'}`}>
          {segment.translation.trim() || 'English translation'}
        </p>
        {showNotes && segment.notes.trim() ? <p className="card-notes">{segment.notes}</p> : null}
      </div>
    </div>
  )
}
