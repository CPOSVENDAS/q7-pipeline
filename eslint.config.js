import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // `supabase/functions` roda em Deno, não no browser: importa de URLs
    // (`npm:`, `jsr:`) e usa a global `Deno`. Este config é do frontend — lintar
    // aquilo só gera falso positivo. A validação daquele código acontece no
    // deploy (`supabase functions deploy`).
    ignores: ["dist", "supabase/functions/**", "scripts/**"],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      // Os payloads do Supabase (Realtime, respostas de RPC) chegam sem tipo
      // estável, então `any` é usado de propósito em vários pontos. Fica como
      // aviso para não afogar erros de verdade no ruído.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    // Componentes gerados pelo shadcn/ui. São regenerados pelo CLI, não editados
    // à mão — o padrão `interface X extends Y {}` vem do gerador.
    files: ["src/components/ui/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
);
