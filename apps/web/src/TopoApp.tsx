import logoAdega from './assets/logo-adega-dois-irmaos.jpg'

interface Props {
  readonly titulo: string
  readonly children?: React.ReactNode
}

/**
 * Cabecalho compartilhado por todas as telas do sistema (exceto login, que
 * tem seu proprio hero centralizado) -- mesma logo e paleta da pagina de
 * diagnostico de hardware, pra dar identidade visual consistente em vez de
 * cada tela parecer um formulario solto.
 */
export function TopoApp({ titulo, children }: Props) {
  return (
    <header className="app-header">
      <div className="app-header-left">
        <img src={logoAdega} alt="Adega Dois Irmaos" className="app-logo" />
        <div>
          <p className="app-eyebrow">Adega Dois Irmaos</p>
          <h1>{titulo}</h1>
        </div>
      </div>
      <div className="app-header-right">{children}</div>
    </header>
  )
}
