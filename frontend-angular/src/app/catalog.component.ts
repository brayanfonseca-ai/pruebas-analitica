import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ApiService } from './api.service';
import { AppOut } from './models';

/** Catálogo: lista/crea/elimina aplicaciones. Porta js/catalogo.js a Angular. */
@Component({
  selector: 'ds-catalog',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <header class="head">
      <h1>Catálogo</h1>
      <button class="btn primary" (click)="openCreate()">+ Crear aplicación</button>
    </header>

    <div class="filters">
      <input class="search" placeholder="Filtrar por nombre" [(ngModel)]="q" />
    </div>

    @if (loading()) {
      <p class="muted">Cargando…</p>
    } @else if (filtered().length === 0) {
      <p class="muted">No hay aplicaciones todavía. Pulsa «Crear aplicación» para empezar.</p>
    } @else {
      <div class="grid">
        @for (a of filtered(); track a.id) {
          <article class="card">
            <div class="card-head">
              <span class="ico">◧</span>
              <button class="del" title="Eliminar" (click)="remove(a)">✕</button>
            </div>
            <h3 class="name" [title]="a.name">{{ a.name }}</h3>
            <p class="desc">Creada: {{ a.created_at | date:'mediumDate' }}</p>
            <a class="open" [routerLink]="['/app', a.id]">Abrir aplicación →</a>
          </article>
        }
      </div>
    }

    @if (showCreate()) {
      <div class="backdrop" (click)="closeCreate($event)">
        <div class="modal">
          <div class="modal-head"><h2>Crear aplicación</h2><button (click)="showCreate.set(false)">✕</button></div>
          <div class="modal-body">
            <label>Nombre de la aplicación</label>
            <input [(ngModel)]="newName" placeholder="Mi aplicación" (keydown.enter)="commit()" />
            <p class="err">{{ error() }}</p>
          </div>
          <div class="modal-foot">
            <button class="btn" (click)="showCreate.set(false)">Cancelar</button>
            <button class="btn primary" (click)="commit()">Crear y abrir</button>
          </div>
        </div>
      </div>
    }
  `,
  styleUrl: './catalog.component.css',
})
export class CatalogComponent implements OnInit {
  private api = inject(ApiService);

  apps = signal<AppOut[]>([]);
  loading = signal(true);
  showCreate = signal(false);
  error = signal('');
  q = '';
  newName = '';

  ngOnInit(): void { this.load(); }

  filtered(): AppOut[] {
    const q = this.q.trim().toLowerCase();
    return q ? this.apps().filter((a) => a.name.toLowerCase().includes(q)) : this.apps();
  }

  load(): void {
    this.loading.set(true);
    this.api.listApps().subscribe({
      next: (apps) => { this.apps.set(apps); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  openCreate(): void { this.newName = ''; this.error.set(''); this.showCreate.set(true); }
  closeCreate(e: MouseEvent): void { if ((e.target as HTMLElement).classList.contains('backdrop')) this.showCreate.set(false); }

  commit(): void {
    const name = this.newName.trim();
    if (!name) { this.error.set('Ingresa un nombre.'); return; }
    this.api.createApp(name).subscribe({
      next: (app) => { this.apps.update((xs) => [app, ...xs]); this.showCreate.set(false); },
      error: (e) => this.error.set('Error: ' + e.message),
    });
  }

  remove(a: AppOut): void {
    if (!confirm(`¿Eliminar la aplicación "${a.name}"?`)) return;
    this.api.deleteApp(a.id).subscribe(() => this.apps.update((xs) => xs.filter((x) => x.id !== a.id)));
  }
}
