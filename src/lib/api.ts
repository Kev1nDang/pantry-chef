import type { GroceryItem, RecipeMatch, Unit } from '../types';

const BASE = `${import.meta.env.VITE_API_URL ?? ''}/api`;

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT';
  body?: unknown;
  token?: string;
  signal?: AbortSignal;
}

/** FastAPI errors carry `detail`: a string, or a list of validation errors with `msg`. */
function errorMessage(data: unknown, fallback: string): string {
  const detail = (data as { detail?: unknown } | null)?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail.map((d: { msg?: string }) => d.msg ?? 'Invalid request').join('; ');
  }
  return fallback;
}

async function request<T>(path: string, { method = 'GET', body, token, signal }: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new ApiError(0, "Can't reach the Pantry Chef API. Is the backend running?");
  }

  if (!res.ok) {
    const data: unknown = await res.json().catch(() => null);
    const fallback =
      res.status === 401 ? 'Please sign in again.' : `Request failed (${res.status} ${res.statusText})`;
    throw new ApiError(res.status, errorMessage(data, fallback));
  }
  return (await res.json()) as T;
}

export type NewGrocery = Omit<GroceryItem, 'id'>;

const stripId = ({ name, amount, unit }: GroceryItem): NewGrocery => ({ name, amount, unit });

/** Rank recipes by how much of each one `pantry` covers. `tags` keeps recipes with all of them. */
export function matchRecipes(pantry: GroceryItem[], tags: string[], signal?: AbortSignal) {
  return request<RecipeMatch[]>('/recipes/match', { method: 'POST', body: { pantry, tags }, signal });
}

export function getPantry(token: string) {
  return request<GroceryItem[]>('/pantry', { token });
}

export function savePantry(token: string, items: GroceryItem[]) {
  return request<GroceryItem[]>('/pantry', { method: 'PUT', body: items.map(stripId), token });
}

export interface ParsedGrocery {
  name: string;
  amount: number;
  unit: Unit;
}

/** AI: turn a pasted list or receipt into items to review. Nothing is saved. */
export async function parseGroceryText(token: string, text: string): Promise<ParsedGrocery[]> {
  const res = await request<{ items: ParsedGrocery[] }>('/pantry/parse', {
    method: 'POST',
    body: { text },
    token,
  });
  return res.items;
}

export interface GenerateOptions {
  dietary: string[];
  maxMinutes?: number;
  servings?: number;
}

/** AI: a new recipe from `pantry`, already matched against it. */
export function generateRecipe(token: string, pantry: GroceryItem[], options: GenerateOptions) {
  return request<RecipeMatch>('/recipes/generate', {
    method: 'POST',
    body: { pantry, ...options },
    token,
  });
}

export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong.';
}
