interface WebPilotSpeechResultEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }>>
}

interface WebPilotSpeechRecognition {
  lang: string
  interimResults: boolean
  onresult: ((event: WebPilotSpeechResultEvent) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}

interface Window {
  SpeechRecognition?: new () => WebPilotSpeechRecognition
  webkitSpeechRecognition?: new () => WebPilotSpeechRecognition
}
