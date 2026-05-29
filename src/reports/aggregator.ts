import type { ParsedLead } from '../meta/types';

export interface BranchAggregation {
  branchName: string;
  leads: number;
  spend: number;
  cpl: number;
  isAllocated: boolean;
  allocationRatio: number;
}

/**
 * Campaign 2 uchun: lead form leadlari + umumiy spend → filial bo'yicha taqsimlash
 *
 * Formula (proporsional):
 *   branchSpend = totalSpend × (branchLeads / totalLeads)
 *   branchCPL   = branchSpend / branchLeads
 *
 * Eslatma: Bu approximation, chunki Meta filial bo'yicha spend bermaydi
 * (lead form bitta campaign-da hammasi uchun umumiy).
 */
export class Aggregator {
  allocateSpendByLeads(
    leads: ParsedLead[],
    totalSpend: number
  ): BranchAggregation[] {
    if (leads.length === 0) return [];

    const branchCounts = new Map<string, number>();
    let unknownCount = 0;

    for (const lead of leads) {
      if (!lead.branchName) {
        unknownCount++;
        continue;
      }
      branchCounts.set(
        lead.branchName,
        (branchCounts.get(lead.branchName) ?? 0) + 1
      );
    }

    const totalLeads = leads.length;
    const result: BranchAggregation[] = [];

    for (const [branch, count] of branchCounts.entries()) {
      const ratio = count / totalLeads;
      const branchSpend = totalSpend * ratio;
      result.push({
        branchName: branch,
        leads: count,
        spend: round2(branchSpend),
        cpl: count > 0 ? round2(branchSpend / count) : 0,
        isAllocated: true,
        allocationRatio: round8(ratio),
      });
    }

    // "Noma'lum filial" guruhi (form da filial tanlanmagan leadlar)
    if (unknownCount > 0) {
      const ratio = unknownCount / totalLeads;
      const spend = totalSpend * ratio;
      result.push({
        branchName: "❓ Noma'lum filial",
        leads: unknownCount,
        spend: round2(spend),
        cpl: round2(spend / unknownCount),
        isAllocated: true,
        allocationRatio: round8(ratio),
      });
    }

    // Leadlar soni bo'yicha sort
    return result.sort((a, b) => b.leads - a.leads);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}

export const aggregator = new Aggregator();
