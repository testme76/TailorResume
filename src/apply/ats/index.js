import { smartRecruitersAdapter } from './smartrecruiters.js';
import { workableAdapter } from './workable.js';

export const adapters = [smartRecruitersAdapter, workableAdapter];

export function detectAdapter(url) {
  return adapters.find((adapter) => adapter.canHandle(url)) || null;
}

