import { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  INSTALLMENT_MODELS,
  SaleInstallment,
  applyInstallmentModel,
  modelKey,
  setDueDay,
  toggleInstallmentPaid,
} from "@/lib/installments";

interface Props {
  conversationId: string;
  userId: string;
  clientType: string | null;
  installmentPlan: number | null;
  dueDay: number | null;
  installments: SaleInstallment[];
  onChanged: () => void;
  /** Kanban card = mais compacto; cabeçalho da conversa = com rótulos. */
  compact?: boolean;
}

export function InstallmentChecklist({
  conversationId,
  userId,
  clientType,
  installmentPlan,
  dueDay,
  installments,
  onChanged,
  compact,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [dueDayInput, setDueDayInput] = useState(dueDay != null ? String(dueDay) : "");
  useEffect(() => {
    setDueDayInput(dueDay != null ? String(dueDay) : "");
  }, [dueDay]);
  const currentKey = modelKey(clientType, installmentPlan);
  const allPaid = installmentPlan != null && installments.filter((i) => i.paid_at).length >= installmentPlan;

  const onModelChange = async (key: string) => {
    const model = INSTALLMENT_MODELS.find((m) => m.key === key);
    if (!model || busy) return;
    setBusy(true);
    await applyInstallmentModel(conversationId, userId, model.clientType, model.plan);
    setBusy(false);
    onChanged();
  };

  const onToggle = async (id: string, paid: boolean) => {
    if (busy) return;
    setBusy(true);
    await toggleInstallmentPaid(id, !paid);
    setBusy(false);
    onChanged();
  };

  const commitDueDay = async () => {
    const raw = dueDayInput.trim();
    const value = raw === "" ? null : Math.max(1, Math.min(31, Number(raw) || 1));
    if (value === dueDay) return;
    await setDueDay(conversationId, value);
    onChanged();
  };

  return (
    <div className={compact ? "flex items-center gap-1.5 flex-wrap" : "flex items-center gap-2 flex-wrap"} onClick={(e) => e.stopPropagation()}>
      <Select value={currentKey} onValueChange={onModelChange} disabled={busy}>
        <SelectTrigger className={compact ? "h-6 text-[11px] px-1.5 w-auto gap-1" : "h-8 text-xs w-[180px]"}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {INSTALLMENT_MODELS.map((m) => (
            <SelectItem key={m.key} value={m.key} className="text-xs">
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <label
        title="Dia do mês em que o cliente paga (ex.: 30 = todo dia 30)"
        className={compact ? "flex items-center gap-0.5 text-[10px] text-muted-foreground" : "flex items-center gap-1 text-xs text-muted-foreground"}
      >
        Vence dia
        <Input
          type="number"
          min={1}
          max={31}
          value={dueDayInput}
          onChange={(e) => setDueDayInput(e.target.value)}
          onBlur={commitDueDay}
          placeholder="—"
          className={compact ? "h-6 w-11 text-[11px] px-1" : "h-8 w-14 text-xs px-2"}
        />
      </label>
      <div className="flex items-center gap-1">
        {installments.map((inst) => (
          <label
            key={inst.id}
            title={`${inst.installment_no}ª parcela${inst.paid_at ? " — paga" : " — em aberto"}`}
            className="flex items-center gap-0.5 cursor-pointer select-none"
          >
            <Checkbox
              checked={!!inst.paid_at}
              onCheckedChange={() => onToggle(inst.id, !!inst.paid_at)}
              disabled={busy}
              className="h-3.5 w-3.5"
            />
            <span className="text-[10px] text-muted-foreground">{inst.installment_no}ª</span>
          </label>
        ))}
      </div>
      {allPaid && (
        <Badge variant="outline" className="text-[10px] border-chart-good text-chart-good px-1.5 py-0">
          Comissionável
        </Badge>
      )}
    </div>
  );
}
