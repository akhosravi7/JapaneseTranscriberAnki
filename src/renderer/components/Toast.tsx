import { CheckIcon, WarningIcon } from './Icons'

export interface ToastMessage {
  id: number
  message: string
  tone: 'success' | 'warning' | 'info'
}

interface Props {
  toast: ToastMessage
  onDismiss: () => void
}

export default function Toast({ toast, onDismiss }: Props): React.JSX.Element {
  return (
    <button className={`toast ${toast.tone}`} onClick={onDismiss}>
      <span className="toast-icon">
        {toast.tone === 'success' ? <CheckIcon width={17} height={17} /> : <WarningIcon width={17} height={17} />}
      </span>
      <span>{toast.message}</span>
    </button>
  )
}
