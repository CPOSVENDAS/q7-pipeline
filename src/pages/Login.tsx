import { translateError } from "@/lib/translateError";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { LogIn } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { brandWatermarkStyle } from "@/lib/brandWatermark";

const schema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(6, "Senha deve ter ao menos 6 caracteres"),
  fullName: z.string().optional(),
});

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      schema.parse({ email, password, fullName });
      if (mode === "signup") {
        const { error, session } = await signUp(email, password, fullName);
        if (error) {
          toast({ variant: "destructive", title: "Erro no cadastro", description: translateError(error) });
        } else if (!session) {
          // Supabase com "Confirm email" ligado: a conta existe, mas só entra depois de confirmar.
          toast({
            title: "Conta criada!",
            description: "Enviamos um link de confirmação para o seu e-mail. Confirme e depois entre.",
          });
          setMode("signin");
        } else {
          toast({ title: "Conta criada!", description: "Entrando automaticamente..." });
          navigate("/");
        }
      } else {
        const { error } = await signIn(email, password);
        if (error) {
          toast({ variant: "destructive", title: "Erro ao entrar", description: translateError(error) });
        } else {
          navigate("/");
        }
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast({ variant: "destructive", title: "Erro", description: translateError(error.errors[0].message) });
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative" style={brandWatermarkStyle}>
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm space-y-8 animate-fade-in">
        <div className="text-center space-y-2 flex flex-col items-center">
          <Logo width={110} height={46} />
        </div>

        <div className="rounded-2xl border-2 border-primary/40 p-6 space-y-5 bg-card">
          <div className="text-center">
            <span className="text-sm font-bold text-primary uppercase tracking-wide">
              {mode === "signin" ? "Entrar" : "Criar conta"}
            </span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="fullName">Nome completo</Label>
                <Input
                  id="fullName"
                  type="text"
                  placeholder="Seu nome"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <span>Aguarde...</span>
              ) : (
                <span className="inline-flex items-center">
                  <LogIn className="mr-2 h-4 w-4" />
                  {mode === "signin" ? "Entrar" : "Criar conta"}
                </span>
              )}
            </Button>
          </form>

          <div className="text-center">
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            >
              {mode === "signin" ? "Não tem conta? Cadastre-se" : "Já tem conta? Entrar"}
            </Button>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground">© 2026 CPOS Vendas</p>
      </div>
    </div>
  );
};

export default Login;
