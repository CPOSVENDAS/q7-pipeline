import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Link, useNavigate } from "react-router-dom";
import { Logo } from "@/components/Logo";
import { brandWatermarkStyle } from "@/lib/brandWatermark";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { LogOut, MessageSquare, Trello, BarChart3, Megaphone, Image as ImageIcon, Mic, X } from "lucide-react";

type Stage = { id: string; name: string; position: number };

type BroadcastRow = {
  id: string;
  stage_name: string;
  total_count: number;
  sent_count: number;
  failed_count: number;
  status: string;
  created_at: string;
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Na fila…",
  running: "Enviando…",
  completed: "Concluída",
  completed_with_errors: "Concluída (com falhas)",
  failed: "Falhou",
};

export default function Transmissao() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const [stages, setStages] = useState<Stage[]>([]);
  const [stageId, setStageId] = useState<string>("");
  const [contactCount, setContactCount] = useState<number | null>(null);
  const [caption, setCaption] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<BroadcastRow[]>([]);

  const loadHistory = () => {
    if (!user) return;
    supabase
      .from("broadcasts")
      .select("id, stage_name, total_count, sent_count, failed_count, status, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5)
      .then(({ data }) => setHistory(data || []));
  };

  useEffect(() => {
    if (!user) return;
    supabase
      .from("pipeline_stages")
      .select("id, name, position")
      .eq("user_id", user.id)
      .order("position", { ascending: true })
      .then(({ data }) => setStages(data || []));
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (!stageId || !user) {
      setContactCount(null);
      return;
    }
    supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("stage_id", stageId)
      .then(({ count }) => setContactCount(count ?? 0));
  }, [stageId, user]);

  // Enquanto alguma transmissão recente ainda está em andamento, atualiza
  // sozinho a cada 5s (o envio acontece aos poucos, pelo cron do backend).
  useEffect(() => {
    const hasActive = history.some((h) => h.status === "pending" || h.status === "running");
    if (!hasActive) return;
    const id = setInterval(loadHistory, 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history]);

  const uploadMedia = async (file: File, kind: "image" | "audio") => {
    const ext = file.name.split(".").pop() || (kind === "image" ? "jpg" : "ogg");
    const path = `${user!.id}/${Date.now()}-${kind}.${ext}`;
    const { error } = await supabase.storage.from("broadcast-media").upload(path, file, {
      contentType: file.type || undefined,
      upsert: false,
    });
    if (error) throw new Error(`Falha ao enviar ${kind === "image" ? "a foto" : "o áudio"}: ${error.message}`);
    const { data } = supabase.storage.from("broadcast-media").getPublicUrl(path);
    return data.publicUrl;
  };

  const handleSend = async () => {
    if (!stageId) {
      toast({ variant: "destructive", title: "Escolha uma coluna" });
      return;
    }
    if (!caption.trim() && !imageFile && !audioFile) {
      toast({ variant: "destructive", title: "Mande pelo menos uma foto, um áudio ou um texto" });
      return;
    }
    setSending(true);
    try {
      let imageUrl: string | null = null;
      let audioUrl: string | null = null;
      if (imageFile) imageUrl = await uploadMedia(imageFile, "image");
      if (audioFile) audioUrl = await uploadMedia(audioFile, "audio");

      const { data, error } = await supabase.functions.invoke("send-broadcast", {
        body: { stageId, caption: caption.trim() || null, imageUrl, audioUrl },
      });
      if (error || !data?.ok) {
        throw new Error(data?.error || error?.message || "Falha ao criar a transmissão.");
      }

      toast({
        title: "Transmissão na fila!",
        description: `${data.total} contato(s) vão receber aos poucos, com espaçamento entre os envios (pra não arriscar o número).`,
      });
      setCaption("");
      setImageFile(null);
      setAudioFile(null);
      loadHistory();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Erro ao enviar", description: e.message });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background" style={brandWatermarkStyle}>
      <header className="border-b px-4 h-14 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Logo horizontal width={26} height={26} />
          <nav className="hidden sm:flex items-center gap-1 ml-2">
            <Link to="/" className="px-3 py-1.5 text-sm rounded-md text-muted-foreground hover:bg-muted transition">
              Conversas
            </Link>
            <Link to="/kanban" className="px-3 py-1.5 text-sm rounded-md text-muted-foreground hover:bg-muted transition">
              Kanban
            </Link>
            <Link to="/relatorios" className="px-3 py-1.5 text-sm rounded-md text-muted-foreground hover:bg-muted transition">
              Relatórios
            </Link>
            <Link to="/transmissao" className="px-3 py-1.5 text-sm rounded-md bg-muted font-medium">
              Transmissão
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="sm:hidden" onClick={() => navigate("/")} title="Conversas">
            <MessageSquare className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="sm:hidden" onClick={() => navigate("/kanban")} title="Kanban">
            <Trello className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="sm:hidden" onClick={() => navigate("/relatorios")} title="Relatórios">
            <BarChart3 className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={async () => { await signOut(); navigate("/login"); }} title="Sair">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 max-w-2xl w-full mx-auto">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <Megaphone className="w-5 h-5" /> Lista de transmissão
          </h1>
          <p className="text-sm text-muted-foreground">
            Manda a mesma foto e/ou áudio pra todo mundo que está numa coluna do Kanban — um por vez, com
            espaçamento automático entre os envios, pra não arriscar o número.
          </p>
        </div>

        <div className="border rounded-lg p-4 space-y-4">
          <div className="space-y-1.5">
            <Label>Coluna do Kanban</Label>
            <Select value={stageId} onValueChange={setStageId}>
              <SelectTrigger>
                <SelectValue placeholder="Escolha a coluna" />
              </SelectTrigger>
              <SelectContent>
                {stages.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {stageId && (
              <p className="text-xs text-muted-foreground">
                {contactCount === null ? "Contando contatos…" : `${contactCount} contato(s) nessa coluna.`}
              </p>
            )}
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <ImageIcon className="w-3.5 h-3.5" /> Foto (opcional)
              </Label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setImageFile(e.target.files?.[0] || null)}
                className="text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-muted file:text-sm w-full"
              />
              {imageFile && (
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="truncate">{imageFile.name}</span>
                  <button type="button" onClick={() => setImageFile(null)} className="shrink-0 ml-2">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <Mic className="w-3.5 h-3.5" /> Áudio (opcional)
              </Label>
              <input
                type="file"
                accept="audio/*"
                onChange={(e) => setAudioFile(e.target.files?.[0] || null)}
                className="text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-muted file:text-sm w-full"
              />
              {audioFile && (
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="truncate">{audioFile.name}</span>
                  <button type="button" onClick={() => setAudioFile(null)} className="shrink-0 ml-2">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Legenda / texto (opcional)</Label>
            <Textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Vai junto com a foto (ou sozinho, se não anexar nada)."
              rows={3}
            />
          </div>

          <Button onClick={handleSend} disabled={sending || !stageId} className="w-full">
            {sending ? "Enviando para a fila…" : "Enviar"}
          </Button>
        </div>

        {history.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground">Últimas transmissões</h2>
            <div className="space-y-2">
              {history.map((h) => (
                <div key={h.id} className="border rounded-md p-3 flex items-center justify-between text-sm">
                  <div>
                    <div className="font-medium">{h.stage_name}</div>
                    <div className="text-xs text-muted-foreground">{new Date(h.created_at).toLocaleString("pt-BR")}</div>
                  </div>
                  <div className="text-right">
                    <div>{STATUS_LABEL[h.status] || h.status}</div>
                    <div className="text-xs text-muted-foreground">
                      {h.sent_count}/{h.total_count} enviado(s)
                      {h.failed_count > 0 ? ` · ${h.failed_count} falha(s)` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
