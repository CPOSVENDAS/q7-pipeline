// Wrapper do Sonner que traduz mensagens de erro para PT-BR automaticamente.
import { toast as sonnerToast } from "sonner";
import { translateError } from "@/lib/translateError";

const tr = (msg: unknown): any => (typeof msg === "string" ? translateError(msg) : msg);

const wrap = (fn: any) => (msg: unknown, ...rest: any[]) => fn.call(sonnerToast, tr(msg), ...rest);

const base: any = (msg: unknown, ...rest: any[]) =>
  (sonnerToast as any)(tr(msg), ...rest);

// Copia todos os métodos do sonner, envolvendo as strings em translateError.
for (const key of Object.keys(sonnerToast)) {
  const value = (sonnerToast as any)[key];
  if (typeof value === "function") {
    if (["error", "success", "info", "warning", "message", "loading"].includes(key)) {
      base[key] = wrap(value);
    } else {
      base[key] = value.bind(sonnerToast);
    }
  } else {
    base[key] = value;
  }
}

export const toast: typeof sonnerToast = base;
