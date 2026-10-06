/**
 * Web Speech API nao tem tipos oficiais no TS/DOM lib -- declaramos so o
 * pedacinho que usamos (nao o `any` cru, que o lint bloqueia), com
 * checagem de suporte antes de usar (Safari/iOS nao tem).
 */
export interface ResultadoReconhecimentoVoz {
  readonly results: {
    readonly [indice: number]: { readonly [alternativa: number]: { readonly transcript: string } }
  }
}

export interface ReconhecimentoVoz {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  onresult: ((evento: ResultadoReconhecimentoVoz) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start: () => void
}

export function construtorReconhecimentoDeVoz(): (new () => ReconhecimentoVoz) | null {
  const janela = window as unknown as {
    SpeechRecognition?: new () => ReconhecimentoVoz
    webkitSpeechRecognition?: new () => ReconhecimentoVoz
  }
  return janela.SpeechRecognition ?? janela.webkitSpeechRecognition ?? null
}
