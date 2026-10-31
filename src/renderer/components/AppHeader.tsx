import { LogoIcon, SettingsIcon } from './Icons'

interface Props {
  ankiOnline: boolean | null
  hasAudio: boolean
  onOpenSettings: () => void
}

export default function AppHeader({ ankiOnline, hasAudio, onOpenSettings }: Props): React.JSX.Element {
  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand-mark">
          <LogoIcon width={30} height={30} />
        </span>
        <div>
          <h1>Kotoba Cards</h1>
          <p>Japanese audio → Anki</p>
        </div>
      </div>

      <div className="header-actions no-drag">
        {hasAudio ? (
          <span className={`status-pill ${ankiOnline ? 'online' : ankiOnline === false ? 'offline' : 'checking'}`}>
            <span className="status-dot" />
            {ankiOnline === null ? 'Checking Anki' : ankiOnline ? 'Anki connected' : 'Anki offline'}
          </span>
        ) : null}
        <button className="icon-button" onClick={onOpenSettings} title="Settings" aria-label="Settings">
          <SettingsIcon />
        </button>
      </div>
    </header>
  )
}
