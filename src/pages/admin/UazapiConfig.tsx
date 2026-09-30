import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { Plug, TestTube2, ArrowLeft, Info } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { brandWatermarkStyle } from "@/lib/brandWatermark";

const DEFAULT_INSTANCE_NAME = "principal";

export default function UazapiConfig() {
  const navigate = useNavigate();
  const [serverUrl, setServerUrl] = useState("");
  const [instanceToken, setInstanceToken] = useState("");
  const [adminToken, setAdminToken] = useState("");
  const [hasInstanceToken, setHasInstanceToken] = useState(false);
  const [hasAdminToken, setHasAdminToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    supabase
      .from("app_settings")
      .select("key,value")
      .in("key", ["uazapi_server_url", "uazapi_instance_token", "uazapi_admin_token"])
      .then(({ data }) => {
        for (const row of data || []) {
          if (row.key === "uazapi_server_url") setServerUrl(row.value || "");
          if (row.key === "uazapi_instance_token" && row.value) setHasInstanceToken(true);
          if (row.key === "uazapi_admin_token" && row.value) setHasAdminToken(true);
        }
      });
  }, []);

  const save = async () => {
    setSaving(true);
    const rows: any[] = [{ key: "uazapi_server_url", value: serverUrl.trim() }];
    if (instanceToken.trim()) rows.push({ key: "uazapi_instance_token", value: instanceToken.trim() });
    if (adminToken.trim()) rows.push({ key: "uazapi_admin_token", value: adminToken.trim() });
    const { error } = await supabase.from("app_settings").upsert(rows, { onConflict: "key" });

    // Sincroniza a instância principal para que o webhook a encontre automaticamente
    if (!error && instanceToken.trim()) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        // Não sobrescreve o nome se já existe uma instância do admin — o webhook
        // sincroniza automaticamente o nome real vindo da Uazapi.
        const { data: existing } = await supabase
          .from("whatsapp_instances")
          .select("id,name")
          .eq("user_id", user.id)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const { error: instError } = existing
          ? await supabase
              .from("whatsapp_instances")
              .update({ instance_token: instanceToken.trim(), status: "pending" })
              .eq("id", existing.id)
          : await supabase.from("whatsapp_instances").insert({
              user_id: user.id,
              name: DEFAULT_INSTANCE_NAME,
              instance_token: instanceToken.trim(),
              status: "pending",
            });
        if (instError) console.error("[UazapiConfig] failed to sync instance", instError);
      }
    }

    setSaving(false);
    if (error) toast({ variant: "destructive", title: "Erro", description: error.message });
    else {
      toast({ title: "Salvo!" });
      if (instanceToken.trim()) {
        setHasInstanceToken(true);
        setInstanceToken("");
      }
      if (adminToken.trim()) {
        setHasAdminToken(true);
        setAdminToken("");
      }
    }
  };

  const test = async () => {
    setTesting(true);
    const { data, error } = await supabase.functions.invoke("test-uazapi", {
      body: {
        serverUrl: serverUrl.trim(),
        instanceToken: instanceToken.trim() || undefined,
        adminToken: adminToken.trim() || undefined,
      },
    });
    setTesting(false);
    if (error || !data?.ok) {
      toast({ variant: "destructive", title: "Falha", description: data?.message || error?.message });
    } else {
      toast({ title: "Conexão OK!", description: data.message });
    }
  };

  return (
    <div className="min-h-screen bg-background p-6 lg:p-8" style={brandWatermarkStyle}>
      <div className="max-w-2xl mx-auto space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Voltar
        </Button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Plug className="w-6 h-6 text-primary" /> Uazapi
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure o servidor e o token da instância do WhatsApp.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Servidor e instância</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>URL do servidor</Label>
              <Input
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="https://free.uazapi.com"
              />
            </div>

            <div className="space-y-1.5">
              <Label>
                Instance Token{" "}
                {hasInstanceToken && <span className="text-xs text-muted-foreground">(já configurado)</span>}
              </Label>
              <Input
                type="password"
                value={instanceToken}
                onChange={(e) => setInstanceToken(e.target.value)}
                placeholder={hasInstanceToken ? "•••••••• (deixe vazio para manter)" : "token-da-instância-whatsapp"}
              />
              <p className="text-xs text-muted-foreground">
                Token específico da instância do WhatsApp. É o único necessário para enviar e receber mensagens.
              </p>
            </div>

            <div className="rounded-md border border-border bg-muted/40 p-3 text-xs flex gap-2">
              <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <p className="text-muted-foreground">
                A instância deve ser criada no painel da Uazapi. Depois de criada, copie o <strong>Instance Token</strong> dela e cole aqui.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>
                Admin Token (opcional){" "}
                {hasAdminToken && <span className="text-xs text-muted-foreground">(já configurado)</span>}
              </Label>
              <Input
                type="password"
                value={adminToken}
                onChange={(e) => setAdminToken(e.target.value)}
                placeholder={hasAdminToken ? "•••••••• (deixe vazio para manter)" : "seu-admin-token"}
              />
              <p className="text-xs text-muted-foreground">
                Só é necessário se você quiser criar, listar ou deletar instâncias pelo app. Para responder mensagens, o Instance Token é suficiente.
              </p>
            </div>

            <div className="flex gap-2">
              <Button onClick={save} disabled={saving}>
                {saving ? "Salvando..." : "Salvar"}
              </Button>
              <Button variant="outline" onClick={test} disabled={testing || !serverUrl.trim()}>
                <TestTube2 className="w-4 h-4 mr-2" />
                {testing ? "Testando..." : "Testar"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
