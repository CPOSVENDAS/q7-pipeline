import { supabase } from "@/integrations/supabase/client";

export type ClientType = "novo" | "reativacao";

export interface SaleInstallment {
  id: string;
  conversation_id: string;
  installment_no: number;
  paid_at: string | null;
}

export interface InstallmentModel {
  key: string;
  clientType: ClientType;
  plan: number;
  label: string;
}

// "Novo" só existe com 4 parcelas; "Reativação" pode ter 2, 3 ou 4.
export const INSTALLMENT_MODELS: InstallmentModel[] = [
  { key: "novo-4", clientType: "novo", plan: 4, label: "Novo — 4 parcelas" },
  { key: "reativacao-2", clientType: "reativacao", plan: 2, label: "Reativação — 2 parcelas" },
  { key: "reativacao-3", clientType: "reativacao", plan: 3, label: "Reativação — 3 parcelas" },
  { key: "reativacao-4", clientType: "reativacao", plan: 4, label: "Reativação — 4 parcelas" },
];

export const modelKey = (clientType: string | null, plan: number | null) =>
  clientType && plan ? `${clientType}-${plan}` : "novo-4";

/**
 * Troca o modelo de parcelamento de uma venda (ex.: de "novo/4" para
 * "reativação/2"). Mantém o paid_at das parcelas que continuam existindo,
 * apaga as que sobraram e cria as que faltam (em aberto).
 */
export async function applyInstallmentModel(
  conversationId: string,
  userId: string,
  clientType: ClientType,
  plan: number,
) {
  await supabase
    .from("conversations")
    .update({ client_type: clientType, installment_plan: plan })
    .eq("id", conversationId);

  await supabase
    .from("sale_installments")
    .delete()
    .eq("conversation_id", conversationId)
    .gt("installment_no", plan);

  const { data: existing } = await supabase
    .from("sale_installments")
    .select("installment_no")
    .eq("conversation_id", conversationId);
  const existingNos = new Set((existing || []).map((r) => r.installment_no));
  const missing = Array.from({ length: plan }, (_, i) => i + 1).filter((n) => !existingNos.has(n));
  if (missing.length) {
    await supabase.from("sale_installments").insert(
      missing.map((n) => ({ conversation_id: conversationId, user_id: userId, installment_no: n })),
    );
  }
}

export async function toggleInstallmentPaid(installmentId: string, paid: boolean) {
  await supabase
    .from("sale_installments")
    .update({ paid_at: paid ? new Date().toISOString() : null })
    .eq("id", installmentId);
}

/** O cliente escolhe um único dia do mês (ex.: "todo dia 30") pra pagar; vale
 * pra todas as parcelas da venda. Editável a qualquer momento no checklist. */
export async function setDueDay(conversationId: string, dueDay: number | null) {
  await supabase.from("conversations").update({ due_day: dueDay }).eq("id", conversationId);
}

/**
 * Data de vencimento da parcela N: dia `dueDay` do mês (mês da venda + N).
 * Ex.: venda em 15/set, due_day=30 → 1ª parcela vence 30/out, 2ª 30/nov...
 * Sem due_day definido (vendas antigas, de antes desse campo existir), cai no
 * dia 1 do mês de vencimento — só pra não travar em dado que já existe.
 */
export function dueDateOf(closedAt: string, dueDay: number | null, installmentNo: number): Date {
  const d = new Date(closedAt);
  const targetMonth = d.getMonth() + installmentNo;
  const targetYear = d.getFullYear();
  const daysInTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const day = dueDay ? Math.min(dueDay, daysInTargetMonth) : 1;
  return new Date(targetYear, targetMonth, day);
}

/** Agrupa uma lista plana de parcelas por conversation_id. */
export function groupInstallments(rows: SaleInstallment[]): Record<string, SaleInstallment[]> {
  const map: Record<string, SaleInstallment[]> = {};
  for (const r of rows) {
    (map[r.conversation_id] ||= []).push(r);
  }
  for (const k in map) map[k].sort((a, b) => a.installment_no - b.installment_no);
  return map;
}
