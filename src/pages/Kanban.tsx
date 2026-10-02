import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Link, useNavigate } from "react-router-dom";
import { Logo } from "@/components/Logo";
import { brandWatermarkStyle } from "@/lib/brandWatermark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
} from "@dnd-kit/core";
import { BarChart3, Bot, Clock, LogOut, MessageSquare, Plus, Settings, Trash2, User, Pencil, Trophy, XCircle, Heart, Megaphone, Smartphone } from "lucide-react";
import { ConfigDrawer } from "@/components/ConfigDrawer";
import { InstallmentChecklist } from "@/components/InstallmentChecklist";
import { SaleInstallment, groupInstallments } from "@/lib/installments";
import { useWhatsappStatus } from "@/hooks/useWhatsappStatus";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Stage = {
  id: string;
  name: string;
  position: number;
  color: string | null;
  is_won: boolean;
  is_lost: boolean;
  is_loyalty: boolean;
};
type Conversation = {
  id: string;
  contact_name: string | null;
  contact_phone: string;
  stage_id: string | null;
  ai_enabled: boolean;
  last_message_at: string;
  inactivity_followup_at: string | null;
  deal_value: number | null;
  client_type: string | null;
  installment_plan: number | null;
  due_day: number | null;
  commission_eligible: boolean;
};
type Tag = { id: string; name: string; color: string };

const formatBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

function Card({
  c,
  userId,
  installments,
  onInstallmentsChanged,
  stage,
  loyaltyStageId,
  onMoveToStage,
  cardTags,
}: {
  c: Conversation;
  userId: string;
  installments: SaleInstallment[];
  onInstallmentsChanged: () => void;
  stage?: Stage;
  loyaltyStageId?: string | null;
  onMoveToStage?: (convId: string, stageId: string) => void;
  cardTags?: Tag[];
}) {
  const navigate = useNavigate();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: c.id });
  // Card está numa coluna "ganha" (Fechado, por ex.) mas ainda não na de
  // fidelização, e o cliente já quitou todas as parcelas (commission_eligible
  // vem pronto do banco, mesma regra usada na comissão) — oferece o atalho
  // pra mover direto, sem precisar arrastar.
  const canFidelizar =
    !!stage?.is_won && !stage?.is_loyalty && !!loyaltyStageId && loyaltyStageId !== stage?.id && c.commission_eligible;
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => navigate(`/?open=${c.id}`)}
      className={`bg-background border rounded-md p-3 cursor-grab active:cursor-grabbing hover:border-primary transition ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="font-medium text-sm truncate">{c.contact_name || c.contact_phone}</div>
        <Badge variant={c.ai_enabled ? "default" : "secondary"} className="text-[10px] shrink-0">
          {c.ai_enabled ? <Bot className="w-3 h-3" /> : <User className="w-3 h-3" />}
        </Badge>
      </div>
      <div className="text-xs text-muted-foreground truncate">{c.contact_phone}</div>
      {cardTags && cardTags.length > 0 && (
        <div className="mt-1.5 flex items-center gap-1 flex-wrap">
          {cardTags.map((t) => (
            <span
              key={t.id}
              className="text-[9px] px-1.5 py-0.5 rounded-full border"
              style={{ background: `${t.color}22`, color: t.color, borderColor: `${t.color}55` }}
            >
              {t.name}
            </span>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        {c.deal_value != null && (
          <span className="text-[11px] font-medium text-primary">{formatBRL(c.deal_value)}</span>
        )}
        {c.inactivity_followup_at && (
          <span className="flex items-center gap-1 text-[11px] text-primary">
            <Clock className="w-3 h-3" /> Follow-up agendado
          </span>
        )}
      </div>
      {c.installment_plan != null && (
        <div className="mt-2 pt-2 border-t">
          <InstallmentChecklist
            conversationId={c.id}
            userId={userId}
            clientType={c.client_type}
            installmentPlan={c.installment_plan}
            dueDay={c.due_day}
            installments={installments}
            onChanged={onInstallmentsChanged}
            compact
          />
        </div>
      )}
      {canFidelizar && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onMoveToStage?.(c.id, loyaltyStageId as string);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="mt-2 w-full flex items-center justify-center gap-1 text-[11px] font-medium rounded-md border border-chart-good/40 text-chart-good py-1 hover:bg-chart-good/10 transition"
          title="Todas as parcelas pagas — mover para Fidelizado"
        >
          <Heart className="w-3 h-3" /> Parcelas quitadas — mover p/ Fidelizado
        </button>
      )}
    </div>
  );
}

function Column({
  stage,
  cards,
  userId,
  installmentsByConv,
  onInstallmentsChanged,
  onRename,
  onDelete,
  onToggleFlag,
  loyaltyStageId,
  onMoveToStage,
  tagsByConv,
}: {
  stage: Stage;
  cards: Conversation[];
  userId: string;
  installmentsByConv: Record<string, SaleInstallment[]>;
  onInstallmentsChanged: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onToggleFlag: (id: string, field: "is_won" | "is_lost" | "is_loyalty", value: boolean) => void;
  loyaltyStageId: string | null;
  onMoveToStage: (convId: string, stageId: string) => void;
  tagsByConv: Record<string, Tag[]>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `stage-${stage.id}` });
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(stage.name);
  return (
    <div className="w-72 shrink-0 flex flex-col bg-muted/40 rounded-lg border">
      <div className="p-3 border-b flex items-center justify-between gap-2">
        {editing ? (
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              setEditing(false);
              if (name.trim() && name !== stage.name) onRename(stage.id, name.trim());
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setName(stage.name);
                setEditing(false);
              }
            }}
            autoFocus
            className="h-7 text-sm"
          />
        ) : (
          <div className="flex items-center gap-2 min-w-0">
            {stage.color && (
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: stage.color }} />
            )}
            <span className="font-medium text-sm truncate">{stage.name}</span>
            <span className="text-xs text-muted-foreground">{cards.length}</span>
            {stage.is_won && <Badge className="bg-success text-success-foreground text-[9px] px-1.5">Ganha</Badge>}
            {stage.is_lost && <Badge variant="destructive" className="text-[9px] px-1.5">Perdida</Badge>}
            {stage.is_loyalty && (
              <Badge variant="outline" className="text-[9px] px-1.5 border-chart-good text-chart-good">
                Fidelizado
              </Badge>
            )}
          </div>
        )}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onToggleFlag(stage.id, "is_won", !stage.is_won)}
            className={`p-1 ${stage.is_won ? "text-success" : "text-muted-foreground hover:text-success"}`}
            title={stage.is_won ? "Deixar de contar como venda ganha" : "Marcar esta coluna como venda ganha"}
          >
            <Trophy className="w-3 h-3" />
          </button>
          <button
            onClick={() => onToggleFlag(stage.id, "is_loyalty", !stage.is_loyalty)}
            className={`p-1 ${stage.is_loyalty ? "text-chart-good" : "text-muted-foreground hover:text-chart-good"}`}
            title={
              stage.is_loyalty
                ? "Deixar de contar como coluna de fidelização"
                : "Marcar esta coluna como \"cliente fidelizado\" (parcelas quitadas, sem cobrança ativa)"
            }
          >
            <Heart className="w-3 h-3" />
          </button>
          <button
            onClick={() => onToggleFlag(stage.id, "is_lost", !stage.is_lost)}
            className={`p-1 ${stage.is_lost ? "text-destructive" : "text-muted-foreground hover:text-destructive"}`}
            title={stage.is_lost ? "Deixar de contar como venda perdida" : "Marcar esta coluna como venda perdida"}
          >
            <XCircle className="w-3 h-3" />
          </button>
          <button
            onClick={() => setEditing(true)}
            className="text-muted-foreground hover:text-foreground p-1"
            title="Renomear"
          >
            <Pencil className="w-3 h-3" />
          </button>
          <button
            onClick={() => onDelete(stage.id)}
            className="text-muted-foreground hover:text-destructive p-1"
            title="Apagar coluna"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
      <div
        ref={setNodeRef}
        className={`flex-1 p-2 space-y-2 min-h-[200px] overflow-y-auto transition ${
          isOver ? "bg-primary/5" : ""
        }`}
      >
        {cards.map((c) => (
          <Card
            key={c.id}
            c={c}
            userId={userId}
            installments={installmentsByConv[c.id] || []}
            onInstallmentsChanged={onInstallmentsChanged}
            stage={stage}
            loyaltyStageId={loyaltyStageId}
            onMoveToStage={onMoveToStage}
            cardTags={tagsByConv[c.id]}
          />
        ))}
      </div>
    </div>
  );
}

export default function Kanban() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { connected: waConnected, hasInstance: waHasInstance } = useWhatsappStatus();
  const [stages, setStages] = useState<Stage[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [installments, setInstallments] = useState<SaleInstallment[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [conversationTagIds, setConversationTagIds] = useState<Record<string, string[]>>({});
  const [activeCard, setActiveCard] = useState<Conversation | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [addStageOpen, setAddStageOpen] = useState(false);
  const [newStageName, setNewStageName] = useState("");
  const [stageToDelete, setStageToDelete] = useState<Stage | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const loadStages = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("pipeline_stages")
      .select("*")
      .eq("user_id", user.id)
      .order("position", { ascending: true });
    setStages((data as Stage[]) || []);
  };
  const loadConvs = async () => {
    const { data } = await supabase
      .from("conversations")
      .select(
        "id, contact_name, contact_phone, stage_id, ai_enabled, last_message_at, inactivity_followup_at, deal_value, client_type, installment_plan, due_day, commission_eligible",
      )
      .order("last_message_at", { ascending: false });
    setConversations((data as Conversation[]) || []);
  };
  const loadInstallments = async () => {
    const { data } = await supabase
      .from("sale_installments")
      .select("id, conversation_id, installment_no, paid_at");
    setInstallments((data as SaleInstallment[]) || []);
  };
  // Tags: só exibição aqui (chip no card) — gerenciar/atribuir fica em Conversas.
  const loadTags = async () => {
    const [{ data: tagRows }, { data: ctRows }] = await Promise.all([
      supabase.from("tags").select("*"),
      supabase.from("conversation_tags").select("conversation_id, tag_id"),
    ]);
    setTags((tagRows as Tag[]) || []);
    const map: Record<string, string[]> = {};
    (ctRows || []).forEach((r: any) => {
      if (!map[r.conversation_id]) map[r.conversation_id] = [];
      map[r.conversation_id].push(r.tag_id);
    });
    setConversationTagIds(map);
  };

  useEffect(() => {
    if (!user) return;
    loadStages();
    loadConvs();
    loadInstallments();
    loadTags();
    const ch = supabase
      .channel("kanban-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: `user_id=eq.${user.id}` }, loadConvs)
      .on("postgres_changes", { event: "*", schema: "public", table: "pipeline_stages", filter: `user_id=eq.${user.id}` }, loadStages)
      .on("postgres_changes", { event: "*", schema: "public", table: "sale_installments", filter: `user_id=eq.${user.id}` }, loadInstallments)
      .on("postgres_changes", { event: "*", schema: "public", table: "tags", filter: `user_id=eq.${user.id}` }, loadTags)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_tags", filter: `user_id=eq.${user.id}` }, loadTags)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user]);

  const installmentsByConv = groupInstallments(installments);
  const tagsByConv = useMemo(() => {
    const map: Record<string, Tag[]> = {};
    Object.entries(conversationTagIds).forEach(([convId, tagIds]) => {
      map[convId] = tagIds.map((tid) => tags.find((t) => t.id === tid)).filter(Boolean) as Tag[];
    });
    return map;
  }, [conversationTagIds, tags]);
  // Primeira coluna marcada como "fidelizado" — é pra lá que o botão do card
  // manda o cliente que já quitou todas as parcelas (ver Card acima).
  const loyaltyStageId = stages.find((s) => s.is_loyalty)?.id ?? null;

  const onDragStart = (e: DragStartEvent) => {
    const c = conversations.find((x) => x.id === e.active.id);
    setActiveCard(c || null);
  };

  // Movimento de card entre colunas — usado tanto pelo drag-and-drop quanto
  // pelo botão "mover p/ Fidelizado" do card (mesmo caminho, sem duplicar lógica).
  const moveConvToStage = async (convId: string, newStageId: string) => {
    const conv = conversations.find((c) => c.id === convId);
    if (!conv || conv.stage_id === newStageId) return;

    // optimistic
    setConversations((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, stage_id: newStageId } : c)),
    );
    const { error } = await supabase
      .from("conversations")
      .update({ stage_id: newStageId })
      .eq("id", convId);
    if (error) {
      toast({ variant: "destructive", title: "Erro", description: error.message });
      loadConvs();
    }
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveCard(null);
    if (!e.over) return;
    const overId = String(e.over.id);
    if (!overId.startsWith("stage-")) return;
    const newStageId = overId.replace("stage-", "");
    moveConvToStage(String(e.active.id), newStageId);
  };

  const openAddStage = () => {
    setNewStageName("");
    setAddStageOpen(true);
  };

  const addStage = async () => {
    if (!user) return;
    const name = newStageName.trim();
    if (!name) return;
    const pos = (stages[stages.length - 1]?.position ?? -1) + 1;
    const { data, error } = await supabase
      .from("pipeline_stages")
      .insert({ user_id: user.id, name, position: pos })
      .select()
      .single();
    if (error) {
      toast({ variant: "destructive", title: "Erro", description: error.message });
      return;
    }
    if (data) {
      setStages((prev) => [...prev, data as Stage]);
    }
    setAddStageOpen(false);
    setNewStageName("");
  };

  const seedDefaults = async () => {
    if (!user) return;
    const { error } = await supabase.rpc("seed_pipeline_stages", { _user_id: user.id });
    if (error) {
      toast({ variant: "destructive", title: "Erro", description: error.message });
      return;
    }
    await loadStages();
  };

  const renameStage = async (id: string, name: string) => {
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)));
    const { error } = await supabase.from("pipeline_stages").update({ name }).eq("id", id);
    if (error) {
      toast({ variant: "destructive", title: "Erro", description: error.message });
      loadStages();
    }
  };

  // Deriva o trio (is_won, is_lost, is_loyalty) depois de alternar UMA flag,
  // mantendo as combinações coerentes: perdida nunca convive com ganha nem com
  // fidelizado; fidelizado sempre implica ganha (cliente fidelizado É uma
  // venda ganha — só numa etapa posterior, sem cobrança ativa).
  const deriveStageFlags = (
    s: Stage,
    field: "is_won" | "is_lost" | "is_loyalty",
    value: boolean,
  ): Pick<Stage, "is_won" | "is_lost" | "is_loyalty"> => {
    let { is_won, is_lost, is_loyalty } = s;
    if (field === "is_lost") {
      is_lost = value;
      if (value) { is_won = false; is_loyalty = false; }
    } else if (field === "is_won") {
      is_won = value;
      if (value) is_lost = false;
      else is_loyalty = false; // não dá pra ser "fidelizado" sem ser "ganha"
    } else {
      is_loyalty = value;
      if (value) { is_won = true; is_lost = false; }
    }
    return { is_won, is_lost, is_loyalty };
  };

  const toggleStageFlag = async (id: string, field: "is_won" | "is_lost" | "is_loyalty", value: boolean) => {
    const current = stages.find((s) => s.id === id);
    if (!current) return;
    const patch = deriveStageFlags(current, field, value);
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    const { error } = await supabase.from("pipeline_stages").update(patch).eq("id", id);
    if (error) {
      toast({ variant: "destructive", title: "Erro", description: error.message });
      loadStages();
    }
  };

  const requestDeleteStage = (id: string) => {
    if (stages.length <= 1) {
      toast({ variant: "destructive", title: "Precisa ter pelo menos 1 coluna" });
      return;
    }
    const s = stages.find((x) => x.id === id);
    if (s) setStageToDelete(s);
  };

  const confirmDeleteStage = async () => {
    if (!stageToDelete) return;
    const id = stageToDelete.id;
    const inThis = conversations.filter((c) => c.stage_id === id).length;
    const first = stages.find((s) => s.id !== id);
    if (first && inThis > 0) {
      await supabase.from("conversations").update({ stage_id: first.id }).eq("stage_id", id);
      setConversations((prev) =>
        prev.map((c) => (c.stage_id === id ? { ...c, stage_id: first.id } : c)),
      );
    }
    await supabase.from("pipeline_stages").delete().eq("id", id);
    setStages((prev) => prev.filter((s) => s.id !== id));
    setStageToDelete(null);
  };

  return (
    <div className="h-screen flex flex-col bg-background" style={brandWatermarkStyle}>
      <header className="border-b px-4 h-14 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Logo horizontal width={26} height={26} />
          <nav className="hidden sm:flex items-center gap-1 ml-2">
            <Link to="/" className="px-3 py-1.5 text-sm rounded-md text-muted-foreground hover:bg-muted transition">
              Conversas
            </Link>
            <Link to="/kanban" className="px-3 py-1.5 text-sm rounded-md bg-muted font-medium">
              Kanban
            </Link>
            <Link to="/relatorios" className="px-3 py-1.5 text-sm rounded-md text-muted-foreground hover:bg-muted transition">
              Relatórios
            </Link>
            <Link to="/transmissao" className="px-3 py-1.5 text-sm rounded-md text-muted-foreground hover:bg-muted transition">
              Transmissão
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="sm:hidden" onClick={() => navigate("/")} title="Conversas">
            <MessageSquare className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="sm:hidden" onClick={() => navigate("/relatorios")} title="Relatórios">
            <BarChart3 className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="sm:hidden" onClick={() => navigate("/transmissao")} title="Transmissão">
            <Megaphone className="w-4 h-4" />
          </Button>
          {waHasInstance && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfigOpen(true)}
              title={
                waConnected
                  ? "WhatsApp conectado"
                  : "WhatsApp desconectado — clique para reconectar em Configuração"
              }
              className={!waConnected ? "text-destructive hover:text-destructive" : ""}
            >
              <Smartphone className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">{waConnected ? "WhatsApp" : "Desconectado"}</span>
              <span
                className={`ml-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                  waConnected ? "bg-emerald-500" : "bg-destructive animate-pulse"
                }`}
              />
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setConfigOpen(true)}>
            <Settings className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Configuração</span>
          </Button>
          <Button variant="ghost" size="icon" onClick={async () => { await signOut(); navigate("/login"); }} title="Sair">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </header>

      <ConfigDrawer open={configOpen} onOpenChange={setConfigOpen} />

      <Dialog open={addStageOpen} onOpenChange={setAddStageOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova coluna</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="Nome da coluna"
            value={newStageName}
            onChange={(e) => setNewStageName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addStage();
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddStageOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={addStage} disabled={!newStageName.trim()}>
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex-1 overflow-x-auto overflow-y-hidden p-4">
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div className="flex gap-4 h-full">
            {stages.length === 0 && (
              <div className="w-full flex items-center justify-center">
                <div className="text-center max-w-sm border-2 border-dashed rounded-lg p-8">
                  <div className="font-medium mb-1">Seu Kanban está vazio</div>
                  <div className="text-sm text-muted-foreground mb-4">
                    Comece com um pipeline padrão de vendas: Prospecção → Lead → Agendamento → Fechado → Fidelizado
                    (+ Perdido quando cair). Você pode renomear, apagar ou adicionar colunas depois.
                  </div>
                  <div className="flex gap-2 justify-center">
                    <Button size="sm" onClick={seedDefaults}>
                      <Plus className="w-4 h-4 mr-1" /> Criar colunas padrão
                    </Button>
                    <Button size="sm" variant="outline" onClick={openAddStage}>
                      Nova coluna
                    </Button>
                  </div>
                </div>
              </div>
            )}
            {stages.map((s) => (
              <Column
                key={s.id}
                stage={s}
                cards={conversations.filter((c) => c.stage_id === s.id)}
                userId={user?.id || ""}
                installmentsByConv={installmentsByConv}
                onInstallmentsChanged={loadInstallments}
                onRename={renameStage}
                onDelete={requestDeleteStage}
                onToggleFlag={toggleStageFlag}
                loyaltyStageId={loyaltyStageId}
                onMoveToStage={moveConvToStage}
                tagsByConv={tagsByConv}
              />
            ))}
            {stages.length > 0 && (
              <button
                onClick={openAddStage}
                className="w-72 shrink-0 border-2 border-dashed rounded-lg flex items-center justify-center text-sm text-muted-foreground hover:text-foreground hover:border-primary transition min-h-[120px]"
              >
                <Plus className="w-4 h-4 mr-2" /> Nova coluna
              </button>
            )}
          </div>
          <DragOverlay>
            {activeCard && <Card c={activeCard} />}
          </DragOverlay>
        </DndContext>
      </div>
      <AlertDialog open={!!stageToDelete} onOpenChange={(o) => !o && setStageToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar coluna?</AlertDialogTitle>
            <AlertDialogDescription>
              {stageToDelete
                ? (() => {
                    const n = conversations.filter((c) => c.stage_id === stageToDelete.id).length;
                    return n > 0
                      ? `Esta coluna contém ${n} conversa(s). Elas serão movidas para a primeira coluna.`
                      : "Esta coluna está vazia.";
                  })()
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteStage}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Apagar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}