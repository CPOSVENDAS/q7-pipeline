import { createRoot } from "react-dom/client";
import "./index.css";
import { isConfigured, envProblems } from "@/lib/env";
import SetupRequired from "@/pages/SetupRequired";

const root = createRoot(document.getElementById("root")!);

// Sem as variáveis do Supabase o app não tem como funcionar. Em vez de quebrar
// com tela branca, mostramos exatamente o que está faltando.
if (!isConfigured) {
  console.error(
    "[Q7] Configuração do Supabase ausente ou inválida:",
    envProblems.map((p) => `${p.variable}: ${p.message}`).join(" | ")
  );
  root.render(<SetupRequired problems={envProblems} />);
} else {
  // Import dinâmico: o App puxa o client do Supabase, que não deve ser
  // carregado enquanto a configuração estiver inválida.
  import("./App.tsx").then(({ default: App }) => root.render(<App />));
}
