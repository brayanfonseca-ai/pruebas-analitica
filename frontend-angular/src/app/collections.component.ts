import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { ApiService } from './api.service';
import { CollectionOut } from './models';

/** Colecciones: lista/crea/elimina. Funcional contra el backend Spring Boot. */
@Component({
  selector: 'ds-collections',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <header class="head">
      <h1>Colecciones</h1>
      <button class="btn primary" (click)="openCreate()">Crear colección</button>
    </header>

    <div class="filters">
      <select [(ngModel)]="typeFilter">
        <option value="todos">Todos</option>
        <option value="privado">Privado</option>
        <option value="publico">Público</option>
      </select>
    </div>

    @if (filtered().length === 0) {
      <div class="empty">
        <p class="t">No tiene ninguna colección todavía.</p>
        <p>Puede organizar el contenido en colecciones.</p>
        <button class="btn primary" (click)="openCreate()">Crear colección</button>
      </div>
    } @else {
      <div class="grid">
        @for (c of filtered(); track c.id) {
          <article class="card">
            <div class="card-head"><span class="ico">▣</span><button class="del" (click)="remove(c)">✕</button></div>
            <h3 class="name">{{ c.name }}</h3>
            <p class="desc">{{ c.description }}</p>
            <span class="vis" [class.pub]="c.visibility === 'publica'">{{ c.visibility === 'publica' ? 'Pública' : 'Privada' }}</span>
          </article>
        }
      </div>
    }

    @if (showCreate()) {
      <div class="backdrop" (click)="closeCreate($event)">
        <div class="modal">
          <div class="modal-head"><h2>Crear una nueva colección</h2><button (click)="showCreate.set(false)">✕</button></div>
          <div class="modal-body">
            <label>Nombre</label>
            <input [(ngModel)]="form.name" />
            <label>Descripción</label>
            <textarea rows="3" [(ngModel)]="form.description"></textarea>
            <label>Visibilidad</label>
            <select [(ngModel)]="form.visibility"><option value="privada">Privado</option><option value="publica">Público</option></select>
            <p class="err">{{ error() }}</p>
          </div>
          <div class="modal-foot">
            <button class="btn" (click)="showCreate.set(false)">Cancelar</button>
            <button class="btn primary" [disabled]="!form.name.trim()" (click)="commit()">Crear</button>
          </div>
        </div>
      </div>
    }
  `,
  styleUrl: './catalog.component.css',
})
export class CollectionsComponent implements OnInit {
  private api = inject(ApiService);

  collections = signal<CollectionOut[]>([]);
  showCreate = signal(false);
  error = signal('');
  typeFilter = 'todos';
  form = { name: '', description: '', visibility: 'privada' as 'privada' | 'publica' };

  ngOnInit(): void { this.load(); }

  load(): void { this.api.listCollections().subscribe((cs) => this.collections.set(cs)); }

  filtered(): CollectionOut[] {
    const list = this.collections();
    if (this.typeFilter === 'privado') return list.filter((c) => c.visibility !== 'publica');
    if (this.typeFilter === 'publico') return list.filter((c) => c.visibility === 'publica');
    return list;
  }

  openCreate(): void { this.form = { name: '', description: '', visibility: 'privada' }; this.error.set(''); this.showCreate.set(true); }
  closeCreate(e: MouseEvent): void { if ((e.target as HTMLElement).classList.contains('backdrop')) this.showCreate.set(false); }

  commit(): void {
    if (!this.form.name.trim()) return;
    this.api.createCollection({ name: this.form.name.trim(), description: this.form.description.trim(), visibility: this.form.visibility }).subscribe({
      next: (c) => { this.collections.update((xs) => [c, ...xs]); this.showCreate.set(false); },
      error: (e) => this.error.set('Error: ' + e.message),
    });
  }

  remove(c: CollectionOut): void {
    if (!confirm(`¿Eliminar la colección "${c.name}"?`)) return;
    this.api.deleteCollection(c.id).subscribe(() => this.collections.update((xs) => xs.filter((x) => x.id !== c.id)));
  }
}
