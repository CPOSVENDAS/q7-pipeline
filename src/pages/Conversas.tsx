import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  BarChart3,
  Bot,
  User,
  Send,
  MessageSquare,
  Settings,
  LogOut,
  Sparkles,
  Clock,
  Trello,
  X,
  UserPlus,
  Megaphone,
  Search,
  Plus,
  StickyNote,
  Tag as TagIcon,
  Trash2,
  Bell,
  MapPin,
  Smartphone,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { brandWatermarkStyle } from "@/lib/brandWatermark";
import { ConfigDrawer } from "@/components/ConfigDrawer";
import { useAdminRole } from "@/hooks/useAdminRole";
import { useWhatsappStatus } from "@/hooks/useWhatsappStatus";
import { InstallmentChecklist } from "@/components/InstallmentChecklist";
import { SaleInstallment, groupInstallments } from "@/lib/installments";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, CheckCircle2, XCircle, AlertCircle } from "lucide-react";

type Conversation = {
  id: string;
  contact_phone: string;
  contact_name: string | null;
  ai_enabled: boolean;
  last_message_at: string;
  instance_id: string | null;
  human_takeover_at: string | null;
  stage_id: string | null;
  deal_value: number | null;
  closed_at: string | null;
  lost_at: string | null;
  client_type: string | null;
  installment_plan: number | null;
  due_day: number | null;
  notes: string | null;
  lead_source_id: string | null;
};

type Tag = { id: string; name: string; color: string };
type Reminder = { id: string; conversation_id: string; title: string; due_at: string; done_at: string | null };
type LeadSource = { id: string; name: string };

type Message = {
  id: string;
  conversation_id: string;
  direction: "inbound" | "outbound";
  sender: "contact" | "ai" | "human";
  content: string;
  created_at: string;
};

type Stage = { id: string; name: string; position: number; color: string | null; is_won: boolean; is_lost: boolean };
type Followup = { id: string; send_at: string; kind: string; text_override: string | null };
type FollowupHistoryItem = {
  id: string;
  send_at: string;
  sent_at: string | null;
  kind: string;
  status: string;
  text_override: string | null;
  error: string | null;
  created_at: string;
};

/** Só dígitos — mesmo formato que o webhook grava (jidToPhone), pra achar a
 *  conversa certa quando o cliente responder depois. */
function normalizePhone(v: string): string {
  return v.replace(/\D/g, "");
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "agora";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 24) return rem ? `${h}h ${rem}min` : `${h}h`;
  const d = Math.floor(h / 24);
  const hr = h % 24;
  return hr ? `${d}d ${hr}h` : `${d}d`;
}

export default function Conversas() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAdmin } = useAdminRole();
  const { connected: waConnected, hasInstance: waHasInstance } = useWhatsappStatus();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [installments, setInstallments] = useState<SaleInstallment[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [stages, setStages] = useState<Stage[]>([]);
  const [followups, setFollowups] = useState<Followup[]>([]);
  const [followupHistory, setFollowupHistory] = useState<FollowupHistoryItem[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [fuText, setFuText] = useState("");
  const [fuPreset, setFuPreset] = useState("1h");
  const [fuCustom, setFuCustom] = useState("");
  const [fuOpen, setFuOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // "Novo contato" — 1º contato do PAP: o vendedor manda ele mesmo a mensagem
  // de abertura, mas SEM entrar em modo humano — a IA assume a partir da
  // resposta do cliente (diferente do envio manual numa conversa já existente).
  const [ncOpen, setNcOpen] = useState(false);
  const [ncName, setNcName] = useState("");
  const [ncPhone, setNcPhone] = useState("");
  const [ncMessage, setNcMessage] = useState("");
  const [ncSending, setNcSending] = useState(false);

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) || null,
    [conversations, activeId],
  );

  // Valor da venda: campo de texto local (não direto no estado global) pra não
  // "brigar" com o usuário digitando enquanto o realtime atualiza a lista.
  const [dealValueInput, setDealValueInput] = useState("");
  useEffect(() => {
    setDealValueInput(active?.deal_value != null ? String(active.deal_value) : "");
  }, [active?.id, active?.deal_value]);

  const saveDealValue = async () => {
    if (!active) return;
    const raw = dealValueInput.replace(",", ".").trim();
    const value = raw === "" ? null : Number(raw);
    if (raw !== "" && (Number.isNaN(value) || (value as number) < 0)) {
      toast({ variant: "destructive", title: "Valor inválido", description: "Use só números, ex: 149.90" });
      setDealValueInput(active.deal_value != null ? String(active.deal_value) : "");
      return;
    }
    if (value === active.deal_value) return;
    const { error } = await supabase.from("conversations").update({ deal_value: value }).eq("id", active.id);
    if (error) toast({ variant: "destructive", title: "Erro", description: error.message });
  };

  // Notas da conversa: mesmo padrão do valor da venda (campo local + save
  // ao perder o foco / fechar o popover), só que texto livre.
  const [notesInput, setNotesInput] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  useEffect(() => {
    setNotesInput(active?.notes ?? "");
  }, [active?.id, active?.notes]);

  const saveNotes = async () => {
    if (!active) return;
    const value = notesInput.trim() || null;
    if (value === (active.notes ?? null)) return;
    const { error } = await supabase.from("conversations").update({ notes: value }).eq("id", active.id);
    if (error) toast({ variant: "destructive", title: "Erro", description: error.message });
  };

  // Tags: catálogo pessoal (tags) + junção por conversa (conversation_tags).
  // Opções fixas que o próprio vendedor cadastra e mantém (não é texto livre).
  const [tags, setTags] = useState<Tag[]>([]);
  const [conversationTagIds, setConversationTagIds] = useState<Record<string, string[]>>({});
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#64748b");
  const [search, setSearch] = useState("");

  const loadTagsData = async () => {
    const [{ data: tagRows }, { data: ctRows }] = await Promise.all([
      supabase.from("tags").select("*").order("name", { ascending: true }),
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
    loadTagsData();
    const ch = supabase
      .channel("conversas-tags")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tags", filter: `user_id=eq.${user.id}` },
        loadTagsData,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversation_tags", filter: `user_id=eq.${user.id}` },
        loadTagsData,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user]);

  const createTag = async () => {
    if (!user) return;
    const name = newTagName.trim();
    if (!name) return;
    const { data, error } = await supabase
      .from("tags")
      .insert({ user_id: user.id, name, color: newTagColor })
      .select()
      .single();
    if (error) {
      toast({ variant: "destructive", title: "Erro", description: error.message });
      return;
    }
    if (data) {
      setTags((prev) => [...prev, data as Tag].sort((a, b) => a.name.localeCompare(b.name)));
    }
    setNewTagName("");
  };

  const deleteTag = async (id: string) => {
    const { error } = await supabase.from("tags").delete().eq("id", id);
    if (error) {
      toast({ variant: "destructive", title: "Erro", description: error.message });
      return;
    }
    setTags((prev) => prev.filter((t) => t.id !== id));
    setConversationTagIds((prev) => {
      const next: Record<string, string[]> = {};
      Object.entries(prev).forEach(([convId, ids]) => {
        next[convId] = ids.filter((t) => t !== id);
      });
      return next;
    });
  };

  const toggleConversationTag = async (tagId: string) => {
    if (!active || !user) return;
    const current = conversationTagIds[active.id] || [];
    const has = current.includes(tagId);
    if (has) {
      setConversationTagIds((prev) => ({
        ...prev,
        [active.id]: (prev[active.id] || []).filter((t) => t !== tagId),
      }));
      const { error } = await supabase
        .from("conversation_tags")
        .delete()
        .eq("conversation_id", active.id)
        .eq("tag_id", tagId);
      if (error) {
        toast({ variant: "destructive", title: "Erro", description: error.message });
        loadTagsData();
      }
    } else {
      setConversationTagIds((prev) => ({
        ...prev,
        [active.id]: [...(prev[active.id] || []), tagId],
      }));
      const { error } = await supabase
        .from("conversation_tags")
        .insert({ user_id: user.id, conversation_id: active.id, tag_id: tagId });
      if (error) {
        toast({ variant: "destructive", title: "Erro", description: error.message });
        loadTagsData();
      }
    }
  };

  // Origem do lead: catálogo pessoal (lead_sources), mesma filosofia das tags
  // (o vendedor cadastra e mantém, não é texto livre) — mas é um campo único
  // por conversa (FK direta em conversations.lead_source_id), não uma junção.
  const [leadSources, setLeadSources] = useState<LeadSource[]>([]);
  const [leadSourcePopoverOpen, setLeadSourcePopoverOpen] = useState(false);
  const [newLeadSourceName, setNewLeadSourceName] = useState("");

  const loadLeadSources = async () => {
    const { data } = await supabase.from("lead_sources").select("id, name").order("name", { ascending: true });
    setLeadSources((data as LeadSource[]) || []);
  };

  useEffect(() => {
    if (!user) return;
    loadLeadSources();
    const ch = supabase
      .channel("conversas-lead-sources")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "lead_sources", filter: `user_id=eq.${user.id}` },
        loadLeadSources,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user]);

  const createLeadSource = async () => {
    if (!user) return;
    const name = newLeadSourceName.trim();
    if (!name) return;
    const { data, error } = await supabase
      .from("lead_sources")
      .insert({ user_id: user.id, name })
      .select()
      .single();
    if (error) {
      toast({ variant: "destructive", title: "Erro", description: error.message });
      return;
    }
    if (data) {
      setLeadSources((prev) => [...prev, data as LeadSource].sort((a, b) => a.name.localeCompare(b.name)));
      // Já atribui à conversa aberta — fluxo comum: cadastrar a origem na hora de marcar.
      if (active) setLeadSource((data as LeadSource).id);
    }
    setNewLeadSourceName("");
  };

  const deleteLeadSource = async (id: string) => {
    const { error } = await supabase.from("lead_sources").delete().eq("id", id);
    if (error) {
      toast({ variant: "destructive", title: "Erro", description: error.message });
      return;
    }
    // ON DELETE SET NULL já limpa conversations.lead_source_id no banco; espelha localmente.
    setLeadSources((prev) => prev.filter((s) => s.id !== id));
    setConversations((prev) => prev.map((c) => (c.lead_source_id === id ? { ...c, lead_source_id: null } : c)));
  };

  const setLeadSource = async (sourceId: string | null) => {
    if (!active) return;
    setConversations((prev) =>
      prev.map((c) => (c.id === active.id ? { ...c, lead_source_id: sourceId } : c)),
    );
    const { error } = await supabase.from("conversations").update({ lead_source_id: sourceId }).eq("id", active.id);
    if (error) toast({ variant: "destructive", title: "Erro", description: error.message });
  };

  // Busca na lista: nome, telefone, notas e nome das tags.
  const filteredConversations = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => {
      const name = (c.contact_name || "").toLowerCase();
      const phone = c.contact_phone.toLowerCase();
      const notes = (c.notes || "").toLowerCase();
      const tagNames = (conversationTagIds[c.id] || [])
        .map((tid) => tags.find((t) => t.id === tid)?.name.toLowerCase() || "")
        .join(" ");
      return name.includes(q) || phone.includes(q) || notes.includes(q) || tagNames.includes(q);
    });
  }, [conversations, search, conversationTagIds, tags]);

  // Lembretes de tarefa — lista interna por conversa, sem notificação push
  // (decisão do usuário). Carrega todos os pendentes do vendedor de uma vez
  // (não só da conversa aberta) pra alimentar a lista global no sininho.
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [remindersDialogOpen, setRemindersDialogOpen] = useState(false);
  const [reminderPopoverOpen, setReminderPopoverOpen] = useState(false);
  const [newReminderTitle, setNewReminderTitle] = useState("");
  const [remPreset, setRemPreset] = useState("tomorrow");
  const [remCustom, setRemCustom] = useState("");

  const loadReminders = async () => {
    const { data } = await supabase
      .from("reminders")
      .select("id, conversation_id, title, due_at, done_at")
      .is("done_at", null)
      .order("due_at", { ascending: true });
    setReminders((data as Reminder[]) || []);
  };

  useEffect(() => {
    if (!user) return;
    loadReminders();
    const ch = supabase
      .channel("conversas-reminders")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "reminders", filter: `user_id=eq.${user.id}` },
        loadReminders,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user]);

  const scheduleReminder = async () => {
    if (!active || !user) return;
    const title = newReminderTitle.trim();
    if (!title) {
      toast({ variant: "destructive", title: "Escreva o que precisa lembrar" });
      return;
    }
    let dueAt: Date;
    const now = Date.now();
    if (remPreset === "later_today") dueAt = new Date(now + 3 * 3600_000);
    else if (remPreset === "tomorrow") {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      dueAt = d;
    } else if (remPreset === "this_week") {
      const d = new Date();
      d.setDate(d.getDate() + 3);
      d.setHours(9, 0, 0, 0);
      dueAt = d;
    } else if (remPreset === "custom") {
      if (!remCustom) {
        toast({ variant: "destructive", title: "Escolha data e hora" });
        return;
      }
      dueAt = new Date(remCustom);
    } else return;

    const { error } = await supabase.from("reminders").insert({
      user_id: user.id,
      conversation_id: active.id,
      title,
      due_at: dueAt.toISOString(),
    });
    if (error) {
      toast({ variant: "destructive", title: "Erro", description: error.message });
    } else {
      toast({ title: "Lembrete criado" });
      setNewReminderTitle("");
      setRemCustom("");
      setReminderPopoverOpen(false);
    }
  };

  const completeReminder = async (id: string) => {
    setReminders((prev) => prev.filter((r) => r.id !== id));
    const { error } = await supabase.from("reminders").update({ done_at: new Date().toISOString() }).eq("id", id);
    if (error) {
      toast({ variant: "destructive", title: "Erro", description: error.message });
      loadReminders();
    }
  };

  const deleteReminder = async (id: string) => {
    setReminders((prev) => prev.filter((r) => r.id !== id));
    const { error } = await supabase.from("reminders").delete().eq("id", id);
    if (error) {
      toast({ variant: "destructive", title: "Erro", description: error.message });
      loadReminders();
    }
  };

  const conversationReminders = useMemo(
    () => (active ? reminders.filter((r) => r.conversation_id === active.id) : []),
    [reminders, active],
  );
  const overdueCount = useMemo(
    () => reminders.filter((r) => new Date(r.due_at).getTime() <= Date.now()).length,
    [reminders],
  );

  // Load conversations + realtime
  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data } = await supabase
        .from("conversations")
        .select("*")
        .order("last_message_at", { ascending: false });
      setConversations((data as Conversation[]) || []);
      const openParam = searchParams.get("open");
      if (openParam && data?.some((c: any) => c.id === openParam)) {
        setActiveId(openParam);
        // Vem de um link "Cobrar" (Relatórios) com uma mensagem pronta pro
        // vendedor revisar e personalizar antes de mandar — nunca envia sozinho.
        const draftParam = searchParams.get("draft");
        if (draftParam) setInput(decodeURIComponent(draftParam));
      } else if (data?.length && !activeId) {
        setActiveId(data[0].id);
      }
    };
    load();

    const ch = supabase
      .channel("conversations-list")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations", filter: `user_id=eq.${user.id}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user]);

  // Load stages
  useEffect(() => {
    if (!user) return;
    supabase
      .from("pipeline_stages")
      .select("*")
      .eq("user_id", user.id)
      .order("position", { ascending: true })
      .then(({ data }) => setStages((data as Stage[]) || []));
  }, [user]);

  // Load parcelas (comissão) + realtime
  const loadInstallments = async () => {
    const { data } = await supabase
      .from("sale_installments")
      .select("id, conversation_id, installment_no, paid_at");
    setInstallments((data as SaleInstallment[]) || []);
  };
  useEffect(() => {
    if (!user) return;
    loadInstallments();
    const ch = supabase
      .channel("conversas-installments")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sale_installments", filter: `user_id=eq.${user.id}` },
        loadInstallments,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user]);

  // Load followups for active conversation
  useEffect(() => {
    if (!activeId) {
      setFollowups([]);
      setFollowupHistory([]);
      return;
    }
    const load = async () => {
      const [{ data: pending }, { data: hist }] = await Promise.all([
        supabase
          .from("followups")
          .select("id, send_at, kind, text_override")
          .eq("conversation_id", activeId)
          .eq("status", "pending")
          .order("send_at", { ascending: true }),
        supabase
          .from("followups")
          .select("id, send_at, sent_at, kind, status, text_override, error, created_at")
          .eq("conversation_id", activeId)
          .neq("status", "pending")
          .neq("status", "sending")
          .order("created_at", { ascending: false })
          .limit(10),
      ]);
      setFollowups((pending as Followup[]) || []);
      setFollowupHistory((hist as FollowupHistoryItem[]) || []);
    };
    load();
    const ch = supabase
      .channel(`followups-${activeId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "followups", filter: `conversation_id=eq.${activeId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [activeId]);

  // Tick para atualizar contagem regressiva dos follow-ups
  useEffect(() => {
    if (followups.length === 0) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [followups.length]);

  // Load messages for active + realtime
  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    const load = async () => {
      // Busca as mais recentes (o servidor limita a 1000 linhas): em conversa muito longa,
      // ordenar do mais antigo cortaria justamente as mensagens novas.
      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", activeId)
        .order("created_at", { ascending: false })
        .limit(1000);
      setMessages(((data as Message[]) || []).reverse());
    };
    load();

    const ch = supabase
      .channel(`messages-${activeId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${activeId}` },
        (payload) => setMessages((prev) => [...prev, payload.new as Message]),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [activeId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  // Detect setup completion (Groq key configured)
  useEffect(() => {
    if (!user) return;
    const check = async () => {
      const { data: agent } = await supabase
        .from("agent_configs")
        .select("groq_api_key")
        .eq("user_id", user.id)
        .maybeSingle();
      setNeedsSetup(!agent?.groq_api_key);
    };
    check();
  }, [user, configOpen]);

  // Ao abrir "Novo contato", pré-preenche com o modelo salvo em Configurações
  // (o vendedor ainda pode editar antes de enviar).
  useEffect(() => {
    if (!ncOpen || !user) return;
    supabase
      .from("agent_configs")
      .select("opening_message_template")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.opening_message_template) setNcMessage((prev) => prev || data.opening_message_template);
      });
  }, [ncOpen, user]);

  const startConversation = async () => {
    if (!user) return;
    const name = ncName.trim();
    const phone = normalizePhone(ncPhone);
    const message = ncMessage.trim();
    if (!phone || phone.length < 10) {
      toast({ variant: "destructive", title: "Telefone inválido", description: "Informe o número com DDD (e o 55 do Brasil, se preferir)." });
      return;
    }
    if (!message) {
      toast({ variant: "destructive", title: "Escreva a mensagem de abertura" });
      return;
    }
    setNcSending(true);
    try {
      // Já existe conversa com esse número? Abre ela em vez de duplicar.
      const { data: existing } = await supabase
        .from("conversations")
        .select("id")
        .eq("user_id", user.id)
        .eq("contact_phone", phone)
        .maybeSingle();
      if (existing) {
        toast({ title: "Já existe uma conversa com esse número", description: "Abrindo a conversa existente." });
        setActiveId(existing.id);
        setNcOpen(false);
        return;
      }

      const { data: inst } = await supabase
        .from("whatsapp_instances")
        .select("instance_token")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!inst?.instance_token) throw new Error("Nenhuma instância WhatsApp conectada");

      // Manda primeiro: só cria a conversa/mensagem se o envio realmente funcionar
      // (evita ficar com uma conversa "fantasma" sem nenhuma mensagem se falhar).
      const { data, error } = await supabase.functions.invoke("manage-instance", {
        body: {
          action: "send_text",
          instance_token: inst.instance_token,
          number: phone,
          text: message,
        },
      });
      if (error || !data?.ok) throw new Error(data?.error || error?.message || "Falha ao enviar");

      const { data: firstStage } = await supabase
        .from("pipeline_stages")
        .select("id")
        .eq("user_id", user.id)
        .order("position", { ascending: true })
        .limit(1)
        .maybeSingle();

      const { data: conv, error: convErr } = await supabase
        .from("conversations")
        .insert({
          user_id: user.id,
          contact_phone: phone,
          contact_name: name || null,
          stage_id: firstStage?.id ?? null,
          last_message_at: new Date().toISOString(),
          // Explícito (mesmo sendo o padrão da coluna no banco real): você
          // abriu a conversa, mas a IA já assume a partir da resposta do
          // cliente, sem precisar "Reativar IA" depois.
          ai_enabled: true,
          human_takeover_at: null,
        })
        .select("id")
        .single();
      if (convErr || !conv) throw new Error(convErr?.message || "Falha ao criar a conversa");

      await supabase.from("messages").insert({
        conversation_id: conv.id,
        user_id: user.id,
        direction: "outbound",
        sender: "human",
        content: message,
      });

      toast({ title: "Mensagem enviada!", description: "A IA responde sozinha a partir da resposta do cliente." });
      setActiveId(conv.id);
      setNcOpen(false);
      setNcName("");
      setNcPhone("");
      setNcMessage("");
    } catch (e: any) {
      toast({ variant: "destructive", title: "Erro", description: e.message });
    } finally {
      setNcSending(false);
    }
  };

  const handleLogout = async () => {
    await signOut();
    navigate("/login");
  };

  const toggleAI = async (enabled: boolean) => {
    if (!active) return;
    if (enabled) {
      const { error } = await supabase
        .from("conversations")
        .update({ ai_enabled: true, human_takeover_at: null as unknown as string })
        .eq("id", active.id);
      if (error) toast({ variant: "destructive", title: "Erro", description: error.message });
    } else {
      // Humano assume via toggle → cancela pendentes e zera contador
      const { error } = await supabase
        .from("conversations")
        .update({
          ai_enabled: false,
          human_takeover_at: new Date().toISOString(),
          inactivity_followup_at: null,
          auto_followup_count: 0,
        })
        .eq("id", active.id);
      if (error) {
        toast({ variant: "destructive", title: "Erro", description: error.message });
        return;
      }
      await supabase
        .from("followups")
        .update({ status: "cancelled" })
        .eq("conversation_id", active.id)
        .eq("status", "pending");
    }
  };

  const changeStage = async (stageId: string) => {
    if (!active) return;
    await supabase.from("conversations").update({ stage_id: stageId }).eq("id", active.id);
  };

  const scheduleFollowup = async () => {
    if (!active || !user) return;
    let sendAt: Date;
    const now = Date.now();
    if (fuPreset === "1min") sendAt = new Date(now + 60_000);
    else if (fuPreset === "1h") sendAt = new Date(now + 3600_000);
    else if (fuPreset === "3h") sendAt = new Date(now + 3 * 3600_000);
    else if (fuPreset === "tomorrow") {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      sendAt = d;
    } else if (fuPreset === "2d") sendAt = new Date(now + 2 * 86400_000);
    else if (fuPreset === "custom") {
      if (!fuCustom) {
        toast({ variant: "destructive", title: "Escolha data e hora" });
        return;
      }
      sendAt = new Date(fuCustom);
    } else return;

    const { error } = await supabase.from("followups").insert({
      user_id: user.id,
      conversation_id: active.id,
      send_at: sendAt.toISOString(),
      status: "pending",
      kind: "manual",
      text_override: fuText.trim() || null,
    });
    if (error) {
      toast({ variant: "destructive", title: "Erro", description: error.message });
    } else {
      const isToday = sendAt.toDateString() === new Date().toDateString();
      const when = sendAt.toLocaleString("pt-BR", {
        day: isToday ? undefined : "2-digit",
        month: isToday ? undefined : "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      toast({
        title: "Follow-up agendado",
        description: isToday ? `Será enviado hoje às ${when}` : `Será enviado em ${when}`,
      });
      setFuText("");
      setFuCustom("");
      setFuOpen(false);
    }
  };

  const cancelFollowup = async (id: string) => {
    const target = followups.find((f) => f.id === id);
    // Otimista: remove da lista pendente e insere no topo do histórico
    setFollowups((prev) => prev.filter((f) => f.id !== id));
    if (target) {
      setFollowupHistory((prev) => [
        {
          id: target.id,
          send_at: target.send_at,
          sent_at: null,
          kind: target.kind,
          status: "cancelled",
          text_override: target.text_override,
          error: null,
          created_at: new Date().toISOString(),
        },
        ...prev,
      ]);
    }
    setCancelId(null);

    const { error } = await supabase
      .from("followups")
      .update({ status: "cancelled" })
      .eq("id", id);
    if (error) {
      // Reverte
      if (target) {
        setFollowups((prev) => [...prev, target].sort((a, b) => a.send_at.localeCompare(b.send_at)));
        setFollowupHistory((prev) => prev.filter((h) => h.id !== id));
      }
      toast({ variant: "destructive", title: "Erro ao cancelar", description: error.message });
    } else {
      toast({ title: "Follow-up cancelado", description: "A mensagem não será enviada." });
    }
  };

  const send = async () => {
    if (!input.trim() || !active) return;
    setSending(true);
    try {
      // Fetch instance token
      const { data: inst } = await supabase
        .from("whatsapp_instances")
        .select("instance_token")
        .eq("user_id", user!.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!inst?.instance_token) throw new Error("Nenhuma instância WhatsApp conectada");

      const { data, error } = await supabase.functions.invoke("manage-instance", {
        body: {
          action: "send_text",
          instance_token: inst.instance_token,
          number: active.contact_phone,
          text: input.trim(),
        },
      });
      if (error || !data?.ok) throw new Error(data?.error || error?.message || "Falha ao enviar");

      await supabase.from("messages").insert({
        conversation_id: active.id,
        user_id: user!.id,
        direction: "outbound",
        sender: "human",
        content: input.trim(),
      });
      // Humano assumiu → pausa a IA e registra o timestamp. NÃO há retomada
      // automática: a IA só volta quando o usuário clica "Reativar IA".
      await supabase
        .from("conversations")
        .update({
          last_message_at: new Date().toISOString(),
          ai_enabled: false,
          human_takeover_at: new Date().toISOString(),
        })
        .eq("id", active.id);
      setInput("");
    } catch (e: any) {
      toast({ variant: "destructive", title: "Erro", description: e.message });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="border-b px-4 h-14 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Logo horizontal width={26} height={26} />
          <nav className="hidden sm:flex items-center gap-1 ml-2">
            <Link to="/" className="px-3 py-1.5 text-sm rounded-md bg-muted font-medium">
              Conversas
            </Link>
            <Link
              to="/kanban"
              className="px-3 py-1.5 text-sm rounded-md text-muted-foreground hover:bg-muted transition"
            >
              Kanban
            </Link>
            <Link
              to="/relatorios"
              className="px-3 py-1.5 text-sm rounded-md text-muted-foreground hover:bg-muted transition"
            >
              Relatórios
            </Link>
            <Link
              to="/transmissao"
              className="px-3 py-1.5 text-sm rounded-md text-muted-foreground hover:bg-muted transition"
            >
              Transmissão
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="sm:hidden" onClick={() => navigate("/kanban")} title="Kanban">
            <Trello className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="sm:hidden" onClick={() => navigate("/relatorios")} title="Relatórios">
            <BarChart3 className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="sm:hidden" onClick={() => navigate("/transmissao")} title="Transmissão">
            <Megaphone className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="relative"
            onClick={() => setRemindersDialogOpen(true)}
            title="Lembretes"
          >
            <Bell className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Lembretes</span>
            {reminders.length > 0 && (
              <span
                className={`absolute -top-1 -right-1 sm:static sm:ml-1.5 text-[10px] rounded-full px-1.5 py-0.5 leading-none ${
                  overdueCount > 0
                    ? "bg-destructive text-destructive-foreground"
                    : "bg-primary text-primary-foreground"
                }`}
              >
                {reminders.length}
              </span>
            )}
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
          <ThemeToggle />
          {isAdmin && (
            <Button variant="ghost" size="sm" onClick={() => navigate("/admin/equipe")}>
              Equipe
            </Button>
          )}
          {isAdmin && (
            <Button variant="ghost" size="sm" onClick={() => navigate("/admin/uazapi")}>
              Admin
            </Button>
          )}
          <Button
            variant={needsSetup ? "default" : "ghost"}
            size="sm"
            onClick={() => setConfigOpen(true)}
          >
            <Settings className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Configuração</span>
          </Button>
          <Button variant="ghost" size="icon" onClick={handleLogout} title="Sair">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </header>

      <ConfigDrawer open={configOpen} onOpenChange={setConfigOpen} />

      <Dialog open={remindersDialogOpen} onOpenChange={setRemindersDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Lembretes pendentes</DialogTitle>
            <DialogDescription>
              Todos os lembretes que você criou, de todas as conversas, ordenados pelo mais próximo de vencer.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto space-y-2">
            {reminders.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">Nenhum lembrete pendente.</p>
            )}
            {reminders.map((r) => {
              const conv = conversations.find((c) => c.id === r.conversation_id);
              const overdue = new Date(r.due_at).getTime() <= Date.now();
              return (
                <div
                  key={r.id}
                  className={`flex items-center gap-2 border rounded-md px-3 py-2 text-sm ${
                    overdue ? "border-destructive/40 bg-destructive/5" : ""
                  }`}
                >
                  <Bell className={`w-4 h-4 shrink-0 ${overdue ? "text-destructive" : "text-primary"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{r.title}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {conv ? conv.contact_name || conv.contact_phone : "Conversa removida"}
                      {" · "}
                      <span className={overdue ? "text-destructive" : ""}>
                        {overdue ? "atrasado — " : ""}
                        {new Date(r.due_at).toLocaleString("pt-BR", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {conv && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => {
                          setActiveId(conv.id);
                          setRemindersDialogOpen(false);
                        }}
                      >
                        Abrir
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-success hover:text-success"
                      onClick={() => completeReminder(r.id)}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Concluir
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* Main */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-[320px_1fr] gap-0 overflow-hidden">
        {/* Sidebar list */}
        <div className="border-r overflow-hidden flex flex-col bg-card">
          <div className="p-3 border-b font-semibold text-sm flex items-center justify-between gap-2 shrink-0">
            <span className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4" /> Conversas
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setNcOpen(true)}
              title="Iniciar conversa com um novo contato (ex.: PAP)"
            >
              <UserPlus className="w-3.5 h-3.5 mr-1" /> Novo contato
            </Button>
          </div>
          <div className="px-3 py-2 border-b shrink-0">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome, telefone, nota ou tag..."
                className="h-8 pl-8 text-xs"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {needsSetup && (
              <button
                onClick={() => setConfigOpen(true)}
                className="w-full text-left p-4 border-b bg-primary/5 hover:bg-primary/10 transition"
              >
                <div className="flex items-center gap-2 font-medium text-sm">
                  <Sparkles className="w-4 h-4 text-primary" />
                  Configure em 2 passos
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Cole sua chave da Groq e conecte o WhatsApp para começar.
                </p>
              </button>
            )}
            {conversations.length === 0 && (
              <div className="p-6 text-sm text-muted-foreground text-center">
                Nenhuma conversa ainda. Quando o WhatsApp receber mensagens, elas aparecem aqui.
              </div>
            )}
            {conversations.length > 0 && filteredConversations.length === 0 && (
              <div className="p-6 text-sm text-muted-foreground text-center">
                Nenhuma conversa encontrada para "{search}".
              </div>
            )}
            {filteredConversations.map((c) => {
              const convTags = (conversationTagIds[c.id] || [])
                .map((tid) => tags.find((t) => t.id === tid))
                .filter(Boolean) as Tag[];
              return (
                <button
                  key={c.id}
                  onClick={() => setActiveId(c.id)}
                  className={`w-full text-left px-3 py-3 border-b hover:bg-muted transition ${
                    c.id === activeId ? "bg-muted" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm truncate">
                      {c.contact_name || c.contact_phone}
                    </span>
                    <Badge variant={c.ai_enabled ? "default" : "secondary"} className="text-[10px]">
                      {c.ai_enabled ? "IA" : "Humano"}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{c.contact_phone}</div>
                  {convTags.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap mt-1">
                      {convTags.map((t) => (
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
                </button>
              );
            })}
          </div>
        </div>

        {/* Chat panel */}
        <div className="flex flex-col bg-background overflow-hidden" style={brandWatermarkStyle}>
          {!active ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              Selecione uma conversa
            </div>
          ) : (
            <>
              <div className="p-3 border-b flex items-center justify-between">
                <div>
                  <div className="font-semibold text-sm">
                    {active.contact_name || active.contact_phone}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {active.contact_phone}
                    {!active.ai_enabled && active.human_takeover_at && (
                      <span className="ml-2 text-primary">
                        · Humano assumiu — reative a IA manualmente
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1 text-xs">
                    <span className="text-muted-foreground">R$</span>
                    <Input
                      value={dealValueInput}
                      onChange={(e) => setDealValueInput(e.target.value)}
                      onBlur={saveDealValue}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      placeholder="valor"
                      inputMode="decimal"
                      title="Valor da venda"
                      className="h-8 w-20 text-xs"
                    />
                  </div>
                  {active.closed_at && (
                    <Badge className="bg-success text-success-foreground text-[10px]">Ganha</Badge>
                  )}
                  {active.lost_at && (
                    <Badge variant="destructive" className="text-[10px]">Perdida</Badge>
                  )}
                  {stages.length > 0 && (
                    <Select value={active.stage_id ?? undefined} onValueChange={changeStage}>
                      <SelectTrigger className="h-8 w-[140px] text-xs">
                        <SelectValue placeholder="Stage" />
                      </SelectTrigger>
                      <SelectContent>
                        {stages.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    {active.ai_enabled ? (
                      <Bot className="w-4 h-4 text-primary" />
                    ) : (
                      <User className="w-4 h-4" />
                    )}
                    IA
                    <Switch checked={active.ai_enabled} onCheckedChange={toggleAI} />
                  </label>
                </div>
              </div>

              {/* Tags e notas da conversa */}
              <div className="px-3 py-2 border-b flex items-center gap-2 flex-wrap bg-muted/10">
                {(conversationTagIds[active.id] || [])
                  .map((tid) => tags.find((t) => t.id === tid))
                  .filter(Boolean)
                  .map((t) => (
                    <Badge
                      key={(t as Tag).id}
                      variant="outline"
                      className="text-[10px] gap-1 pr-1"
                      style={{ borderColor: (t as Tag).color, color: (t as Tag).color }}
                    >
                      {(t as Tag).name}
                      <button
                        onClick={() => toggleConversationTag((t as Tag).id)}
                        className="hover:text-destructive"
                        title="Remover tag desta conversa"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </Badge>
                  ))}
                <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-6 text-[11px]">
                      <TagIcon className="w-3 h-3 mr-1" /> Tags
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 space-y-3" align="start">
                    <div className="space-y-1">
                      <Label className="text-xs">Tags desta conversa</Label>
                      {tags.length === 0 && (
                        <p className="text-xs text-muted-foreground">Nenhuma tag cadastrada ainda.</p>
                      )}
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {tags.map((t) => {
                          const checked = (conversationTagIds[active.id] || []).includes(t.id);
                          return (
                            <button
                              key={t.id}
                              onClick={() => toggleConversationTag(t.id)}
                              className="w-full flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded hover:bg-muted"
                            >
                              <span className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: t.color }} />
                                {t.name}
                              </span>
                              {checked && <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="space-y-1.5 pt-2 border-t">
                      <Label className="text-xs">Nova tag</Label>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="color"
                          value={newTagColor}
                          onChange={(e) => setNewTagColor(e.target.value)}
                          className="h-7 w-7 rounded border cursor-pointer shrink-0"
                          title="Cor da tag"
                        />
                        <Input
                          value={newTagName}
                          onChange={(e) => setNewTagName(e.target.value)}
                          placeholder="Ex.: VIP, Urgente..."
                          className="h-7 text-xs"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              createTag();
                            }
                          }}
                        />
                        <Button size="sm" className="h-7 px-2 shrink-0" onClick={createTag} disabled={!newTagName.trim()}>
                          <Plus className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                    {tags.length > 0 && (
                      <div className="space-y-1 pt-2 border-t">
                        <Label className="text-xs text-muted-foreground">Gerenciar (excluir tira de todas as conversas)</Label>
                        <div className="space-y-1 max-h-28 overflow-y-auto">
                          {tags.map((t) => (
                            <div key={t.id} className="flex items-center justify-between gap-2 text-xs px-2 py-1">
                              <span className="flex items-center gap-2 truncate">
                                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: t.color }} />
                                <span className="truncate">{t.name}</span>
                              </span>
                              <button
                                onClick={() => deleteTag(t.id)}
                                className="text-muted-foreground hover:text-destructive shrink-0"
                                title="Excluir esta tag"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
                <Popover
                  open={notesOpen}
                  onOpenChange={(o) => {
                    setNotesOpen(o);
                    if (!o) saveNotes();
                  }}
                >
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`h-6 text-[11px] ${active.notes ? "text-primary" : ""}`}
                    >
                      <StickyNote className="w-3 h-3 mr-1" /> Notas
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 space-y-2" align="start">
                    <Label className="text-xs">Notas sobre esta conversa</Label>
                    <Textarea
                      value={notesInput}
                      onChange={(e) => setNotesInput(e.target.value)}
                      onBlur={saveNotes}
                      rows={5}
                      placeholder="Ex.: prefere ser contatado à noite, já tem outro plano com a concorrente..."
                    />
                  </PopoverContent>
                </Popover>
                <Popover open={leadSourcePopoverOpen} onOpenChange={setLeadSourcePopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`h-6 text-[11px] ${active.lead_source_id ? "text-primary" : ""}`}
                    >
                      <MapPin className="w-3 h-3 mr-1" />
                      {leadSources.find((s) => s.id === active.lead_source_id)?.name || "Origem"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 space-y-3" align="start">
                    <div className="space-y-1">
                      <Label className="text-xs">De onde veio este lead</Label>
                      {leadSources.length === 0 && (
                        <p className="text-xs text-muted-foreground">Nenhuma origem cadastrada ainda.</p>
                      )}
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        <button
                          onClick={() => setLeadSource(null)}
                          className="w-full flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded hover:bg-muted"
                        >
                          <span className="text-muted-foreground">Nenhuma</span>
                          {!active.lead_source_id && <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" />}
                        </button>
                        {leadSources.map((s) => (
                          <button
                            key={s.id}
                            onClick={() => setLeadSource(s.id)}
                            className="w-full flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded hover:bg-muted"
                          >
                            <span>{s.name}</span>
                            {active.lead_source_id === s.id && (
                              <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" />
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-1.5 pt-2 border-t">
                      <Label className="text-xs">Nova origem</Label>
                      <div className="flex items-center gap-1.5">
                        <Input
                          value={newLeadSourceName}
                          onChange={(e) => setNewLeadSourceName(e.target.value)}
                          placeholder="Ex.: Indicação, Panfleto, Bairro X..."
                          className="h-7 text-xs"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              createLeadSource();
                            }
                          }}
                        />
                        <Button
                          size="sm"
                          className="h-7 px-2 shrink-0"
                          onClick={createLeadSource}
                          disabled={!newLeadSourceName.trim()}
                        >
                          <Plus className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                    {leadSources.length > 0 && (
                      <div className="space-y-1 pt-2 border-t">
                        <Label className="text-xs text-muted-foreground">Gerenciar (excluir tira de todas as conversas)</Label>
                        <div className="space-y-1 max-h-28 overflow-y-auto">
                          {leadSources.map((s) => (
                            <div key={s.id} className="flex items-center justify-between gap-2 text-xs px-2 py-1">
                              <span className="truncate">{s.name}</span>
                              <button
                                onClick={() => deleteLeadSource(s.id)}
                                className="text-muted-foreground hover:text-destructive shrink-0"
                                title="Excluir esta origem"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
              </div>

              {active.installment_plan != null && (
                <div className="px-3 py-2 border-b bg-muted/20">
                  <InstallmentChecklist
                    conversationId={active.id}
                    userId={user!.id}
                    clientType={active.client_type}
                    installmentPlan={active.installment_plan}
                    dueDay={active.due_day}
                    installments={groupInstallments(installments)[active.id] || []}
                    onChanged={loadInstallments}
                  />
                </div>
              )}

              {/* Lembretes de tarefa desta conversa (pessoal, sem relação com a IA/WhatsApp) */}
              <div className="px-3 py-2 border-b bg-muted/30 space-y-1.5">
                {conversationReminders.length > 0 && (
                  <div className="space-y-1.5">
                    {conversationReminders.map((r) => {
                      const overdue = new Date(r.due_at).getTime() <= Date.now();
                      return (
                        <div
                          key={r.id}
                          className={`flex items-center gap-2 bg-background border rounded-md px-3 py-2 text-xs ${
                            overdue ? "border-destructive/40" : ""
                          }`}
                        >
                          <Bell className={`w-4 h-4 shrink-0 ${overdue ? "text-destructive" : "text-primary"}`} />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{r.title}</div>
                            <div className={`text-muted-foreground truncate ${overdue ? "text-destructive" : ""}`}>
                              {overdue ? "atrasado — " : ""}
                              {new Date(r.due_at).toLocaleString("pt-BR", {
                                day: "2-digit",
                                month: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => completeReminder(r.id)}
                          >
                            <CheckCircle2 className="w-3 h-3 mr-1" /> Concluir
                          </Button>
                          <button
                            onClick={() => deleteReminder(r.id)}
                            className="text-muted-foreground hover:text-destructive p-1"
                            title="Excluir lembrete"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <Popover open={reminderPopoverOpen} onOpenChange={setReminderPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 text-xs">
                      <Bell className="w-3 h-3 mr-1" /> Novo lembrete
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 space-y-3" align="start">
                    <div className="space-y-1.5">
                      <Label className="text-xs">O que lembrar</Label>
                      <Input
                        value={newReminderTitle}
                        onChange={(e) => setNewReminderTitle(e.target.value)}
                        placeholder="Ex.: ligar pra confirmar o endereço"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Quando</Label>
                      <Select value={remPreset} onValueChange={setRemPreset}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="later_today">Daqui a 3 horas</SelectItem>
                          <SelectItem value="tomorrow">Amanhã às 9h</SelectItem>
                          <SelectItem value="this_week">Em 3 dias às 9h</SelectItem>
                          <SelectItem value="custom">Escolher data/hora</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {remPreset === "custom" && (
                      <div className="space-y-1.5">
                        <Label className="text-xs">Data e hora</Label>
                        <Input
                          type="datetime-local"
                          value={remCustom}
                          onChange={(e) => setRemCustom(e.target.value)}
                        />
                      </div>
                    )}
                    <Button size="sm" className="w-full" onClick={scheduleReminder}>
                      Criar lembrete
                    </Button>
                  </PopoverContent>
                </Popover>
              </div>

              {/* Follow-ups pendentes / agendar */}
              <div className="px-3 py-2 border-b bg-muted/30 space-y-2">
                {followups.length > 0 && (
                  <div className="space-y-1.5">
                    {followups.map((f) => {
                      const sendMs = new Date(f.send_at).getTime();
                      const diff = sendMs - now;
                      const countdown = formatCountdown(diff);
                      const isAuto = f.kind === "auto_inactivity";
                      return (
                        <div
                          key={f.id}
                          className="flex items-center gap-2 bg-background border rounded-md px-3 py-2 text-xs"
                        >
                          <Clock className="w-4 h-4 text-primary shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium">
                              {isAuto ? "Follow-up automático (inatividade)" : "Follow-up agendado"}
                              <span className="ml-2 text-muted-foreground font-normal">
                                {diff > 0 ? `em ${countdown}` : "enviando…"}
                              </span>
                            </div>
                            <div className="text-muted-foreground truncate">
                              {new Date(f.send_at).toLocaleString("pt-BR", {
                                day: "2-digit",
                                month: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                              {" · "}
                              {f.text_override
                                ? `"${f.text_override.slice(0, 60)}${f.text_override.length > 60 ? "…" : ""}"`
                                : "IA vai gerar a mensagem"}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-destructive hover:text-destructive"
                            onClick={() => setCancelId(f.id)}
                          >
                            <X className="w-3 h-3 mr-1" /> Cancelar
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <Popover open={fuOpen} onOpenChange={setFuOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 text-xs">
                      <Clock className="w-3 h-3 mr-1" /> Agendar follow-up
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 space-y-3" align="end">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Quando</Label>
                      <Select value={fuPreset} onValueChange={setFuPreset}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1h">Em 1 hora</SelectItem>
                          <SelectItem value="3h">Em 3 horas</SelectItem>
                          <SelectItem value="tomorrow">Amanhã às 9h</SelectItem>
                          <SelectItem value="2d">Em 2 dias</SelectItem>
                          <SelectItem value="custom">Escolher data/hora</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {fuPreset === "custom" && (
                      <div className="space-y-1.5">
                        <Label className="text-xs">Data e hora</Label>
                        <Input
                          type="datetime-local"
                          value={fuCustom}
                          onChange={(e) => setFuCustom(e.target.value)}
                        />
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <Label className="text-xs">Mensagem (opcional)</Label>
                      <Textarea
                        rows={3}
                        value={fuText}
                        onChange={(e) => setFuText(e.target.value)}
                        placeholder="Deixe vazio para a IA gerar com base no histórico."
                      />
                    </div>
                    <Button size="sm" className="w-full" onClick={scheduleFollowup}>
                      Agendar
                    </Button>
                  </PopoverContent>
                  </Popover>
                  {followupHistory.length > 0 && (
                    <Collapsible open={historyOpen} onOpenChange={setHistoryOpen} className="w-full">
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground">
                          <ChevronDown
                            className={`w-3 h-3 mr-1 transition-transform ${historyOpen ? "rotate-180" : ""}`}
                          />
                          Histórico ({followupHistory.length})
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-1 space-y-1">
                        {followupHistory.map((h) => {
                          const Icon =
                            h.status === "sent"
                              ? CheckCircle2
                              : h.status === "cancelled"
                                ? XCircle
                                : AlertCircle;
                          const color =
                            h.status === "sent"
                              ? "text-emerald-600"
                              : h.status === "cancelled"
                                ? "text-muted-foreground"
                                : "text-destructive";
                          const label =
                            h.status === "sent"
                              ? "Enviado"
                              : h.status === "cancelled"
                                ? "Cancelado"
                                : "Falhou";
                          const ref = h.sent_at || h.send_at;
                          return (
                            <div
                              key={h.id}
                              className="flex items-start gap-2 bg-background border rounded-md px-2 py-1.5"
                            >
                              <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${color}`} />
                              <div className="flex-1 min-w-0">
                                <div className={`font-medium ${color}`}>
                                  {label}
                                  <span className="ml-1.5 text-muted-foreground font-normal">
                                    {new Date(ref).toLocaleString("pt-BR", {
                                      day: "2-digit",
                                      month: "2-digit",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                    {" · "}
                                    {h.kind === "auto_inactivity" ? "auto" : "manual"}
                                  </span>
                                </div>
                                {h.status === "failed" && h.error && (
                                  <div className="text-destructive/80 truncate">{h.error}</div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </div>
              </div>

              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                      m.direction === "outbound"
                        ? "ml-auto bg-primary text-primary-foreground"
                        : "bg-muted"
                    }`}
                  >
                    {m.direction === "outbound" && (
                      <div className="text-[10px] opacity-70 mb-0.5">
                        {m.sender === "ai" ? "IA" : "Você"}
                      </div>
                    )}
                    <div className="whitespace-pre-wrap">{m.content}</div>
                  </div>
                ))}
              </div>

              <div className="p-3 border-t flex gap-2">
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={active.ai_enabled ? "IA responderá automaticamente. Envie mensagem manual mesmo assim..." : "Digite sua resposta..."}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())}
                  disabled={sending}
                />
                <Button onClick={send} disabled={sending || !input.trim()}>
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
      <Dialog open={ncOpen} onOpenChange={setNcOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo contato</DialogTitle>
            <DialogDescription>
              Pra quando você acabou de visitar um cliente (PAP) e quer mandar a
              primeira mensagem você mesmo. A partir da resposta dele, a IA
              assume a conversa sozinha — você não precisa reativar nada.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Nome do cliente</Label>
              <Input value={ncName} onChange={(e) => setNcName(e.target.value)} placeholder="Ex.: Maria" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">WhatsApp (com DDD)</Label>
              <Input
                value={ncPhone}
                onChange={(e) => setNcPhone(e.target.value)}
                placeholder="Ex.: 11 91234-5678"
                inputMode="tel"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Mensagem de abertura</Label>
              <Textarea
                value={ncMessage}
                onChange={(e) => setNcMessage(e.target.value)}
                rows={4}
                placeholder="Oi! Aqui é o..."
              />
              <p className="text-[11px] text-muted-foreground">
                Edite o modelo padrão em Configurações → "Mensagem de abertura".
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNcOpen(false)} disabled={ncSending}>
              Cancelar
            </Button>
            <Button onClick={startConversation} disabled={ncSending}>
              {ncSending ? "Enviando..." : "Enviar e iniciar atendimento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!cancelId} onOpenChange={(o) => !o && setCancelId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar este follow-up?</AlertDialogTitle>
            <AlertDialogDescription>
              A mensagem não será enviada. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => cancelId && cancelFollowup(cancelId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Cancelar follow-up
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}