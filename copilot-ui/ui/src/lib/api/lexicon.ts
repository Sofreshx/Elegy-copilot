import { apiRequest } from './core';

export interface LexiconEntry {
  term: string;
  definition: string;
  usage: string;
  related: string;
  tags: string[];
  file: string;
  categoryLabel: string;
}

export interface LexiconResponse {
  entries: LexiconEntry[];
  total: number;
  filteredTotal: number;
  categories: Record<string, string>;
}

export function getLexicon(
  query?: string,
  category?: string,
  baseUrl?: string,
): Promise<LexiconResponse> {
  const params: Record<string, string> = {};
  if (query?.trim()) params.q = query.trim();
  if (category?.trim()) params.category = category.trim();
  return apiRequest<LexiconResponse>('/api/lexicon', { baseUrl, query: params });
}
