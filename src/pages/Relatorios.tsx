import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Link, useNavigate } from "react-router-dom";
import { Logo } from "@/components/Logo";
import { brandWatermarkStyle } from "@/lib/brandWatermark";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { Download, LogOut, MessageSquare, Trello, TrendingUp, Trophy, XCircle, Percent, Target, Banknote, Send, Megaphone, MapPin } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { dueDateOf } from "@/lib/installments";

type DealRow = {
  id: string;
  contact_name: string | null;
  contact_phone: string;
  deal_value: number | null;
  closed_at: string | null;
  lost_at: string | null;
  commission_eligible: boolean;
  client_type: string | null;
  installment_plan: number | null;
  due_day: number | null;
  lead_source_id: string | null;
};

type InstallmentRow = { conversation_id: string; installment_no: number; paid_at: string | null };
type LeadSource = { id: string; name: string };

type CommissionLevel = { nome: string; quantPlanos: number; valores: number[] };
type CommissionTable = { valorAdesao: number; faixas: string[]; niveis: CommissionLevel[] };
// Faixas de adimplência da 4ª parcela são fixas (3 faixas, valores editáveis em Equipe).
const BRACKET_MIN = [70, 80.1, 90.1];

const MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

// Comissão de um mês específico: mesma fórmula do card "Comissão do mês"
// (mínimo de vendas do nível → adimplência da 4ª parcela → faixa → valor),
// só que parametrizada por ano/mês pra poder ser reaproveitada em qualquer
// mês histórico (tabela de safras, gráficos mês a mês e ano a ano).
type MonthCommission = {
  count: number;
  eligibleCount: number;
  adimplencia: number | null;
  valorUnitario: number;
  total: number;
  minimoVendas: number | null;
  atingiuMinimo: boolean;
  faixaLabel: string | null;
};
function monthlyCommission(
  deals: DealRow[],
  year: number,
  month: number,
  commissionTable: CommissionTable | null,
  sellerLevel: string,
): MonthCommission {
  const inMonth = deals.filter((r) => {
    if (!r.closed_at) return false;
    const d = new Date(r.closed_at);
    return d.getFullYear() === year && d.getMonth() === month;
  });
  const nivel = commissionTable?.niveis.find((n) => n.nome === sellerLevel) || null;
  const minimoVendas = nivel?.quantPlanos ?? null;
  const atingiuMinimo = minimoVendas == null || inMonth.length >= minimoVendas;
  const eligible = inMonth.filter((r) => r.commission_eligible);
  const adimplencia = inMonth.length > 0 ? (eligible.length / inMonth.length) * 100 : null;
  let bracketIdx = -1;
  if (adimplencia != null) {
    for (let i = BRACKET_MIN.length - 1; i >= 0; i--) {
      if (adimplencia >= BRACKET_MIN[i]) {
        bracketIdx = i;
        break;
      }
    }
  }
  const valorUnitario = nivel && bracketIdx >= 0 && atingiuMinimo ? nivel.valores[bracketIdx] : 0;
  const total = atingiuMinimo ? eligible.length * valorUnitario : 0;
  const faixaLabel = atingiuMinimo && bracketIdx >= 0 ? commissionTable?.faixas[bracketIdx] ?? null : null;
  return {
    count: inMonth.length,
    eligibleCount: eligible.length,
    adimplencia,
    valorUnitario,
    total,
    minimoVendas,
    atingiuMinimo,
    faixaLabel,
  };
}

const formatBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const formatBRLFull = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function ChartTooltip({ active, payload, label, formatter }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-popover text-popover-foreground shadow-sm px-3 py-2 text-xs">
      <div className="font-medium mb-1">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-medium">{formatter ? formatter(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function Relatorios() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<DealRow[]>([]);
  const [installments, setInstallments] = useState<InstallmentRow[]>([]);
  const [leadSources, setLeadSources] = useState<LeadSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [exporting, setExporting] = useState(false);
  const [sellerLevel, setSellerLevel] = useState("Iniciante");
  const [monthlyGoal, setMonthlyGoal] = useState(15);
  const [commissionTable, setCommissionTable] = useState<CommissionTable | null>(null);
  // Comissão REAL recebida por mês (preenchida à mão), chave "ano-mês" (mês 0-11).
  const [commissionActuals, setCommissionActuals] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("conversations")
        .select(
          "id, contact_name, contact_phone, deal_value, closed_at, lost_at, commission_eligible, client_type, installment_plan, due_day, lead_source_id",
        )
        .or("closed_at.not.is.null,lost_at.not.is.null");
      if (error) {
        toast({ variant: "destructive", title: "Erro ao carregar relatórios", description: error.message });
      } else {
        setRows((data as DealRow[]) || []);
      }
      const { data: instData, error: instError } = await supabase
        .from("sale_installments")
        .select("conversation_id, installment_no, paid_at");
      if (!instError) setInstallments((instData as InstallmentRow[]) || []);
      const { data: sourceData, error: sourceError } = await supabase
        .from("lead_sources")
        .select("id, name")
        .order("name", { ascending: true });
      if (!sourceError) setLeadSources((sourceData as LeadSource[]) || []);
      const { data: actualsData, error: actualsError } = await supabase
        .from("commission_actuals")
        .select("year, month, valor_real");
      if (!actualsError) {
        const map: Record<string, number> = {};
        (actualsData || []).forEach((r: any) => {
          map[`${r.year}-${r.month}`] = Number(r.valor_real);
        });
        setCommissionActuals(map);
      }
      setLoading(false);
    };
    load();
    const ch = supabase
      .channel("relatorios-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations", filter: `user_id=eq.${user.id}` },
        load,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sale_installments", filter: `user_id=eq.${user.id}` },
        load,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "commission_actuals", filter: `user_id=eq.${user.id}` },
        load,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "lead_sources", filter: `user_id=eq.${user.id}` },
        load,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user]);

  // Comissão REAL recebida num mês — preenchida à mão na tabela de safras, só
  // pra comparação pessoal do vendedor (não alimenta nenhum outro cálculo).
  const commitCommissionActual = async (year: number, month: number, raw: string) => {
    if (!user) return;
    const trimmed = raw.trim().replace(",", ".");
    if (trimmed === "") {
      await supabase.from("commission_actuals").delete().eq("user_id", user.id).eq("year", year).eq("month", month);
      return;
    }
    const value = Number(trimmed);
    if (Number.isNaN(value)) return;
    await supabase
      .from("commission_actuals")
      .upsert({ user_id: user.id, year, month, valor_real: value }, { onConflict: "user_id,year,month" });
  };

  // Nível do vendedor (definido pelo admin em Equipe) + meta/comissão (globais)
  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("seller_level")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => data?.seller_level && setSellerLevel(data.seller_level));
    supabase.rpc("get_team_settings").then(({ data }) => {
      for (const row of data || []) {
        if (row.key === "monthly_goal_plans" && row.value) setMonthlyGoal(Number(row.value) || 15);
        if (row.key === "commission_table" && row.value) {
          try {
            setCommissionTable(JSON.parse(row.value));
          } catch {
            // ignora JSON inválido
          }
        }
      }
    });
  }, [user]);

  const availableYears = useMemo(() => {
    const years = new Set<number>();
    rows.forEach((r) => {
      if (r.closed_at) years.add(new Date(r.closed_at).getFullYear());
      if (r.lost_at) years.add(new Date(r.lost_at).getFullYear());
    });
    years.add(new Date().getFullYear());
    return Array.from(years).sort((a, b) => b - a);
  }, [rows]);

  const won = useMemo(() => rows.filter((r) => r.closed_at), [rows]);
  const lost = useMemo(() => rows.filter((r) => r.lost_at), [rows]);

  // Comissão mês a mês do ano selecionado — o que o vendedor realmente ganha,
  // não o faturamento bruto da empresa (que não é dele). "comissao" é a
  // planejada (calculada); "real" vem do mesmo campo que o vendedor preenche
  // à mão na tabela de safras (commission_actuals) — mesma fonte, pra nunca
  // divergir entre os dois lugares.
  const commissionMonthly = useMemo(() => {
    return MONTH_LABELS.map((label, i) => ({
      month: label,
      comissao: monthlyCommission(won, year, i, commissionTable, sellerLevel).total,
      real: commissionActuals[`${year}-${i}`] ?? null,
    }));
  }, [won, year, commissionTable, sellerLevel, commissionActuals]);

  // Total de comissão planejada do ano — usado no KPI do topo (que antes
  // mostrava faturamento bruto) e no resumo do Excel, pra nunca divergir.
  const totalComissaoAno = useMemo(
    () => commissionMonthly.reduce((s, m) => s + m.comissao, 0),
    [commissionMonthly],
  );

  // Comparativo de comissão ano x ano-1, mês a mês (mesma estrutura do antigo
  // comparativo de faturamento, agora com o valor de comissão).
  const commissionYoY = useMemo(() => {
    return MONTH_LABELS.map((label, i) => ({
      month: label,
      [String(year)]: monthlyCommission(won, year, i, commissionTable, sellerLevel).total,
      [String(year - 1)]: monthlyCommission(won, year - 1, i, commissionTable, sellerLevel).total,
    }));
  }, [won, year, commissionTable, sellerLevel]);

  // Ganhas x perdidas por mês (contagem) no ano selecionado
  const wonLostByMonth = useMemo(() => {
    const wonCount = Array(12).fill(0);
    const lostCount = Array(12).fill(0);
    won.forEach((r) => {
      const d = new Date(r.closed_at as string);
      if (d.getFullYear() === year) wonCount[d.getMonth()]++;
    });
    lost.forEach((r) => {
      const d = new Date(r.lost_at as string);
      if (d.getFullYear() === year) lostCount[d.getMonth()]++;
    });
    return MONTH_LABELS.map((label, i) => ({ month: label, Ganhas: wonCount[i], Perdidas: lostCount[i] }));
  }, [won, lost, year]);

  const kpis = useMemo(() => {
    const wonThisYear = won.filter((r) => new Date(r.closed_at as string).getFullYear() === year);
    const lostThisYear = lost.filter((r) => new Date(r.lost_at as string).getFullYear() === year);
    const totalRevenue = wonThisYear.reduce((sum, r) => sum + (r.deal_value ?? 0), 0);
    const wonCount = wonThisYear.length;
    const lostCount = lostThisYear.length;
    const conversion = wonCount + lostCount > 0 ? (wonCount / (wonCount + lostCount)) * 100 : null;
    const avgTicket = wonCount > 0 ? totalRevenue / wonCount : null;
    return { totalRevenue, wonCount, lostCount, conversion, avgTicket };
  }, [won, lost, year]);

  // Vendas por origem do lead — agrupa todas as vendas fechadas (ganhas ou
  // perdidas) do ano selecionado pela origem cadastrada em Conversas, pra
  // ajudar a decidir onde investir o esforço de prospecção. Sem origem
  // atribuída entra no grupo "Sem origem" (não some da conta).
  const bySource = useMemo(() => {
    const wonThisYear = won.filter((r) => new Date(r.closed_at as string).getFullYear() === year);
    const lostThisYear = lost.filter((r) => new Date(r.lost_at as string).getFullYear() === year);
    const nameOf = (id: string | null) => (id ? leadSources.find((s) => s.id === id)?.name || "Origem removida" : "Sem origem");
    const map = new Map<string, { label: string; won: number; lost: number }>();
    const bump = (id: string | null, key: "won" | "lost") => {
      const label = nameOf(id);
      const entry = map.get(label) || { label, won: 0, lost: 0 };
      entry[key]++;
      map.set(label, entry);
    };
    wonThisYear.forEach((r) => bump(r.lead_source_id, "won"));
    lostThisYear.forEach((r) => bump(r.lead_source_id, "lost"));
    return Array.from(map.values())
      .map((e) => ({ ...e, total: e.won + e.lost, conversion: e.won + e.lost > 0 ? (e.won / (e.won + e.lost)) * 100 : null }))
      .sort((a, b) => b.total - a.total);
  }, [won, lost, year, leadSources]);

  // Meta do mês: sempre o mês/ano ATUAIS (independe do filtro de ano acima) —
  // é o "estamos batendo a meta agora" do dia a dia, não um corte histórico.
  const monthGoalProgress = useMemo(() => {
    const now = new Date();
    const wonThisMonth = won.filter((r) => {
      const d = new Date(r.closed_at as string);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    });
    return { count: wonThisMonth.length, goal: monthlyGoal };
  }, [won, monthlyGoal]);

  // Comissão do mês: 1º precisa bater o mínimo de vendas do nível (senão zera,
  // não importa a adimplência); batendo, planos com TODAS as parcelas pagas ÷
  // vendas ganhas no mês = adimplência da 4ª parcela; comissão = planos
  // comissionáveis x valor da faixa atingida, para o nível do vendedor.
  const commission = useMemo(() => {
    const now = new Date();
    const r = monthlyCommission(won, now.getFullYear(), now.getMonth(), commissionTable, sellerLevel);
    return {
      wonThisMonthCount: r.count,
      eligibleCount: r.eligibleCount,
      adimplencia: r.adimplencia,
      faixaLabel: r.faixaLabel,
      valorUnitario: r.valorUnitario,
      total: r.total,
      minimoVendas: r.minimoVendas,
      atingiuMinimo: r.atingiuMinimo,
    };
  }, [won, commissionTable, sellerLevel]);

  // Ritmo do mês: vendas acumuladas dia a dia no mês corrente x meta (linha reta).
  const monthPace = useMemo(() => {
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const today = now.getDate();
    const byDay = Array(daysInMonth).fill(0);
    won.forEach((r) => {
      const d = new Date(r.closed_at as string);
      if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) {
        byDay[d.getDate() - 1]++;
      }
    });
    let cum = 0;
    return Array.from({ length: daysInMonth }, (_, i) => {
      cum += byDay[i];
      const day = i + 1;
      return { day: String(day), Vendas: day <= today ? cum : null };
    });
  }, [won]);

  // Adimplência por parcela: agrupa as vendas com parcelamento por mês da venda
  // (cohort) e mostra, por parcela (1ª..4ª), quantas dessa turma já pagaram.
  const installmentByConv = useMemo(() => {
    const map = new Map<string, InstallmentRow[]>();
    installments.forEach((i) => {
      const arr = map.get(i.conversation_id) || [];
      arr.push(i);
      map.set(i.conversation_id, arr);
    });
    return map;
  }, [installments]);

  // Janela móvel de 12 meses terminando no mês corrente — não trava em
  // "Jan-Dez do ano selecionado": ao virar o mês (ou o ano), a janela anda
  // sozinha, o mês mais antigo sai e o novo entra, sem precisar trocar filtro.
  const rollingMonths = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }, []);

  // Cada linha é um mês (safra) dos últimos 12, em ordem cronológica — igual
  // ao relatório de referência (AdPlans), mas com janela móvel em vez de
  // calendário fixo. "0 Par" = quantas vendas daquela safra ainda não pagaram
  // nenhuma parcela; cada coluna Nª é cumulativa: quantas já pagaram PELO
  // MENOS N parcelas (não a parcela exata N) — dividido pelas vendas daquela
  // safra cujo plano tem N ou mais parcelas (reativação de 2 parcelas não
  // entra no denominador da 3ª/4ª). "Planejada" é a comissão estimada daquele
  // mês (mesma fórmula do card "Comissão do mês"); "Real" é o valor que o
  // vendedor preenche à mão pra comparar com o planejado.
  const cohortTable = useMemo(() => {
    const withPlan = won.filter((r) => r.installment_plan != null && r.closed_at);
    type Cohort = { total: number; zeroPaid: number; paid: number[]; applicable: number[] };
    const blank = (): Cohort => ({ total: 0, zeroPaid: 0, paid: [0, 0, 0, 0], applicable: [0, 0, 0, 0] });
    const byKey = new Map<string, Cohort>();
    rollingMonths.forEach(({ year: y, month: m }) => byKey.set(`${y}-${m}`, blank()));
    withPlan.forEach((r) => {
      const d = new Date(r.closed_at as string);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const c = byKey.get(key);
      if (!c) return; // fora da janela dos últimos 12 meses
      c.total++;
      const plan = r.installment_plan as number;
      const convInstallments = installmentByConv.get(r.id) || [];
      const paidCount = convInstallments.filter((i) => i.paid_at).length;
      if (paidCount === 0) c.zeroPaid++;
      for (let n = 1; n <= 4; n++) {
        if (n > plan) continue;
        c.applicable[n - 1]++;
        if (paidCount >= n) c.paid[n - 1]++;
      }
    });
    const rowsOut = rollingMonths.map(({ year: y, month: m }) => {
      const c = byKey.get(`${y}-${m}`)!;
      const planejada = monthlyCommission(won, y, m, commissionTable, sellerLevel).total;
      const real = commissionActuals[`${y}-${m}`] ?? null;
      return { label: `${MONTH_LABELS[m]}/${y}`, year: y, month: m, planejada, real, ...c };
    });
    const total = rowsOut.reduce(
      (acc, m) => {
        acc.total += m.total;
        acc.zeroPaid += m.zeroPaid;
        acc.planejada += m.planejada;
        if (m.real != null) acc.real = (acc.real ?? 0) + m.real;
        for (let i = 0; i < 4; i++) {
          acc.paid[i] += m.paid[i];
          acc.applicable[i] += m.applicable[i];
        }
        return acc;
      },
      { ...blank(), planejada: 0, real: null as number | null },
    );
    return { rows: rowsOut, total, rangeLabel: `${rowsOut[0].label} – ${rowsOut[11].label}` };
  }, [won, installmentByConv, rollingMonths, commissionTable, sellerLevel, commissionActuals]);

  // Parcelas pendentes (já vencidas, dia exato via due_day) — lista de cobrança.
  // Parcela que ainda não chegou no dia de vencimento NÃO aparece aqui.
  const pendingInstallments = useMemo(() => {
    const now = new Date();
    const out: {
      id: string;
      conversationId: string;
      name: string;
      phone: string;
      installmentNo: number;
      dueLabel: string;
      dueSort: number;
      value: number | null;
    }[] = [];
    won.forEach((r) => {
      if (!r.installment_plan || !r.closed_at) return;
      const convInstallments = installmentByConv.get(r.id) || [];
      for (let n = 1; n <= r.installment_plan; n++) {
        const inst = convInstallments.find((i) => i.installment_no === n);
        if (inst?.paid_at) continue;
        const due = dueDateOf(r.closed_at, r.due_day, n);
        if (due.getTime() > now.getTime()) continue; // ainda não venceu — não é pendência
        out.push({
          id: `${r.id}-${n}`,
          conversationId: r.id,
          name: r.contact_name || r.contact_phone,
          phone: r.contact_phone,
          installmentNo: n,
          dueLabel: due.toLocaleDateString("pt-BR"),
          dueSort: due.getTime(),
          value: r.deal_value,
        });
      }
    });
    return out.sort((a, b) => a.dueSort - b.dueSort);
  }, [won, installmentByConv]);

  // Adimplência das parcelas já vencidas dentro do mês corrente (cruzando
  // todas as safras, dia exato) — "quanto estou perdendo de adimplência esse mês".
  const currentMonthDueStats = useMemo(() => {
    const now = new Date();
    let total = 0;
    let paid = 0;
    won.forEach((r) => {
      if (!r.installment_plan || !r.closed_at) return;
      const convInstallments = installmentByConv.get(r.id) || [];
      for (let n = 1; n <= r.installment_plan; n++) {
        const due = dueDateOf(r.closed_at, r.due_day, n);
        if (due.getFullYear() !== now.getFullYear() || due.getMonth() !== now.getMonth()) continue;
        if (due.getTime() > now.getTime()) continue; // ainda não venceu dentro do próprio mês
        total++;
        const inst = convInstallments.find((i) => i.installment_no === n);
        if (inst?.paid_at) paid++;
      }
    });
    return { total, paid, pct: total > 0 ? (paid / total) * 100 : null };
  }, [won, installmentByConv]);

  // Adimplência mensal (ano x ano-1), estilo "Comparativo ano a ano": de todas
  // as parcelas de todas as safras que já venceram em cada mês, quantas foram
  // pagas. Parcelas que ainda não venceram não entram (não têm veredito ainda).
  const adimplenciaYoY = useMemo(() => {
    const now = new Date();
    const curTotal = Array(12).fill(0);
    const curPaid = Array(12).fill(0);
    const prevTotal = Array(12).fill(0);
    const prevPaid = Array(12).fill(0);
    won.forEach((r) => {
      if (!r.installment_plan || !r.closed_at) return;
      const convInstallments = installmentByConv.get(r.id) || [];
      for (let n = 1; n <= r.installment_plan; n++) {
        const due = dueDateOf(r.closed_at, r.due_day, n);
        if (due.getTime() > now.getTime()) continue; // ainda não venceu
        const inst = convInstallments.find((i) => i.installment_no === n);
        const isPaid = !!inst?.paid_at;
        if (due.getFullYear() === year) {
          curTotal[due.getMonth()]++;
          if (isPaid) curPaid[due.getMonth()]++;
        } else if (due.getFullYear() === year - 1) {
          prevTotal[due.getMonth()]++;
          if (isPaid) prevPaid[due.getMonth()]++;
        }
      }
    });
    return MONTH_LABELS.map((label, i) => ({
      month: label,
      [String(year)]: curTotal[i] > 0 ? Number(((curPaid[i] / curTotal[i]) * 100).toFixed(1)) : null,
      [String(year - 1)]: prevTotal[i] > 0 ? Number(((prevPaid[i] / prevTotal[i]) * 100).toFixed(1)) : null,
    }));
  }, [won, installmentByConv, year]);

  const exportExcel = async () => {
    setExporting(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = "CPOS Vendas";
      wb.created = new Date();

      const resumo = wb.addWorksheet("Resumo");
      resumo.columns = [
        { header: "Mês", key: "month", width: 10 },
        { header: `Comissão planejada ${year} (R$)`, key: "cur", width: 22 },
        { header: `Comissão planejada ${year - 1} (R$)`, key: "prev", width: 22 },
        { header: "Vendas ganhas", key: "won", width: 14 },
        { header: "Vendas perdidas", key: "lost", width: 16 },
      ];
      MONTH_LABELS.forEach((label, i) => {
        resumo.addRow({
          month: label,
          cur: commissionYoY[i][String(year)],
          prev: commissionYoY[i][String(year - 1)],
          won: wonLostByMonth[i].Ganhas,
          lost: wonLostByMonth[i].Perdidas,
        });
      });
      resumo.addRow({});
      resumo.addRow({ month: "Total", cur: totalComissaoAno, won: kpis.wonCount, lost: kpis.lostCount });
      resumo.getRow(1).font = { bold: true };

      const vendas = wb.addWorksheet("Vendas");
      vendas.columns = [
        { header: "Cliente", key: "name", width: 28 },
        { header: "Telefone", key: "phone", width: 18 },
        { header: "Status", key: "status", width: 12 },
        { header: "Valor (R$)", key: "value", width: 14 },
        { header: "Data", key: "date", width: 14 },
        { header: "Origem", key: "source", width: 18 },
      ];
      rows.forEach((r) => {
        const isWon = !!r.closed_at;
        vendas.addRow({
          name: r.contact_name || "(sem nome)",
          phone: r.contact_phone,
          status: isWon ? "Ganha" : "Perdida",
          value: r.deal_value ?? "",
          date: new Date((r.closed_at || r.lost_at) as string).toLocaleDateString("pt-BR"),
          source: r.lead_source_id ? leadSources.find((s) => s.id === r.lead_source_id)?.name || "Origem removida" : "Sem origem",
        });
      });
      vendas.getRow(1).font = { bold: true };

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cpos-vendas-relatorio-${year}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Erro ao exportar", description: e?.message || String(e) });
    } finally {
      setExporting(false);
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
            <Link to="/relatorios" className="px-3 py-1.5 text-sm rounded-md bg-muted font-medium">
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
          <Button variant="ghost" size="icon" className="sm:hidden" onClick={() => navigate("/kanban")} title="Kanban">
            <Trello className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="sm:hidden" onClick={() => navigate("/transmissao")} title="Transmissão">
            <Megaphone className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={async () => { await signOut(); navigate("/login"); }} title="Sair">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 max-w-6xl w-full mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">Relatórios</h1>
            <p className="text-sm text-muted-foreground">Vendas fechadas e perdidas, mês a mês e ano a ano.</p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="h-9 w-[110px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableYears.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={exportExcel} disabled={exporting || loading}>
              <Download className="w-4 h-4 mr-2" />
              {exporting ? "Gerando..." : "Exportar Excel"}
            </Button>
          </div>
        </div>

        {!loading && rows.length === 0 && (
          <div className="border-2 border-dashed rounded-lg p-8 text-center text-sm text-muted-foreground">
            Nenhuma venda ganha ou perdida registrada ainda. Marque uma coluna do Kanban como "venda ganha" (troféu)
            ou "venda perdida" (X) e mova um lead pra lá — ele aparece aqui automaticamente.
          </div>
        )}

        {/* KPIs — quantidade e meta em primeiro lugar; faturamento por último
            (o vendedor precisa acompanhar quantidade, não valor). */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="glass-card rounded-lg p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Trophy className="w-3.5 h-3.5" /> Vendas ganhas
            </div>
            <div className="text-xl font-semibold">{kpis.wonCount}</div>
          </div>
          <div className="glass-card rounded-lg p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Target className="w-3.5 h-3.5" /> Meta do mês
            </div>
            <div className="text-xl font-semibold">
              {monthGoalProgress.count} <span className="text-sm text-muted-foreground font-normal">/ {monthGoalProgress.goal}</span>
            </div>
          </div>
          <div className="glass-card rounded-lg p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Percent className="w-3.5 h-3.5" /> Taxa de conversão
            </div>
            <div className="text-xl font-semibold">
              {kpis.conversion != null ? `${kpis.conversion.toFixed(0)}%` : "—"}
            </div>
          </div>
          <div className="glass-card rounded-lg p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <XCircle className="w-3.5 h-3.5" /> Vendas perdidas
            </div>
            <div className="text-xl font-semibold">{kpis.lostCount}</div>
          </div>
          <div className="glass-card rounded-lg p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Banknote className="w-3.5 h-3.5" /> Comissão {year}
            </div>
            <div className="text-xl font-semibold">{formatBRLFull(totalComissaoAno)}</div>
          </div>
        </div>

        {/* Comissão do mês — bloco principal da página, logo abaixo dos KPIs */}
        <div className="glass-card rounded-lg p-4 border-2 border-chart-good/30">
          <div className="flex items-center gap-2 text-sm font-medium mb-1">
            <Banknote className="w-4 h-4 text-chart-good" /> Comissão estimada — {MONTH_LABELS[new Date().getMonth()]}/{new Date().getFullYear()}
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Nível <strong>{sellerLevel}</strong> · mínimo de <strong>{commission.minimoVendas ?? "—"} vendas</strong> no mês pra começar a
            comissionar · batendo o mínimo, comissão = planos comissionáveis (parcelas todas pagas) × valor da faixa
            de adimplência atingida na 4ª parcela. Ajuste o nível e a tabela em Equipe.
          </p>
          {!commission.atingiuMinimo && (
            <div className="mb-3 text-xs rounded-md bg-destructive/10 text-destructive px-3 py-2">
              Abaixo do mínimo do nível: {commission.wonThisMonthCount} venda(s) de {commission.minimoVendas} necessárias —
              comissão zerada este mês, mesmo com boa adimplência.
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <div className="text-xs text-muted-foreground">Vendas no mês</div>
              <div className="text-lg font-semibold">
                {commission.wonThisMonthCount} <span className="text-xs font-normal text-muted-foreground">/ {commission.minimoVendas ?? "—"} mín.</span>
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Adimplência 4ª parcela</div>
              <div className="text-lg font-semibold">{commission.adimplencia != null ? `${commission.adimplencia.toFixed(0)}%` : "—"}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Faixa atingida</div>
              <div className="text-lg font-semibold">{commission.faixaLabel || "—"}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Comissão estimada</div>
              <div className="text-lg font-semibold text-chart-good">{formatBRLFull(commission.total)}</div>
            </div>
          </div>
        </div>

        {/* Quantidade de vendas por mês — o que importa pro vendedor, com a meta */}
        <div className="glass-card rounded-lg p-4">
          <div className="flex items-center gap-2 text-sm font-medium mb-3">
            <Trophy className="w-4 h-4 text-chart-good" /> Quantidade de vendas por mês — {year}
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={wonLostByMonth} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} axisLine={{ stroke: "hsl(var(--border))" }} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                  width={30}
                  allowDecimals={false}
                  domain={[0, (dataMax: number) => (year === new Date().getFullYear() ? Math.max(dataMax, monthlyGoal) : dataMax)]}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "hsl(var(--muted))" }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {year === new Date().getFullYear() && (
                  <ReferenceLine
                    y={monthlyGoal}
                    stroke="hsl(var(--chart-current))"
                    strokeDasharray="4 4"
                    label={{ value: `Meta: ${monthlyGoal}`, position: "insideTopRight", fontSize: 11, fill: "hsl(var(--chart-current))" }}
                  />
                )}
                <Bar dataKey="Ganhas" fill="hsl(var(--chart-good))" radius={[4, 4, 0, 0]} maxBarSize={20} />
                <Bar dataKey="Perdidas" fill="hsl(var(--chart-bad))" radius={[4, 4, 0, 0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Ritmo do mês corrente — vendas acumuladas x meta (linha reta) */}
        <div className="glass-card rounded-lg p-4">
          <div className="flex items-center gap-2 text-sm font-medium mb-3">
            <Target className="w-4 h-4 text-chart-current" /> Ritmo do mês — {MONTH_LABELS[new Date().getMonth()]}/{new Date().getFullYear()}
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthPace} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={{ stroke: "hsl(var(--border))" }} tickLine={false} interval={2} />
                <YAxis
                  tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                  width={30}
                  allowDecimals={false}
                  domain={[0, (dataMax: number) => Math.max(dataMax, monthlyGoal)]}
                />
                <Tooltip content={<ChartTooltip />} />
                <ReferenceLine
                  y={monthlyGoal}
                  stroke="hsl(var(--chart-current))"
                  strokeDasharray="4 4"
                  label={{ value: `Meta: ${monthlyGoal}`, position: "insideTopRight", fontSize: 11, fill: "hsl(var(--chart-current))" }}
                />
                <Line type="monotone" dataKey="Vendas" name="Vendas acumuladas" stroke="hsl(var(--chart-good))" strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Vendas por origem do lead — catálogo cadastrado pelo vendedor em
            Conversas (indicação, panfleto, bairro, etc.), pra ver onde vale
            mais a pena investir esforço de prospecção. */}
        <div className="glass-card rounded-lg p-4 overflow-x-auto">
          <div className="flex items-center gap-2 text-sm font-medium mb-1">
            <MapPin className="w-4 h-4 text-chart-current" /> Vendas por origem do lead — {year}
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Cadastre e atribua a origem de cada lead na tela de Conversas (botão "Origem"). "Sem origem" agrupa os leads
            sem essa atribuição ainda.
          </p>
          {bySource.length === 0 ? (
            <div className="text-sm text-muted-foreground py-2">Nenhuma venda ganha ou perdida registrada em {year} ainda.</div>
          ) : (
            <table className="w-full text-sm min-w-[480px]">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b">
                  <th className="py-1.5 pr-4 font-medium">Origem</th>
                  <th className="py-1.5 pr-4 font-medium">Vendas</th>
                  <th className="py-1.5 pr-4 font-medium">Ganhas</th>
                  <th className="py-1.5 pr-4 font-medium">Perdidas</th>
                  <th className="py-1.5 pr-2 font-medium">Conversão</th>
                </tr>
              </thead>
              <tbody>
                {bySource.map((s) => (
                  <tr key={s.label} className="border-b last:border-0">
                    <td className="py-1.5 pr-4 font-medium">{s.label}</td>
                    <td className="py-1.5 pr-4 tabular-nums">{s.total}</td>
                    <td className="py-1.5 pr-4 tabular-nums text-chart-good">{s.won}</td>
                    <td className="py-1.5 pr-4 tabular-nums text-chart-bad">{s.lost}</td>
                    <td className="py-1.5 pr-2 tabular-nums">{s.conversion != null ? `${s.conversion.toFixed(0)}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Adimplência por parcela — janela móvel dos últimos 12 meses (não
            trava no ano selecionado: ao virar o mês/ano, rotaciona sozinho). */}
        <div className="glass-card rounded-lg p-4 overflow-x-auto">
          <div className="flex items-center gap-2 text-sm font-medium mb-1">
            <Percent className="w-4 h-4 text-chart-good" /> Adimplência por parcela — últimos 12 meses
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            {cohortTable.rangeLabel}. De cada safra de vendas (mês em que fechou), quantas ainda não pagaram nada (0 Par)
            e quantas já pagaram pelo menos 1, 2, 3 ou 4 parcelas — venda de setembro → 1ª parcela vence em outubro, 2ª em
            novembro, e assim por diante. "Planejada" é a comissão estimada daquele mês (mesma fórmula do card de
            comissão); em "Real" você anota quanto realmente recebeu, pra comparar.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b">
                <th className="py-1.5 pr-4 font-medium">Mês/ano</th>
                <th className="py-1.5 pr-4 font-medium">Vendas</th>
                <th className="py-1.5 pr-4 font-medium">0 Par</th>
                <th className="py-1.5 pr-4 font-medium">% 0 Par</th>
                <th className="py-1.5 pr-4 font-medium">1ª</th>
                <th className="py-1.5 pr-4 font-medium">%1ª</th>
                <th className="py-1.5 pr-4 font-medium">2ª</th>
                <th className="py-1.5 pr-4 font-medium">%2ª</th>
                <th className="py-1.5 pr-4 font-medium">3ª</th>
                <th className="py-1.5 pr-4 font-medium">%3ª</th>
                <th className="py-1.5 pr-4 font-medium">4ª</th>
                <th className="py-1.5 pr-4 font-medium">%4ª</th>
                <th className="py-1.5 pr-4 font-medium">Planejada</th>
                <th className="py-1.5 pr-2 font-medium">Real</th>
              </tr>
            </thead>
            <tbody>
              {cohortTable.rows.map((c) => (
                <tr key={c.label} className="border-b last:border-0">
                  <td className="py-1.5 pr-4 font-medium">{c.label}</td>
                  <td className="py-1.5 pr-4 tabular-nums">{c.total || "—"}</td>
                  <td className="py-1.5 pr-4 tabular-nums">{c.total ? c.zeroPaid : "—"}</td>
                  <td className="py-1.5 pr-4 tabular-nums">{c.total ? `${Math.round((c.zeroPaid / c.total) * 100)}%` : "—"}</td>
                  {[0, 1, 2, 3].map((i) => (
                    <Fragment key={i}>
                      <td className="py-1.5 pr-4 tabular-nums">{c.applicable[i] ? c.paid[i] : "—"}</td>
                      <td className="py-1.5 pr-4 tabular-nums">
                        {c.applicable[i] ? `${Math.round((c.paid[i] / c.applicable[i]) * 100)}%` : "—"}
                      </td>
                    </Fragment>
                  ))}
                  <td className="py-1.5 pr-4 tabular-nums">{formatBRL(c.planejada)}</td>
                  <td className="py-1.5 pr-2">
                    <Input
                      key={`${c.year}-${c.month}-${c.real ?? ""}`}
                      type="number"
                      step="0.01"
                      min={0}
                      defaultValue={c.real ?? ""}
                      onBlur={(e) => commitCommissionActual(c.year, c.month, e.target.value)}
                      placeholder="R$ —"
                      className="h-7 w-24 text-xs px-2"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 font-semibold">
                <td className="py-1.5 pr-4">Total</td>
                <td className="py-1.5 pr-4 tabular-nums">{cohortTable.total.total || "—"}</td>
                <td className="py-1.5 pr-4 tabular-nums">{cohortTable.total.total ? cohortTable.total.zeroPaid : "—"}</td>
                <td className="py-1.5 pr-4 tabular-nums">
                  {cohortTable.total.total ? `${Math.round((cohortTable.total.zeroPaid / cohortTable.total.total) * 100)}%` : "—"}
                </td>
                {[0, 1, 2, 3].map((i) => (
                  <Fragment key={i}>
                    <td className="py-1.5 pr-4 tabular-nums">
                      {cohortTable.total.applicable[i] ? cohortTable.total.paid[i] : "—"}
                    </td>
                    <td className="py-1.5 pr-4 tabular-nums">
                      {cohortTable.total.applicable[i]
                        ? `${Math.round((cohortTable.total.paid[i] / cohortTable.total.applicable[i]) * 100)}%`
                        : "—"}
                    </td>
                  </Fragment>
                ))}
                <td className="py-1.5 pr-4 tabular-nums">{formatBRL(cohortTable.total.planejada)}</td>
                <td className="py-1.5 pr-2 tabular-nums">
                  {cohortTable.total.real != null ? formatBRL(cohortTable.total.real) : "—"}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Adimplência mensal — mesmo estilo do "Comparativo ano a ano", só que
            acompanhando % de parcelas pagas em dia em vez de faturamento. */}
        <div className="glass-card rounded-lg p-4">
          <div className="flex items-center gap-2 text-sm font-medium mb-3">
            <TrendingUp className="w-4 h-4 text-chart-good" /> Adimplência mensal — {year} x {year - 1}
          </div>
          <p className="text-xs text-muted-foreground mb-3 -mt-2">
            % de parcelas já vencidas (de todas as safras) que foram pagas, mês a mês. Parcelas que ainda não venceram não
            entram na conta.
          </p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={adimplenciaYoY} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} axisLine={{ stroke: "hsl(var(--border))" }} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                  width={36}
                  domain={[0, 100]}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip content={<ChartTooltip formatter={(v: number) => `${v}%`} />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey={String(year)} name={String(year)} stroke="hsl(var(--chart-good))" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                <Line type="monotone" dataKey={String(year - 1)} name={String(year - 1)} stroke="hsl(var(--chart-previous))" strokeWidth={2} dot={{ r: 3 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Parcelas pendentes — lista de cobrança */}
        <div className="glass-card rounded-lg p-4">
          <div className="flex items-center gap-2 text-sm font-medium mb-1">
            <XCircle className="w-4 h-4 text-chart-bad" /> Parcelas pendentes (cobrança)
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Parcelas vencendo em {MONTH_LABELS[new Date().getMonth()]}/{new Date().getFullYear()}:{" "}
            {currentMonthDueStats.total > 0 ? (
              <>
                <strong>{currentMonthDueStats.paid}/{currentMonthDueStats.total} pagas ({currentMonthDueStats.pct?.toFixed(0)}%)</strong> —
                está perdendo {(100 - (currentMonthDueStats.pct ?? 100)).toFixed(0)}% de adimplência esse mês.
              </>
            ) : (
              "nenhuma parcela vencendo esse mês."
            )}
          </p>
          {pendingInstallments.length === 0 ? (
            <div className="text-sm text-muted-foreground py-2">Nenhuma parcela pendente ou vencida no momento. 🎉</div>
          ) : (
            <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b">
                    <th className="py-1.5 pr-4 font-medium">Cliente</th>
                    <th className="py-1.5 pr-4 font-medium">Parcela</th>
                    <th className="py-1.5 pr-4 font-medium">Vencimento</th>
                    <th className="py-1.5 pr-4 font-medium">Valor do plano</th>
                    <th className="py-1.5 pr-4 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {pendingInstallments.map((p) => {
                    const draft = `Oi, ${p.name}! Passando para lembrar do pagamento da ${p.installmentNo}ª parcela do seu plano, com vencimento em ${p.dueLabel}. Consegue me confirmar o pagamento? Se preferir, posso mandar um boleto novo atualizado — só me dizer qual o melhor dia.`;
                    return (
                      <tr key={p.id} className="border-b last:border-0">
                        <td className="py-1.5 pr-4">
                          <div className="font-medium">{p.name}</div>
                          <div className="text-xs text-muted-foreground">{p.phone}</div>
                        </td>
                        <td className="py-1.5 pr-4 tabular-nums">{p.installmentNo}ª</td>
                        <td className="py-1.5 pr-4">{p.dueLabel}</td>
                        <td className="py-1.5 pr-4 tabular-nums">{p.value != null ? formatBRL(p.value) : "—"}</td>
                        <td className="py-1.5 pr-0 text-right">
                          <Link to={`/?open=${p.conversationId}&draft=${encodeURIComponent(draft)}`}>
                            <Button size="sm" variant="outline" className="h-7 text-xs">
                              <Send className="w-3 h-3 mr-1" /> Cobrar
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Comparativo de comissão ano a ano (antes era faturamento bruto — o
            vendedor pediu pra ser o que ele realmente ganha, não o valor da venda) */}
        <div className="glass-card rounded-lg p-4">
          <div className="flex items-center gap-2 text-sm font-medium mb-3">
            <TrendingUp className="w-4 h-4 text-chart-current" /> Comissão — comparativo {year} x {year - 1}
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={commissionYoY} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} axisLine={{ stroke: "hsl(var(--border))" }} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={44} tickFormatter={(v) => formatBRL(v)} />
                <Tooltip content={<ChartTooltip formatter={formatBRLFull} />} cursor={{ stroke: "hsl(var(--border))" }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey={String(year)} name={String(year)} stroke="hsl(var(--chart-current))" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey={String(year - 1)} name={String(year - 1)} stroke="hsl(var(--chart-previous))" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Comissão mês a mês — antes era faturamento bruto da empresa; agora é
            o que entra no bolso do vendedor. Planejada (calculada) x Real (o
            que o vendedor preenche à mão) lado a lado, pra comparar de cara —
            mesmos dados da coluna "Real" na tabela de safras acima. */}
        <div className="glass-card rounded-lg p-4">
          <div className="flex items-center gap-2 text-sm font-medium mb-3">
            <Banknote className="w-4 h-4 text-chart-good" /> Comissão mês a mês — {year} · Planejada x Real
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={commissionMonthly} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} axisLine={{ stroke: "hsl(var(--border))" }} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={44} tickFormatter={(v) => formatBRL(v)} />
                <Tooltip content={<ChartTooltip formatter={formatBRLFull} />} cursor={{ fill: "hsl(var(--muted))" }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="comissao" name="Planejada" fill="hsl(var(--chart-good))" radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Bar dataKey="real" name="Real" fill="hsl(var(--chart-current))" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            "Real" só aparece nos meses em que você preencheu o valor recebido na tabela de safras acima.
          </div>
        </div>

        {/* Tabela (acessibilidade: alternativa em texto aos gráficos) */}
        <div className="glass-card rounded-lg p-4 overflow-x-auto">
          <div className="text-sm font-medium mb-3">Tabela — {year}</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b">
                <th className="py-1.5 pr-4 font-medium">Mês</th>
                <th className="py-1.5 pr-4 font-medium">Ganhas</th>
                <th className="py-1.5 pr-4 font-medium">Perdidas</th>
                <th className="py-1.5 pr-4 font-medium">Comissão planejada</th>
                <th className="py-1.5 pr-4 font-medium">Comissão real</th>
              </tr>
            </thead>
            <tbody>
              {commissionMonthly.map((m, i) => (
                <tr key={m.month} className="border-b last:border-0">
                  <td className="py-1.5 pr-4">{m.month}</td>
                  <td className="py-1.5 pr-4 tabular-nums">{wonLostByMonth[i].Ganhas}</td>
                  <td className="py-1.5 pr-4 tabular-nums">{wonLostByMonth[i].Perdidas}</td>
                  <td className="py-1.5 pr-4 tabular-nums">{formatBRLFull(m.comissao)}</td>
                  <td className="py-1.5 pr-4 tabular-nums">{m.real != null ? formatBRLFull(m.real) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
