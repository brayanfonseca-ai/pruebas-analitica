// Modelos TypeScript del dominio DataSense. Portados de los Pydantic del backend
// y del contrato JSON que ya consume el frontend vanilla.

export interface AppOut {
  id: string;
  name: string;
  created_at: string;
}

export interface CollectionOut {
  id: string;
  name: string;
  description?: string | null;
  visibility: 'privada' | 'publica' | string;
  created_at: string;
  updated_at: string;
}

export interface CollectionCreate {
  name: string;
  description?: string;
  visibility?: 'privada' | 'publica';
}

export interface ColumnProfile {
  name: string;
  type: 'text' | 'number' | 'date';
  null_count: number;
  distinct_count: number;
  total_count: number;
  sample: unknown[];
}

export interface TableOut {
  id: string;
  app_id: string;
  name: string;
  source_name?: string | null;
  created_at: string;
  rows: number;
  columns: ColumnProfile[];
  preview: Record<string, unknown>[];
}

export interface SheetOut {
  id: string;
  app_id: string;
  title: string;
  description?: string | null;
  position: number;
  objects: Record<string, unknown>[];
  props: Record<string, unknown>;
  visibility: string;
  created_at: string;
  updated_at: string;
}

export interface QuerySpec {
  dimension?: { table: string; field: string };
  measures: { table: string; field: string; agg: string; label?: string }[];
  chart_type?: string;
  selections?: Record<string, unknown[]>;
}

export interface QueryResult {
  labels?: unknown[];
  values?: number[];
  value?: number;
  series?: { label: string; values: number[] }[];
}
