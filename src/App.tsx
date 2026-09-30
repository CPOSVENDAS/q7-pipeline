import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminRoute } from "@/components/admin/AdminRoute";
import Login from "./pages/Login";
import Conversas from "./pages/Conversas";
import Kanban from "./pages/Kanban";
import UazapiConfig from "./pages/admin/UazapiConfig";
import NotFound from "./pages/NotFound";

// Carregadas sob demanda: telas de admin/relatório, a maioria das visitas
// nunca abre essa tela — assim quem só usa Conversas/Kanban no celular não baixa
// esse peso à toa.
const Relatorios = lazy(() => import("./pages/Relatorios"));
const Equipe = lazy(() => import("./pages/admin/Equipe"));

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <AuthProvider>
        <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<ProtectedRoute><Conversas /></ProtectedRoute>} />
            <Route path="/kanban" element={<ProtectedRoute><Kanban /></ProtectedRoute>} />
            <Route
              path="/relatorios"
              element={
                <ProtectedRoute>
                  <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Carregando…</div>}>
                    <Relatorios />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route path="/admin/uazapi" element={<ProtectedRoute><AdminRoute><UazapiConfig /></AdminRoute></ProtectedRoute>} />
            <Route
              path="/admin/equipe"
              element={
                <ProtectedRoute>
                  <AdminRoute>
                    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Carregando…</div>}>
                      <Equipe />
                    </Suspense>
                  </AdminRoute>
                </ProtectedRoute>
              }
            />
            <Route path="/conversas" element={<Navigate to="/" replace />} />
            <Route path="/dashboard" element={<Navigate to="/" replace />} />
            <Route path="/agente" element={<Navigate to="/" replace />} />
            <Route path="/conectar" element={<Navigate to="/" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
