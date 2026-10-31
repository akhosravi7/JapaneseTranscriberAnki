import { useEffect, useRef, useState } from 'react'
import { PauseIcon, PlayIcon } from '../components/Icons'
import { formatSeconds } from '@shared/urls'

interface Props {
  src: string
  startSec: number
  endSec: number
  compact?: boolean
}

export default function AudioPlayer({ src, startSec, endSec, compact = false }: Props): React.JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)

  const duration = Math.max(0.1, endSec - startSec)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.pause()
    setPlaying(false)
    setProgress(0)
    try {
      audio.currentTime = startSec
    } catch {
      // Metadata may not be loaded yet; timeupdate will correct this on play.
    }
  }, [src, startSec, endSec])

  const toggle = (): void => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
      setPlaying(false)
      return
    }
    if (audio.currentTime < startSec || audio.currentTime >= endSec - 0.02) {
      audio.currentTime = startSec
    }
    void audio.play().then(
      () => setPlaying(true),
      () => setPlaying(false)
    )
  }

  return (
    <div className={`audio-player ${compact ? 'compact' : ''}`}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(event) => {
          const audio = event.currentTarget
          if (audio.currentTime >= endSec) {
            audio.pause()
            setPlaying(false)
            setProgress(1)
            return
          }
          setProgress(Math.min(1, Math.max(0, (audio.currentTime - startSec) / duration)))
        }}
      />
      <button className="audio-button" onClick={toggle} aria-label={playing ? 'Pause audio' : 'Play audio'}>
        {playing ? <PauseIcon width={17} height={17} /> : <PlayIcon width={17} height={17} />}
      </button>
      <div className="audio-track" aria-hidden="true">
        <span style={{ width: `${progress * 100}%` }} />
      </div>
      <span className="audio-time">
        {formatSeconds(startSec)} – {formatSeconds(endSec)}
      </span>
    </div>
  )
}
