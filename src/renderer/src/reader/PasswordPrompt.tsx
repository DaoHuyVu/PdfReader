import { useState } from 'react'
import { t } from '../../../shared/strings'
import type { PasswordReason } from './pdf'

interface PasswordPromptProps {
  reason: PasswordReason
  onSubmit(password: string): void
  onCancel(): void
}

export function PasswordPrompt({ reason, onSubmit, onCancel }: PasswordPromptProps) {
  const [password, setPassword] = useState('')
  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit(password)
        }}
      >
        <h2>{t.password.title}</h2>
        <p className={reason === 'incorrect' ? 'modal-error' : ''}>
          {reason === 'incorrect' ? t.password.incorrect : t.password.need}
        </p>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onCancel()
          }}
        />
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            {t.password.cancel}
          </button>
          <button type="submit">{t.password.ok}</button>
        </div>
      </form>
    </div>
  )
}
