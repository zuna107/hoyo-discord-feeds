import { useEffect, useState } from "react"
import { api } from "./api"
import { Authenticator } from "./components/Authenticator"
import { DashboardApp } from "./DashboardApp"

type AuthMode = "loading" | "disabled" | "setup" | "login" | "ready"

export const App = () => {
  const [mode, setMode] = useState<AuthMode>("loading")
  const [error, setError] = useState("")
  const [code, setCode] = useState("")
  const [setupKey, setSetupKey] = useState("")
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [manualKey, setManualKey] = useState<string | null>(null)
  const [codeError, setCodeError] = useState("")
  const [busy, setBusy] = useState(false)

  const bootstrap = async (): Promise<void> => {
    setBusy(true)
    setError("")
    try {
      const status = await api.authStatus()
      if (!status.authEnabled) {
        setMode("disabled")
        return
      }
      if (status.requiresSetup) {
        setMode("setup")
        return
      }
      const session = await api.authSession()
      if (session.valid) {
        setMode("ready")
        return
      }
      setMode("login")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Auth bootstrap failed")
      setMode("login")
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void bootstrap()
  }, [])

  const onStartSetup = async (): Promise<void> => {
    setBusy(true)
    setError("")
    setCodeError("")
    try {
      const data = await api.authSetupStart(setupKey)
      setQrDataUrl(data.qrDataUrl)
      setManualKey(data.manualKey)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start setup")
    } finally {
      setBusy(false)
    }
  }

  const onVerifySetup = async (): Promise<void> => {
    if (code.length !== 6) {
      setCodeError("Code must be 6 digits.")
      return
    }
    setBusy(true)
    setError("")
    setCodeError("")
    try {
      const data = await api.authSetupVerify(code)
      api.setAuthToken(data.token)
      setCode("")
      setMode("ready")
    } catch (err) {
      setCodeError(err instanceof Error ? err.message : "Failed to verify setup")
    } finally {
      setBusy(false)
    }
  }

  const onLogin = async (): Promise<void> => {
    if (code.length !== 6) {
      setCodeError("Code must be 6 digits.")
      return
    }
    setBusy(true)
    setError("")
    setCodeError("")
    try {
      const data = await api.authLogin(code)
      api.setAuthToken(data.token)
      setCode("")
      setMode("ready")
    } catch (err) {
      setCodeError(err instanceof Error ? err.message : "Invalid authenticator code")
    } finally {
      setBusy(false)
    }
  }

  const onLogout = async (): Promise<void> => {
    setBusy(true)
    setError("")
    try {
      await api.authLogout()
    } catch {
      // Ignore logout API failure and still clear local session.
    } finally {
      api.setAuthToken(null)
      setBusy(false)
      setMode("login")
    }
  }

  if (mode === "loading") {
    return <main className="auth-shell">Loading authentication...</main>
  }

  if (mode === "disabled") {
    return <DashboardApp />
  }

  if (mode === "setup") {
    return (
      <Authenticator
        title="Dashboard Auth Setup"
        description="Generate a QR once, scan it with Google Authenticator, then enter the 6-digit code."
        setupKey={setupKey}
        onSetupKeyChange={setSetupKey}
        onGenerateQr={() => void onStartSetup()}
        generatingQr={busy}
        qrDataUrl={qrDataUrl}
        manualKey={manualKey}
        code={code}
        onCodeChange={(nextCode) => {
          setCode(nextCode)
          if (codeError) {
            setCodeError("")
          }
        }}
        onSubmitCode={() => void onVerifySetup()}
        busy={busy}
        codeError={codeError || error}
      />
    )
  }

  if (mode === "login") {
    return (
      <Authenticator
        title="Dashboard Login"
        description="Enter the 6-digit code from Google Authenticator."
        code={code}
        onCodeChange={(nextCode) => {
          setCode(nextCode)
          if (codeError) {
            setCodeError("")
          }
        }}
        onSubmitCode={() => void onLogin()}
        busy={busy}
        codeError={codeError || error}
      />
    )
  }

  return <DashboardApp onLogout={() => void onLogout()} />
}
