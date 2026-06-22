import { apiRequest } from './core';

export interface PatternAtlasEntry {
  id: string;
  name: string;
  aliases: string[];
  tagline: string;
  description: string;
  type: string;
  domain: string;
  confidence: string;
  tags: string[];
  traits: string[];
}

export interface PatternAtlasFilters {
  types: string[];
  domains: string[];
  tags: string[];
}

export interface PatternAtlasResponse {
  entries: PatternAtlasEntry[];
  total: number;
  filteredTotal: number;
  filters: PatternAtlasFilters;
}

export function getPatternAtlas(params?: {
  q?: string;
  type?: string;
  domain?: string;
  confidence?: string;
  tag?: string;
  baseUrl?: string;
}): Promise<PatternAtlasResponse> {
  const query: Record<string, string> = {};
  if (params?.q?.trim()) query.q = params.q.trim();
  if (params?.type?.trim()) query.type = params.type.trim();
  if (params?.domain?.trim()) query.domain = params.domain.trim();
  if (params?.confidence?.trim()) query.confidence = params.confidence.trim();
  if (params?.tag?.trim()) query.tag = params.tag.trim();
  return apiRequest<PatternAtlasResponse>('/api/pattern-atlas', { baseUrl: params?.baseUrl, query });
}
