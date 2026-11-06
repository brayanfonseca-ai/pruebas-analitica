import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

/** Shell del hub: topbar + sidebar + <router-outlet>. Réplica del chrome Qlik. */
@Component({
  selector: 'ds-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <header class="topbar">
      <div class="logo"><span class="mark">◆</span> DataSense <span class="sep">Analítica</span></div>
      <div class="search"><input placeholder="Buscar contenido" /></div>
      <div class="avatar">D</div>
    </header>
    <div class="body">
      <nav class="side">
        <a routerLink="/catalogo" routerLinkActive="active">Catálogo</a>
        <a routerLink="/colecciones" routerLinkActive="active">Colecciones</a>
      </nav>
      <main class="main"><router-outlet /></main>
    </div>
  `,
  styles: [`
    :host { display: block; font-family: 'Segoe UI', system-ui, sans-serif; color: #1a1d21; }
    .topbar { height: 48px; display: flex; align-items: center; gap: 18px; padding: 0 16px; border-bottom: 1px solid #e1e4e8; }
    .logo { font-weight: 600; } .logo .mark { color: #172983; } .logo .sep { color: #6b7280; font-weight: 400; }
    .search { flex: 1; max-width: 560px; margin: 0 auto; } .search input { width: 100%; padding: 7px 12px; border: 1px solid #e1e4e8; border-radius: 16px; }
    .avatar { width: 30px; height: 30px; border-radius: 50%; background: #0b1545; color: #fff; display: grid; place-items: center; font-size: 12px; }
    .body { display: flex; height: calc(100vh - 48px); }
    .side { width: 220px; border-right: 1px solid #e1e4e8; padding: 8px; display: flex; flex-direction: column; gap: 2px; }
    .side a { padding: 8px 12px; border-radius: 6px; text-decoration: none; color: #1a1d21; font-size: 0.9rem; }
    .side a.active { background: #e8ebf7; color: #101d5e; font-weight: 600; }
    .main { flex: 1; overflow-y: auto; }
  `],
})
export class AppComponent {}
