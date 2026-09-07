// Stub do bridge local para o SPIKE do dia 1 (arquitetura §5.1).
//
// Unico objetivo deste binario: provar se uma pagina HTTPS real, no Chrome
// real do cliente, consegue chamar http://localhost:9100/health.
//
// NAO implementa impressao, gaveta ou qualquer coisa de producao -- isso e
// deliberado. O spike existe para responder uma pergunta binaria (PASSA ou
// FALHA) antes de investir em impressao de verdade.
package main

import (
	"encoding/json"
	"log"
	"net/http"
)

const versao = "0.0.1-spike"

func comCorsEDiagnostico(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		pna := r.Header.Get("Access-Control-Request-Private-Network")
		metodo := r.Header.Get("Access-Control-Request-Method")

		// Log verboso: e o que vira o veredito "em qual politica/camada falhou".
		// Se este log NUNCA aparecer, a requisicao foi bloqueada pelo navegador
		// ANTES de sair (mixed content ou bloqueio de rede privada silencioso) --
		// ou seja, o bridge nunca foi alcancado.
		log.Printf(
			"requisicao recebida: metodo=%s origin=%q preflight-private-network=%q preflight-method=%q",
			r.Method, origin, pna, metodo,
		)

		// Spike: permissivo de proposito. Producao vai restringir a origem exata.
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
		}
		w.Header().Set("Vary", "Origin")
		w.Header().Set("Access-Control-Allow-Private-Network", "true")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == http.MethodOptions {
			// Preflight: responde e encerra sem chamar o handler real.
			w.WriteHeader(http.StatusNoContent)
			return
		}

		h(w, r)
	}
}

func handlerHealth(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"status": "ok",
		"versao": versao,
	})
}

func main() {
	http.HandleFunc("/health", comCorsEDiagnostico(handlerHealth))

	endereco := "127.0.0.1:9100"
	log.Printf("bridge (spike) ouvindo em http://%s/health", endereco)
	log.Printf("abra a pagina de diagnostico HTTPS e clique em testar")
	if err := http.ListenAndServe(endereco, nil); err != nil {
		log.Fatal(err)
	}
}
