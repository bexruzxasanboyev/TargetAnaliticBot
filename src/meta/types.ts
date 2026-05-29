/**
 * Meta Marketing API javoblarining TypeScript tiplari
 */

export interface MetaPagedResponse<T> {
  data: T[];
  paging?: {
    cursors?: { before?: string; after?: string };
    next?: string;
    previous?: string;
  };
}

export interface MetaAction {
  action_type: string;
  value: string;
}

export interface AdsetInsight {
  campaign_id?: string;
  campaign_name?: string;
  adset_id: string;
  adset_name: string;
  spend: string;
  impressions: string;
  reach: string;
  frequency: string;
  cpm: string;
  ctr: string;
  actions?: MetaAction[];
  cost_per_action_type?: MetaAction[];
  date_start: string;
  date_stop: string;
}

export interface CampaignInsight {
  campaign_id: string;
  campaign_name: string;
  spend: string;
  impressions: string;
  reach: string;
  cpm: string;
  ctr?: string;
  actions?: MetaAction[];
  date_start: string;
  date_stop: string;
}

export interface RawLead {
  id: string;
  created_time: string;
  ad_id?: string;
  adset_id?: string;
  campaign_id?: string;
  form_id: string;
  field_data: Array<{
    name: string;
    values: string[];
  }>;
}

export interface ParsedLead {
  leadId: string;
  createdTime: Date;
  adsetId: string | null;
  formId: string;
  branchName: string | null;
  rawFields: Record<string, string>;
}

export interface MetaErrorBody {
  error: {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;
    fbtrace_id?: string;
    error_user_msg?: string;
    error_user_title?: string;
  };
}
