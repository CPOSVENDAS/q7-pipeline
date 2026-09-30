import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminRole } from "@/hooks/useAdminRole";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import {
  Bot,
  ExternalLink,
  TestTube2,
  Clock,
  Webhook,
  Copy,
  Shield,
  Smartphone,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Sparkles,
} from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSection?: "whatsapp" | "agente";
}

function CheckRow({ ok, warn, label }: { ok?: boolean; warn?: boolean; label: string }) {
  const Icon = warn ? AlertTriangle : ok ? CheckCircle2 : XCircle;
  const color = warn ? "text-amber-500" : ok ? "text-emerald-500" : "text-destructive";
  return (
    <div className="flex items-start gap-2">
      <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${color}`} />
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

export function ConfigDrawer({ open, onOpenChange }: Props) {
  const { user } = useAuth();
  const { isAdmin } = useAdminRole();
  const navigate = useNavigate();

  // Agente state
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [prompt, setPrompt] = useState(
    "Você é um assistente de atendimento simpático e objetivo. Quando receber [áudio], [imagem], [vídeo] ou [documento], diga que ainda não consegue ouvir ou ver o conteúdo e peça para o cliente resumir por texto.",
  );
  const [enabled, setEnabled] = useState(false);
  const [openingTemplate, setOpeningTemplate] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingHook, setTestingHook] = useState(false);
  const [hookReport, setHookReport] = useState<any | null>(null);
  // Conexão Uazapi (por usuário) — nome/telefone são detectados, não digitados
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [instanceName, setInstanceName] = useState("");
  const [instancePhone, setInstancePhone] = useState("");
  const [instanceConnected, setInstanceConnected] = useState<boolean | null>(null);
  const [serverUrl, setServerUrl] = useState("");
  const [instanceToken, setInstanceToken] = useState("");
  const [hasInstanceToken, setHasInstanceToken] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectStep, setConnectStep] = useState("");
  const [webhookOk, setWebhookOk] = useState<boolean | null>(null);
  // Follow-up automático
  const [followupOn, setFollowupOn] = useState(false);
  const [followupMinutes, setFollowupMinutes] = useState<number>(60);
  const [followupMax, setFollowupMax] = useState<number>(1);

  const loadAgent = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("agent_configs")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    if (data) {
      setPrompt(data.system_prompt);
      setEnabled(data.enabled);
      setHasKey(!!data.groq_api_key);
      setOpeningTemplate((data as any).opening_message_template || "");
      const m = (data as any).followup_inactivity_minutes;
      setFollowupOn(!!m && m > 0);
      setFollowupMinutes(m && m > 0 ? m : 60);
      setFollowupMax((data as any).followup_max_per_conversation ?? 1);
    }
  };

  const loadUazapi = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("whatsapp_instances")
      .select("id,name,phone,status,server_url,instance_token")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      setInstanceId(data.id);
      setInstanceName(data.name || "");
      setInstancePhone(data.phone || "");
      setInstanceConnected(data.status === "connected");
      setServerUrl(data.server_url || "");
      setHasInstanceToken(!!data.instance_token);
    }
  };

  useEffect(() => {
    if (!open) return;
    loadAgent();
    loadUazapi();
  }, [open, user]);

  /** Token da instância: o que foi digitado agora ou o que já está salvo. */
  const resolveToken = async (): Promise<string> => {
    const typed = instanceToken.trim();
    if (typed) return typed;
    if (!user) return "";
    const { data } = await supabase
      .from("whatsapp_instances")
      .select("instance_token")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.instance_token || "";
  };

  /**
   * Um clique faz tudo: salva as credenciais, descobre nome e telefone pelo
   * token, registra o webhook na Uazapi e roda o diagnóstico ponta a ponta.
   * O usuário não precisa abrir o painel da Uazapi em momento nenhum.
   */
  const connectUazapi = async () => {
    if (!user) return;
    const url = serverUrl.trim().replace(/\/$/, "");
    if (!url) {
      toast({ variant: "destructive", title: "Informe o Server URL" });
      return;
    }
    const token = instanceToken.trim() || (await resolveToken());
    if (!token) {
      toast({ variant: "destructive", title: "Informe o Instance Token" });
      return;
    }

    setConnecting(true);
    setWebhookOk(null);
    setHookReport(null);
    try {
      // 1. Grava servidor + token primeiro: o backend descobre a URL do
      //    servidor a partir do token já salvo no banco.
      setConnectStep("Salvando credenciais...");
      let id = instanceId;
      if (id) {
        const { error } = await supabase
          .from("whatsapp_instances")
          .update({ server_url: url, instance_token: token })
          .eq("id", id)
          .eq("user_id", user.id);
        if (error) throw new Error(error.message);
      } else {
        const { data, error } = await supabase
          .from("whatsapp_instances")
          .insert({
            user_id: user.id,
            server_url: url,
            instance_token: token,
            name: "Instância WhatsApp", // provisório: substituído pelo nome real logo abaixo
            status: "disconnected",
          })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        id = data.id;
        setInstanceId(id);
      }

      // 2. O token já identifica a instância — nome e telefone vêm da Uazapi.
      setConnectStep("Identificando a instância...");
      const { data: st, error: stErr } = await supabase.functions.invoke("manage-instance", {
        body: { action: "status", instance_token: token },
      });
      if (stErr || !st?.ok) {
        throw new Error(
          st?.error ||
            stErr?.message ||
            "Não consegui falar com a Uazapi. Confira o Server URL e o Instance Token.",
        );
      }

      const detected: any = { status: st.connected ? "connected" : "disconnected" };
      if (st.name) detected.name = st.name;
      if (st.phone) detected.phone = st.phone;
      if (st.profile_name) detected.profile_name = st.profile_name;
      await supabase.from("whatsapp_instances").update(detected).eq("id", id).eq("user_id", user.id);

      if (st.name) setInstanceName(st.name);
      if (st.phone) setInstancePhone(st.phone);
      setInstanceConnected(!!st.connected);

      // 3. Registra o webhook sozinho, direto na Uazapi.
      setConnectStep("Registrando o webhook...");
      const { data: wh, error: whErr } = await supabase.functions.invoke("manage-instance", {
        body: { action: "set_webhook", instance_token: token, webhook_url: webhookUrl },
      });
      const hookRegistered = !whErr && !!wh?.ok;
      setWebhookOk(hookRegistered);

      // 4. Diagnóstico ponta a ponta, sem clicar em mais nada.
      setConnectStep("Testando ponta a ponta...");
      await runWebhookDiagnostic(token, st.name || instanceName);

      setHasInstanceToken(true);
      setInstanceToken("");

      if (!hookRegistered) {
        toast({
          variant: "destructive",
          title: "Conectado, mas o webhook falhou",
          description: wh?.error || whErr?.message || "Use 'Reconfigurar webhook' abaixo.",
        });
      } else if (!st.connected) {
        toast({
          title: "Configurado!",
          description: "Webhook registrado. Falta ler o QR Code no painel da Uazapi.",
        });
      } else {
        toast({
          title: "Tudo pronto!",
          description: `${st.name || "Instância"} conectada${st.phone ? ` — ${st.phone}` : ""}.`,
        });
      }
    } catch (e: any) {
      toast({ variant: "destructive", title: "Falha ao conectar", description: e.message });
    } finally {
      setConnecting(false);
      setConnectStep("");
    }
  };

  const saveAgent = async () => {
    if (!user) return;
    setSaving(true);
    const payload: any = {
      user_id: user.id,
      system_prompt: prompt,
      enabled,
      opening_message_template: openingTemplate.trim() || null,
      followup_inactivity_minutes: followupOn ? followupMinutes : null,
      followup_max_per_conversation: followupMax,
    };
    if (apiKey.trim()) payload.groq_api_key = apiKey.trim();
    const { error } = await supabase
      .from("agent_configs")
      .upsert(payload, { onConflict: "user_id" });
    setSaving(false);
    if (error) {
      toast({ variant: "destructive", title: "Erro", description: error.message });
      return;
    }
    const hadKey = !!apiKey.trim() || hasKey;
    if (apiKey.trim()) {
      setHasKey(true);
      setApiKey("");
    }
    // Testa sozinho: salvar sem saber se a chave funciona não ajuda ninguém.
    if (hadKey) await testConnection();
    else toast({ title: "Salvo!" });
  };

  const testConnection = async () => {
    setTesting(true);
    const { data, error } = await supabase.functions.invoke("test-ai-connection", {
      body: { apiKey: apiKey.trim() || undefined },
    });
    setTesting(false);
    if (error || !data?.ok) {
      toast({
        variant: "destructive",
        title: "Falha no teste",
        description: data?.error || error?.message || "Erro",
      });
    } else {
      toast({ title: "Conexão OK!", description: `Resposta: ${data.data?.reply}` });
    }
  };

  const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-webhook`;

  const copyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      toast({ title: "URL copiada!" });
    } catch {
      toast({ variant: "destructive", title: "Não foi possível copiar" });
    }
  };

  /** Dispara o dry_run no webhook e publica os 4 checks na tela. */
  const runWebhookDiagnostic = async (token: string, name: string) => {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "dry_run", instance: { name, token } }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ variant: "destructive", title: "Webhook inacessível", description: `HTTP ${res.status}` });
      return;
    }
    setHookReport(json.checks || { error: json.error || "Sem detalhes" });
  };

  const testWebhook = async () => {
    setTestingHook(true);
    setHookReport(null);
    try {
      await runWebhookDiagnostic(await resolveToken(), instanceName);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Falha no webhook", description: e.message });
    } finally {
      setTestingHook(false);
    }
  };

  /** Rede de segurança: reenvia o webhook para a Uazapi se o automático falhar. */
  const reconfigureWebhook = async () => {
    setTestingHook(true);
    try {
      const token = await resolveToken();
      if (!token) {
        toast({ variant: "destructive", title: "Configure a instância primeiro" });
        return;
      }
      const { data, error } = await supabase.functions.invoke("manage-instance", {
        body: { action: "set_webhook", instance_token: token, webhook_url: webhookUrl },
      });
      const ok = !error && !!data?.ok;
      setWebhookOk(ok);
      if (ok) {
        toast({ title: "Webhook registrado na Uazapi" });
        await runWebhookDiagnostic(token, instanceName);
      } else {
        toast({
          variant: "destructive",
          title: "Falha ao registrar",
          description: data?.error || error?.message || "Erro",
        });
      }
    } catch (e: any) {
      toast({ variant: "destructive", title: "Falha", description: e.message });
    } finally {
      setTestingHook(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Configuração</SheetTitle>
          <SheetDescription>
            Configure a IA e o follow-up automático.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-8">
          {/* Conexão Uazapi (por usuário) */}
          <section className="space-y-3">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-primary" /> Conexão Uazapi
            </h3>
            <p className="text-xs text-muted-foreground">
              Cole o Server URL e o Instance Token da sua instância na Uazapi. O
              resto é automático: identificamos a instância e registramos o
              webhook pra você.
            </p>

            <div className="space-y-1.5">
              <Label className="text-xs">Server URL</Label>
              <Input
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="https://free.uazapi.com"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">
                Instance Token{" "}
                {hasInstanceToken && (
                  <span className="text-muted-foreground">(configurado)</span>
                )}
              </Label>
              <Input
                type="password"
                value={instanceToken}
                onChange={(e) => setInstanceToken(e.target.value)}
                placeholder={
                  hasInstanceToken ? "•••••••• (deixe vazio para manter)" : "cole o token da instância"
                }
              />
              <a
                href="https://docs.uazapi.com/"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Onde encontrar <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <Button onClick={connectUazapi} disabled={connecting} className="w-full" size="sm">
              {connecting ? connectStep || "Conectando..." : "Conectar e configurar tudo"}
            </Button>

            {instanceConnected !== null && !connecting && (
              <div className="rounded-md border border-border bg-background p-3 text-xs space-y-1.5">
                <CheckRow ok label={`Instância: ${instanceName || "—"}`} />
                <CheckRow
                  ok={instanceConnected}
                  warn={!instanceConnected}
                  label={
                    instanceConnected
                      ? `WhatsApp conectado${instancePhone ? ` — ${instancePhone}` : ""}`
                      : "WhatsApp desconectado — leia o QR Code no painel da Uazapi"
                  }
                />
                {webhookOk !== null && (
                  <CheckRow
                    ok={webhookOk}
                    label={webhookOk ? "Webhook registrado automaticamente" : "Webhook não registrado"}
                  />
                )}
              </div>
            )}
          </section>

          <Separator />

          {isAdmin && (
            <>
              <section className="space-y-2">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <Shield className="w-4 h-4 text-primary" /> Admin Token global (opcional)
                </h3>
                <p className="text-xs text-muted-foreground">
                  Fluxo normal do cliente é o bloco acima. Use esta tela apenas
                  se precisar gerenciar instâncias no nível do servidor com o
                  Admin Token.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    onOpenChange(false);
                    navigate("/admin/uazapi");
                  }}
                >
                  Abrir configuração da Uazapi
                </Button>
              </section>
              <Separator />
            </>
          )}

          {/* Webhook Uazapi */}
          <section className="space-y-3">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Webhook className="w-4 h-4 text-primary" /> Webhook do WhatsApp (Uazapi)
            </h3>
            <p className="text-xs text-muted-foreground">
              Registrado automaticamente ao conectar. A URL fica aqui só para
              conferência e para os casos em que precise reconfigurar.
            </p>

            <div className="space-y-1.5">
              <Label className="text-xs">URL do webhook</Label>
              <div className="flex gap-2">
                <Input readOnly value={webhookUrl} className="text-xs font-mono" />
                <Button variant="outline" size="sm" onClick={copyWebhook}>
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={testWebhook}
                disabled={testingHook}
                className="flex-1"
              >
                <TestTube2 className="w-4 h-4 mr-2" />
                {testingHook ? "..." : "Testar"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={reconfigureWebhook}
                disabled={testingHook}
                className="flex-1"
              >
                <Webhook className="w-4 h-4 mr-2" />
                Reconfigurar
              </Button>
            </div>

            {hookReport && (
              <div className="rounded-md border border-border bg-background p-3 text-xs space-y-1.5">
                <CheckRow
                  ok={!!hookReport?.instance?.ok}
                  label={
                    hookReport?.instance?.ok
                      ? `Instância encontrada (por ${hookReport.instance.matched_by}) — ${hookReport.instance.instance_name}`
                      : `Instância não encontrada${hookReport?.instance?.error ? ` — ${hookReport.instance.error}` : ""}`
                  }
                />
                <CheckRow
                  ok={!!hookReport?.agent?.ok}
                  label={
                    hookReport?.agent?.ok
                      ? "Agente ativo e configurado"
                      : `Agente: ${hookReport?.agent?.error || "não configurado"}`
                  }
                />
                <CheckRow
                  ok={!!hookReport?.groq?.ok}
                  label={hookReport?.groq?.ok ? "Groq respondendo" : `Groq: ${hookReport?.groq?.error || "falha"}`}
                />
                <CheckRow
                  ok={!!hookReport?.uazapi?.ok}
                  label={hookReport?.uazapi?.ok ? "Uazapi acessível" : `Uazapi: ${hookReport?.uazapi?.error || "falha"}`}
                />
              </div>
            )}
          </section>

          <Separator />

          {/* Agente IA */}
          <section className="space-y-4">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Bot className="w-4 h-4 text-primary" /> Agente IA (Groq)
            </h3>

            <div className="space-y-1.5">
              <Label className="text-xs">
                Chave da API {hasKey && <span className="text-muted-foreground">(configurada)</span>}
              </Label>
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={hasKey ? "•••••••• (deixe vazio para manter)" : "gsk_..."}
              />
              <a
                href="https://console.groq.com/keys"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Obter chave gratuita <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Prompt do agente</Label>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={6}
                placeholder="Como o agente deve se comportar, tom de voz, sobre o negócio..."
              />
            </div>

            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <div className="font-medium text-sm">Agente ativo</div>
                <div className="text-xs text-muted-foreground">
                  Responde automaticamente às mensagens do WhatsApp.
                </div>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </label>

            <div className="flex gap-2">
              <Button onClick={saveAgent} disabled={saving} className="flex-1" size="sm">
                {saving ? "Salvando..." : "Salvar"}
              </Button>
              <Button variant="outline" size="sm" onClick={testConnection} disabled={testing}>
                <TestTube2 className="w-4 h-4 mr-2" />
                {testing ? "Testando..." : "Testar"}
              </Button>
            </div>
          </section>

          <Separator />

          {/* Mensagem de abertura (1º contato do PAP) */}
          <section className="space-y-3">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" /> Mensagem de abertura (1º contato)
            </h3>
            <p className="text-xs text-muted-foreground">
              Modelo usado no botão "Novo contato" em Conversas, para quando você
              mesmo manda a primeira mensagem pra um cliente que acabou de visitar
              (porta a porta). Você ainda pode editar o texto na hora de enviar —
              isso aqui só evita redigitar sempre a mesma apresentação. A IA assume
              a conversa sozinha a partir da resposta do cliente.
            </p>
            <Textarea
              value={openingTemplate}
              onChange={(e) => setOpeningTemplate(e.target.value)}
              rows={4}
              placeholder='Ex.: "Oi! Aqui é o [seu nome], da [sua empresa]. Foi um prazer te conhecer hoje. Fico à disposição pra qualquer dúvida sobre o que conversamos 🙂"'
            />
            <Button onClick={saveAgent} disabled={saving} size="sm" variant="outline" className="w-full">
              {saving ? "Salvando..." : "Salvar modelo"}
            </Button>
          </section>

          <Separator />

          {/* Follow-up automático */}
          <section className="space-y-4">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" /> Follow-up automático
            </h3>
            <p className="text-xs text-muted-foreground">
              Se o cliente ficar sem responder por um tempo, a IA envia uma
              mensagem curta de reengajamento.
            </p>

            <label className="flex items-center justify-between cursor-pointer">
              <div className="font-medium text-sm">Reengajar clientes inativos</div>
              <Switch checked={followupOn} onCheckedChange={setFollowupOn} />
            </label>

            {followupOn && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Após quantos minutos</Label>
                  <Input
                    type="number"
                    min={1}
                    max={43200}
                    value={followupMinutes}
                    onChange={(e) => setFollowupMinutes(Number(e.target.value) || 1)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Máx. por conversa</Label>
                  <Input
                    type="number"
                    min={1}
                    max={5}
                    value={followupMax}
                    onChange={(e) => setFollowupMax(Number(e.target.value) || 1)}
                  />
                </div>
              </div>
            )}

            <p className="text-[11px] text-muted-foreground">
              Salve na seção acima para aplicar. O contador é zerado toda vez
              que o cliente responde.
            </p>
          </section>
        </div>

      </SheetContent>
    </Sheet>
  );
}