import { useEffect, useMemo, useRef } from "react"

type AuthenticatorProps = {
  title: string
  description: string
  qrDataUrl?: string | null
  setupKey?: string
  onSetupKeyChange?: (value: string) => void
  onGenerateQr?: () => void
  generatingQr?: boolean
  manualKey?: string | null
  code: string
  onCodeChange: (code: string) => void
  onSubmitCode: () => void
  busy?: boolean
  codeError?: string
}

const CODE_LENGTH = 6

const normalizeCode = (value: string): string => value.replace(/\D/g, "").slice(0, CODE_LENGTH)

export const Authenticator = ({
  title,
  description,
  qrDataUrl,
  setupKey,
  onSetupKeyChange,
  onGenerateQr,
  generatingQr,
  manualKey,
  code,
  onCodeChange,
  onSubmitCode,
  busy,
  codeError,
}: AuthenticatorProps) => {
  const refs = useRef<Array<HTMLInputElement | null>>([])
  const lastAutoSubmit = useRef<string>("")

  const digits = useMemo(() => {
    const normalized = normalizeCode(code)
    return Array.from({ length: CODE_LENGTH }, (_unused, index) => normalized[index] ?? "")
  }, [code])

  useEffect(() => {
    const normalized = normalizeCode(code)
    if (normalized.length === CODE_LENGTH && !busy && normalized !== lastAutoSubmit.current) {
      lastAutoSubmit.current = normalized
      onSubmitCode()
    }
  }, [busy, code, onSubmitCode])

  useEffect(() => {
    if (normalizeCode(code).length < CODE_LENGTH) {
      lastAutoSubmit.current = ""
    }
  }, [code])

  const updateAt = (index: number, value: string): void => {
    const single = normalizeCode(value).slice(-1)
    const next = [...digits]
    next[index] = single
    const merged = next.join("")
    onCodeChange(merged)
    if (single && index < CODE_LENGTH - 1) {
      refs.current[index + 1]?.focus()
    }
  }

  const onBackspace = (index: number): void => {
    if (digits[index] && digits[index].length > 0) {
      const next = [...digits]
      next[index] = ""
      onCodeChange(next.join(""))
      return
    }
    if (index > 0) {
      refs.current[index - 1]?.focus()
      const next = [...digits]
      next[index - 1] = ""
      onCodeChange(next.join(""))
    }
  }

  const handlePaste = (value: string): void => {
    const pasted = normalizeCode(value)
    if (!pasted) {
      return
    }
    onCodeChange(pasted)
    const focusIndex = Math.min(CODE_LENGTH - 1, pasted.length)
    refs.current[focusIndex]?.focus()
  }

  return (
    <main className="auth-shell">
      <section className="auth-card auth-card-wide">
        <h1>{title}</h1>
        <p>{description}</p>

        {onGenerateQr && onSetupKeyChange ? (
          <div className="auth-form auth-inline">
            <label>
              Setup Key
              <input
                value={setupKey ?? ""}
                onChange={(event) => onSetupKeyChange(event.target.value)}
                placeholder="DASHBOARD_SETUP_KEY"
              />
            </label>
            <button type="button" onClick={onGenerateQr} disabled={generatingQr}>
              {generatingQr ? "Generating..." : "Generate QR"}
            </button>
          </div>
        ) : null}

        {qrDataUrl ? <img src={qrDataUrl} alt="Authenticator QR" className="auth-qr" /> : null}
        {manualKey ? <p className="auth-manual">Manual key: {manualKey}</p> : null}

        <p className="auth-helper">Input Google Authenticator code</p>
        <div className="otp-row" onPaste={(event) => handlePaste(event.clipboardData.getData("text"))}>
          {digits.map((digit, index) => (
            <input
              key={index}
              ref={(node) => {
                refs.current[index] = node
              }}
              className={`otp-box ${codeError ? "otp-box-error" : ""}`}
              value={digit}
              inputMode="numeric"
              maxLength={1}
              onChange={(event) => updateAt(index, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Backspace") {
                  event.preventDefault()
                  onBackspace(index)
                }
                if (event.key === "ArrowLeft" && index > 0) {
                  refs.current[index - 1]?.focus()
                }
                if (event.key === "ArrowRight" && index < CODE_LENGTH - 1) {
                  refs.current[index + 1]?.focus()
                }
              }}
            />
          ))}
        </div>

        {codeError ? <p className="error">{codeError}</p> : null}
      </section>
    </main>
  )
}
