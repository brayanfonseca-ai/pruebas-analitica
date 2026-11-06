import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import {
  AppOut, CollectionCreate, CollectionOut, QueryResult, QuerySpec, SheetOut, TableOut,
} from './models';

/**
 * Cliente HTTP de la API DataSense (`/api/v1`). Equivale a js/api.js del
 * frontend vanilla: solo transporte, el motor vive en el backend.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private readonly base = '/api/v1';

  // Apps
  listApps(): Observable<AppOut[]> { return this.http.get<AppOut[]>(`${this.base}/apps`); }
  getApp(id: string): Observable<AppOut> { return this.http.get<AppOut>(`${this.base}/apps/${encodeURIComponent(id)}`); }
  createApp(name: string): Observable<AppOut> { return this.http.post<AppOut>(`${this.base}/apps`, { name }); }
  deleteApp(id: string): Observable<void> { return this.http.delete<void>(`${this.base}/apps/${encodeURIComponent(id)}`); }

  // Colecciones
  listCollections(): Observable<CollectionOut[]> { return this.http.get<CollectionOut[]>(`${this.base}/collections`); }
  createCollection(body: CollectionCreate): Observable<CollectionOut> { return this.http.post<CollectionOut>(`${this.base}/collections`, body); }
  deleteCollection(id: string): Observable<void> { return this.http.delete<void>(`${this.base}/collections/${encodeURIComponent(id)}`); }

  // Tablas
  listTables(appId: string): Observable<TableOut[]> { return this.http.get<TableOut[]>(`${this.base}/apps/${encodeURIComponent(appId)}/tables`); }

  // Hojas
  listSheets(appId: string): Observable<SheetOut[]> { return this.http.get<SheetOut[]>(`${this.base}/apps/${encodeURIComponent(appId)}/sheets`); }

  // Consulta (agregación asociativa)
  query(appId: string, spec: QuerySpec): Observable<QueryResult> {
    return this.http.post<QueryResult>(`${this.base}/apps/${encodeURIComponent(appId)}/query`, spec);
  }
}
