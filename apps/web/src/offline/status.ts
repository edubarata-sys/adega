import { useEffect, useState } from 'react'

/** Aviso simples pros componentes redesenharem quando fila/catalogo mudam. */
const ouvintes = new Set<() => void>()

export function avisarMudanca(): void {
  for (const f of ouvintes) f()
}

export function useMudancasOffline(): number {
  const [versao, setVersao] = useState(0)
  useEffect(() => {
    const f = () => setVersao((v) => v + 1)
    ouvintes.add(f)
    window.addEventListener('online', f)
    window.addEventListener('offline', f)
    return () => {
      ouvintes.delete(f)
      window.removeEventListener('online', f)
      window.removeEventListener('offline', f)
    }
  }, [])
  return versao
}
