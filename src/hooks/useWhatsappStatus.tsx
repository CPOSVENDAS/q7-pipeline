import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";

/**
 * Status de conexão do WhatsApp, ao vivo. Antes, o painel só checava a
 * conexão quando o usuário clicava em "Conectar" nas Configurações — se a
 * sessão caísse depois disso, a tela continuava mostrando "conectado" e a
 * IA parava de responder silenciosamente, só visível no log do servidor.
 *
 * Agora o evento `connection` da Uazapi é assinado (manage-instance) e
 * tratado (whatsapp-webhook), que grava a mudança de status em
 * `whatsapp_instances` na hora. Este hook escuta essa tabela via Realtime
 * e expõe o status atual, avisando com um toast assim que a sessão cai —
 * não é preciso abrir nada para descobrir.
 */
export function useWhatsappStatus() {
  const { user } = useAuth();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [hasInstance, setHasInstance] = useState(false);
  const [instanceName, setInstanceName] = useState("");
  const [lastDisconnectedAt, setLastDisconnectedAt] = useState<string | null>(null);
  const prevConnected = useRef<boolean | null>(null);
  const firstLoad = useRef(true);

  useEffect(() => {
    if (!user) return;

    const load = async () => {
      const { data } = await supabase
        .from("whatsapp_instances")
        .select("name, status, instance_token, last_disconnected_at")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const isConnected = data?.instance_token ? data.status === "connected" : null;

      // Alerta ativo: se já sabíamos que estava conectado e virou
      // desconectado agora, avisa na hora — não só muda a cor do badge.
      if (!firstLoad.current && prevConnected.current === true && isConnected === false) {
        toast({
          variant: "destructive",
          title: "WhatsApp desconectado",
          description: "A sessão caiu e a IA não vai responder até reconectar em Configuração.",
        });
      }
      prevConnected.current = isConnected;
      firstLoad.current = false;

      setHasInstance(!!data?.instance_token);
      setInstanceName(data?.name || "");
      setLastDisconnectedAt(data?.last_disconnected_at || null);
      setConnected(isConnected);
    };

    load();
    const ch = supabase
      .channel("whatsapp-status")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_instances", filter: `user_id=eq.${user.id}` },
        load,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user]);

  return { connected, hasInstance, instanceName, lastDisconnectedAt };
}
