import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { ArrowLeft, Users, UserPlus, KeyRound, Copy, Target, Percent } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { brandWatermarkStyle } from "@/lib/brandWatermark";

const SELLER_LEVELS = ["Iniciante", "Junior", "Master", "Senior", "Sênior Plus"];

type Profile = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  seller_level: string;
};

type CommissionLevel = { nome: string; quantPlanos: number; valores: number[] };
type CommissionTable = { valorAdesao: number; faixas: string[]; niveis: CommissionLevel[] };

export default function Equipe() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLevel, setInviteLevel] = useState("Iniciante");
  const [inviting, setInviting] = useState(false);

  const [revealPassword, setRevealPassword] = useState<{ email: string; password: string } | null>(null);

  const [monthlyGoal, setMonthlyGoal] = useState("15");
  const [savingGoal, setSavingGoal] = useState(false);

  const [commission, setCommission] = useState<CommissionTable | null>(null);
  const [savingCommission, setSavingCommission] = useState(false);

  const loadProfiles = async () => {
    const { data } = await supabase
      .from("profiles")
      .select("user_id, email, full_name, seller_level")
      .order("created_at", { ascending: true });
    setProfiles((data as Profile[]) || []);
    setLoading(false);
  };

  const loadSettings = async () => {
    const { data } = await supabase
      .from("app_settings")
      .select("key,value")
      .in("key", ["monthly_goal_plans", "commission_table"]);
    for (const row of data || []) {
      if (row.key === "monthly_goal_plans" && row.value) setMonthlyGoal(row.value);
      if (row.key === "commission_table" && row.value) {
        try {
          setCommission(JSON.parse(row.value));
        } catch {
          // ignora JSON inválido — mantém o form vazio
        }
      }
    }
  };

  useEffect(() => {
    loadProfiles();
    loadSettings();
  }, []);

  const changeLevel = async (userId: string, level: string) => {
    setProfiles((prev) => prev.map((p) => (p.user_id === userId ? { ...p, seller_level: level } : p)));
    const { error } = await supabase.from("profiles").update({ seller_level: level }).eq("user_id", userId);
    if (error) {
      toast({ variant: "destructive", title: "Erro ao salvar nível", description: error.message });
      loadProfiles();
    }
  };

  const invite = async () => {
    if (!inviteName.trim() || !inviteEmail.trim()) return;
    setInviting(true);
    const { data, error } = await supabase.functions.invoke("admin-manage-team", {
      body: { action: "invite", email: inviteEmail.trim(), full_name: inviteName.trim(), seller_level: inviteLevel },
    });
    setInviting(false);
    if (error || !data?.ok) {
      toast({ variant: "destructive", title: "Erro ao criar login", description: data?.error || error?.message });
      return;
    }
    setInviteOpen(false);
    setInviteName("");
    setInviteEmail("");
    setInviteLevel("Iniciante");
    setRevealPassword({ email: data.email, password: data.temp_password });
    loadProfiles();
  };

  const resetPassword = async (userId: string, email: string) => {
    const { data, error } = await supabase.functions.invoke("admin-manage-team", {
      body: { action: "reset_password", user_id: userId },
    });
    if (error || !data?.ok) {
      toast({ variant: "destructive", title: "Erro ao redefinir senha", description: data?.error || error?.message });
      return;
    }
    setRevealPassword({ email, password: data.temp_password });
  };

  const saveGoal = async () => {
    setSavingGoal(true);
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: "monthly_goal_plans", value: monthlyGoal.trim() || "15" }, { onConflict: "key" });
    setSavingGoal(false);
    if (error) toast({ variant: "destructive", title: "Erro ao salvar meta", description: error.message });
    else toast({ title: "Meta salva" });
  };

  const updateLevelField = (idx: number, field: "quantPlanos" | "valores", faixaIdx: number | null, value: string) => {
    if (!commission) return;
    const niveis = [...commission.niveis];
    const lvl = { ...niveis[idx] };
    if (field === "quantPlanos") {
      lvl.quantPlanos = Number(value) || 0;
    } else if (faixaIdx != null) {
      const valores = [...lvl.valores];
      valores[faixaIdx] = Number(value) || 0;
      lvl.valores = valores;
    }
    niveis[idx] = lvl;
    setCommission({ ...commission, niveis });
  };

  const saveCommission = async () => {
    if (!commission) return;
    setSavingCommission(true);
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: "commission_table", value: JSON.stringify(commission) }, { onConflict: "key" });
    setSavingCommission(false);
    if (error) toast({ variant: "destructive", title: "Erro ao salvar tabela", description: error.message });
    else toast({ title: "Tabela de comissão salva" });
  };

  return (
    <div className="min-h-screen bg-background p-6 lg:p-8" style={brandWatermarkStyle}>
      <div className="max-w-3xl mx-auto space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Voltar
        </Button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="w-6 h-6 text-primary" /> Equipe
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cada vendedor tem seu próprio login, com seu Kanban e suas conversas isolados dos demais.
          </p>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Vendedores</CardTitle>
            <Button size="sm" onClick={() => setInviteOpen(true)}>
              <UserPlus className="w-4 h-4 mr-1.5" /> Novo login
            </Button>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>E-mail</TableHead>
                    <TableHead>Nível</TableHead>
                    <TableHead className="text-right">Senha</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profiles.map((p) => (
                    <TableRow key={p.user_id}>
                      <TableCell className="font-medium">{p.full_name || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{p.email}</TableCell>
                      <TableCell>
                        <Select value={p.seller_level} onValueChange={(v) => changeLevel(p.user_id, v)}>
                          <SelectTrigger className="h-8 w-[140px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {SELLER_LEVELS.map((l) => (
                              <SelectItem key={l} value={l}>{l}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => resetPassword(p.user_id, p.email || "")}
                          title="Gerar nova senha temporária"
                        >
                          <KeyRound className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" /> Meta mensal
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-end gap-2">
            <div className="space-y-1.5">
              <Label>Planos vendidos por mês</Label>
              <Input
                className="w-32"
                inputMode="numeric"
                value={monthlyGoal}
                onChange={(e) => setMonthlyGoal(e.target.value)}
              />
            </div>
            <Button onClick={saveGoal} disabled={savingGoal}>
              {savingGoal ? "Salvando..." : "Salvar"}
            </Button>
          </CardContent>
        </Card>

        {commission && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Percent className="w-4 h-4 text-primary" /> Tabela de comissão
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                "Quant. planos" é o <strong>mínimo de vendas ganhas no mês</strong> para o vendedor desse nível
                começar a receber comissão (abaixo disso, comissão zerada mesmo com 100% de adimplência).
                Batendo o mínimo, a comissão do mês = quantidade de planos comissionáveis (parcelas todas pagas)
                × valor da faixa de adimplência atingida na 4ª parcela.
              </p>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nível</TableHead>
                      <TableHead>Quant. planos</TableHead>
                      {commission.faixas.map((f) => (
                        <TableHead key={f}>{f}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {commission.niveis.map((lvl, idx) => (
                      <TableRow key={lvl.nome}>
                        <TableCell className="font-medium whitespace-nowrap">{lvl.nome}</TableCell>
                        <TableCell>
                          <Input
                            className="h-8 w-16 text-xs"
                            inputMode="numeric"
                            value={lvl.quantPlanos}
                            onChange={(e) => updateLevelField(idx, "quantPlanos", null, e.target.value)}
                          />
                        </TableCell>
                        {lvl.valores.map((v, fIdx) => (
                          <TableCell key={fIdx}>
                            <Input
                              className="h-8 w-20 text-xs"
                              inputMode="numeric"
                              value={v}
                              onChange={(e) => updateLevelField(idx, "valores", fIdx, e.target.value)}
                            />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Button className="mt-4" onClick={saveCommission} disabled={savingCommission}>
                {savingCommission ? "Salvando..." : "Salvar tabela"}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Convidar novo vendedor */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo login de vendedor</DialogTitle>
            <DialogDescription>
              Cria uma conta isolada — o vendedor só vê o próprio Kanban e as próprias conversas.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={inviteName} onChange={(e) => setInviteName(e.target.value)} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label>E-mail</Label>
              <Input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Nível inicial</Label>
              <Select value={inviteLevel} onValueChange={setInviteLevel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SELLER_LEVELS.map((l) => (
                    <SelectItem key={l} value={l}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={invite} disabled={inviting || !inviteName.trim() || !inviteEmail.trim()}>
              {inviting ? "Criando..." : "Criar login"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revela a senha temporária uma única vez */}
      <Dialog open={!!revealPassword} onOpenChange={(open) => !open && setRevealPassword(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Senha temporária</DialogTitle>
            <DialogDescription>
              Repasse esses dados ao vendedor por um canal seguro. Esta senha só aparece agora — se perder,
              gere outra pelo botão da chave na lista.
            </DialogDescription>
          </DialogHeader>
          {revealPassword && (
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between rounded-md border p-2">
                <span className="text-muted-foreground">E-mail</span>
                <span className="font-medium">{revealPassword.email}</span>
              </div>
              <div className="flex items-center justify-between rounded-md border p-2">
                <span className="text-muted-foreground">Senha</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-medium">{revealPassword.password}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => {
                      navigator.clipboard.writeText(revealPassword.password);
                      toast({ title: "Senha copiada" });
                    }}
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setRevealPassword(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
